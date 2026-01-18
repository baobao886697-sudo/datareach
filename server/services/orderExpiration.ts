/**
 * 订单过期检查服务
 * 
 * 功能：
 * 1. 定期检查过期的待支付订单
 * 2. 自动将过期订单标记为expired状态
 */

import { expireOldOrders, logAdmin } from "../db";

/**
 * 检查并过期旧订单
 */
async function checkExpiredOrders(): Promise<void> {
  try {
    const expiredCount = await expireOldOrders();
    
    if (expiredCount > 0) {
      console.log(`[Order Expiration] Expired ${expiredCount} orders`);
      await logAdmin("system", "expire_orders", "order", undefined, {
        count: expiredCount,
      });
    }
  } catch (error) {
    console.error("[Order Expiration] Error:", error);
  }
}

/**
 * 启动订单过期检查服务
 * @param intervalMs 检查间隔（毫秒），默认5分钟
 */
export function startOrderExpirationChecker(intervalMs: number = 5 * 60 * 1000): NodeJS.Timeout {
  console.log(`[Order Expiration] Starting with interval: ${intervalMs}ms`);
  
  // 立即执行一次
  checkExpiredOrders().catch(console.error);
  
  // 定期执行
  return setInterval(() => {
    checkExpiredOrders().catch(console.error);
  }, intervalMs);
}

/**
 * 停止订单过期检查服务
 */
export function stopOrderExpirationChecker(timer: NodeJS.Timeout): void {
  clearInterval(timer);
  console.log("[Order Expiration] Stopped");
}
