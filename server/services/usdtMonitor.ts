/**
 * USDT 自动充值检测服务 (V6蓝图)
 * 
 * 功能：
 * 1. 定期检查TRC20/ERC20/BEP20钱包的USDT交易
 * 2. 自动匹配待支付订单
 * 3. 使用唯一尾数金额进行精确匹配
 * 4. 自动确认订单并发放积分
 */

import { 
  getPendingOrders, 
  confirmRechargeOrder, 
  markOrderMismatch,
  getConfig,
  logAdmin 
} from "../db";

// TronGrid API (TRC20)
const TRONGRID_API = "https://api.trongrid.io";

// 交易记录缓存，避免重复处理
const processedTxIds = new Set<string>();

// USDT合约地址
const USDT_CONTRACTS = {
  TRC20: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", // Tron USDT
  ERC20: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // Ethereum USDT
  BEP20: "0x55d398326f99059fF775485246999027B3197955", // BSC USDT
};

interface UsdtTransaction {
  txId: string;
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  network: string;
}

/**
 * 获取TRC20 USDT交易记录
 */
async function getTrc20Transactions(walletAddress: string): Promise<UsdtTransaction[]> {
  try {
    const url = `${TRONGRID_API}/v1/accounts/${walletAddress}/transactions/trc20?limit=50&contract_address=${USDT_CONTRACTS.TRC20}`;
    
    const response = await fetch(url, {
      headers: {
        "TRON-PRO-API-KEY": process.env.TRONGRID_API_KEY || "",
      },
    });

    if (!response.ok) {
      console.error("[USDT Monitor] TronGrid API error:", response.status);
      return [];
    }

    const data = await response.json();
    
    if (!data.data || !Array.isArray(data.data)) {
      return [];
    }

    return data.data
      .filter((tx: any) => tx.to === walletAddress) // 只关注收款
      .map((tx: any) => ({
        txId: tx.transaction_id,
        from: tx.from,
        to: tx.to,
        amount: parseFloat(tx.value) / 1e6, // USDT 6位小数
        timestamp: tx.block_timestamp,
        network: "TRC20",
      }));
  } catch (error) {
    console.error("[USDT Monitor] Error fetching TRC20 transactions:", error);
    return [];
  }
}

/**
 * 匹配订单
 * 使用唯一尾数金额进行精确匹配
 */
async function matchOrderByAmount(amount: number, network: string): Promise<{
  orderId: string;
  exactMatch: boolean;
} | null> {
  const pendingOrders = await getPendingOrders();
  
  // 精确匹配（包含尾数）
  const exactMatch = pendingOrders.find(
    (order) => 
      order.network === network && 
      Math.abs(parseFloat(order.amount) - amount) < 0.001
  );
  
  if (exactMatch) {
    return { orderId: exactMatch.orderId, exactMatch: true };
  }

  // 模糊匹配（整数部分相同，尾数不同）
  // 这种情况标记为金额不匹配，需要人工处理
  const fuzzyMatch = pendingOrders.find(
    (order) =>
      order.network === network &&
      Math.floor(parseFloat(order.amount)) === Math.floor(amount)
  );

  if (fuzzyMatch) {
    return { orderId: fuzzyMatch.orderId, exactMatch: false };
  }

  return null;
}

/**
 * 处理新交易
 */
async function processTransaction(tx: UsdtTransaction): Promise<void> {
  // 检查是否已处理
  if (processedTxIds.has(tx.txId)) {
    return;
  }

  console.log(`[USDT Monitor] Processing transaction: ${tx.txId}, amount: ${tx.amount} ${tx.network}`);

  // 尝试匹配订单
  const match = await matchOrderByAmount(tx.amount, tx.network);

  if (!match) {
    console.log(`[USDT Monitor] No matching order found for amount: ${tx.amount}`);
    processedTxIds.add(tx.txId);
    return;
  }

  if (match.exactMatch) {
    // 精确匹配，自动确认
    const success = await confirmRechargeOrder(match.orderId, tx.txId, tx.amount.toString());
    
    if (success) {
      console.log(`[USDT Monitor] Order ${match.orderId} confirmed automatically`);
      await logAdmin("system", "auto_confirm_order", "order", match.orderId, {
        txId: tx.txId,
        amount: tx.amount,
        network: tx.network,
      });
    }
  } else {
    // 金额不匹配，标记需要人工处理
    await markOrderMismatch(match.orderId, tx.amount.toString(), tx.txId, "自动检测：金额不匹配，需人工确认");
    
    console.log(`[USDT Monitor] Order ${match.orderId} marked as mismatch`);
    await logAdmin("system", "mark_order_mismatch", "order", match.orderId, {
      txId: tx.txId,
      expectedAmount: "订单金额",
      receivedAmount: tx.amount,
      network: tx.network,
    });
  }

  processedTxIds.add(tx.txId);
}

/**
 * 检查所有配置的钱包
 */
async function checkAllWallets(): Promise<void> {
  // 检查TRC20钱包
  const trc20Wallet = await getConfig("USDT_WALLET_TRC20");
  if (trc20Wallet) {
    const transactions = await getTrc20Transactions(trc20Wallet);
    for (const tx of transactions) {
      await processTransaction(tx);
    }
  }

  // TODO: 添加ERC20和BEP20支持
  // 需要使用Etherscan API和BSCScan API
}

/**
 * 启动USDT监控服务
 * @param intervalMs 检查间隔（毫秒），默认30秒
 */
export function startUsdtMonitor(intervalMs: number = 30000): NodeJS.Timeout {
  console.log(`[USDT Monitor] Starting with interval: ${intervalMs}ms`);
  
  // 立即执行一次
  checkAllWallets().catch(console.error);
  
  // 定期执行
  return setInterval(() => {
    checkAllWallets().catch(console.error);
  }, intervalMs);
}

/**
 * 停止USDT监控服务
 */
export function stopUsdtMonitor(timer: NodeJS.Timeout): void {
  clearInterval(timer);
  console.log("[USDT Monitor] Stopped");
}

/**
 * 手动触发检查（用于测试或管理员操作）
 */
export async function triggerManualCheck(): Promise<{ checked: number; matched: number }> {
  const beforeSize = processedTxIds.size;
  await checkAllWallets();
  const afterSize = processedTxIds.size;
  
  return {
    checked: afterSize - beforeSize,
    matched: 0, // 需要更详细的统计
  };
}

/**
 * 清除已处理交易缓存（用于重新处理）
 */
export function clearProcessedCache(): void {
  processedTxIds.clear();
  console.log("[USDT Monitor] Processed cache cleared");
}
