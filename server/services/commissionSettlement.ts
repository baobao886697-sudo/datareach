/**
 * 佣金自动结算服务
 * 每小时检查一次，自动结算超过冻结期的佣金
 */

import { settlePendingCommissions } from "../agentDb";

let settlementInterval: NodeJS.Timeout | null = null;

/**
 * 执行佣金结算
 */
async function runSettlement(): Promise<void> {
  try {
    const settledCount = await settlePendingCommissions();
    if (settledCount > 0) {
      console.log(`[CommissionSettlement] 自动结算了 ${settledCount} 笔佣金`);
    }
  } catch (error) {
    console.error('[CommissionSettlement] 结算失败:', error);
  }
}

/**
 * 启动佣金自动结算服务
 * @param intervalMs 检查间隔（毫秒），默认1小时
 */
export function startCommissionSettlement(intervalMs: number = 60 * 60 * 1000): NodeJS.Timeout {
  console.log(`[CommissionSettlement] 启动佣金自动结算服务，间隔: ${intervalMs / 1000}秒`);
  
  // 启动时先执行一次
  runSettlement().catch(console.error);
  
  // 定期执行
  settlementInterval = setInterval(() => {
    runSettlement().catch(console.error);
  }, intervalMs);
  
  return settlementInterval;
}

/**
 * 停止佣金自动结算服务
 */
export function stopCommissionSettlement(): void {
  if (settlementInterval) {
    clearInterval(settlementInterval);
    settlementInterval = null;
    console.log('[CommissionSettlement] 佣金自动结算服务已停止');
  }
}
