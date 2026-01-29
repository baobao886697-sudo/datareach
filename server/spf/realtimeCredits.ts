/**
 * SPF 实时积分扣除模块
 * 
 * 核心理念：用多少，扣多少，扣完即停，有始有终
 * 
 * 功能：
 * 1. 实时余额检查 - 每次请求前检查余额是否足够
 * 2. 实时扣除 - 每完成一个 API 请求，立即扣除对应积分
 * 3. 优雅停止 - 积分不足时立即停止，返回已获取的结果
 * 4. 费用跟踪 - 跟踪本次任务的所有费用明细
 */

import { getDb } from "../db";
import { users, creditLogs } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";

// ==================== 类型定义 ====================

export interface CreditDeductionResult {
  success: boolean;
  newBalance: number;
  deductedAmount: number;
  message: string;
}

export interface CreditCheckResult {
  sufficient: boolean;
  currentBalance: number;
  requiredAmount: number;
}

export interface CostBreakdown {
  searchPages: number;
  searchCost: number;
  detailPages: number;
  detailCost: number;
  totalCost: number;
}

export interface RealtimeCreditTrackerState {
  userId: number;
  taskId: string;
  searchCost: number;
  detailCost: number;
  totalSearchPages: number;
  totalDetailPages: number;
  totalDeducted: number;
  currentBalance: number;
  stopped: boolean;
  stopReason: string | null;
}

// ==================== 实时积分跟踪器 ====================

/**
 * 实时积分跟踪器
 * 
 * 用于跟踪单个任务的积分消耗，支持：
 * - 实时余额检查
 * - 原子扣除操作
 * - 优雅停止
 * - 费用明细统计
 */
export class RealtimeCreditTracker {
  private userId: number;
  private taskId: string;
  private searchCost: number;
  private detailCost: number;
  
  // 统计数据
  private totalSearchPages: number = 0;
  private totalDetailPages: number = 0;
  private totalDeducted: number = 0;
  private currentBalance: number = 0;
  
  // 停止标志
  private stopped: boolean = false;
  private stopReason: string | null = null;
  
  constructor(
    userId: number,
    taskId: string,
    searchCost: number,
    detailCost: number
  ) {
    this.userId = userId;
    this.taskId = taskId;
    this.searchCost = searchCost;
    this.detailCost = detailCost;
  }
  
  /**
   * 初始化跟踪器，获取当前余额
   */
  async initialize(): Promise<number> {
    const database = await getDb();
    if (!database) {
      throw new Error("数据库连接失败");
    }
    
    const result = await database
      .select({ credits: users.credits })
      .from(users)
      .where(eq(users.id, this.userId));
    
    this.currentBalance = result[0]?.credits || 0;
    return this.currentBalance;
  }
  
  /**
   * 检查是否可以继续（未停止且有足够积分）
   */
  canContinue(): boolean {
    return !this.stopped;
  }
  
  /**
   * 检查余额是否足够支付指定费用
   */
  async checkBalance(requiredAmount: number): Promise<CreditCheckResult> {
    // 刷新余额
    await this.refreshBalance();
    
    return {
      sufficient: this.currentBalance >= requiredAmount,
      currentBalance: this.currentBalance,
      requiredAmount,
    };
  }
  
  /**
   * 检查是否可以执行搜索页请求
   */
  async canAffordSearchPage(): Promise<boolean> {
    if (this.stopped) return false;
    
    const check = await this.checkBalance(this.searchCost);
    if (!check.sufficient) {
      this.stop(`积分不足，需要 ${this.searchCost} 积分，当前余额 ${check.currentBalance} 积分`);
      return false;
    }
    return true;
  }
  
  /**
   * 检查是否可以执行详情页请求
   */
  async canAffordDetailPage(): Promise<boolean> {
    if (this.stopped) return false;
    
    const check = await this.checkBalance(this.detailCost);
    if (!check.sufficient) {
      this.stop(`积分不足，需要 ${this.detailCost} 积分，当前余额 ${check.currentBalance} 积分`);
      return false;
    }
    return true;
  }
  
  /**
   * 检查是否可以执行一批详情页请求
   */
  async canAffordDetailBatch(count: number): Promise<{ canAfford: boolean; affordableCount: number }> {
    if (this.stopped) return { canAfford: false, affordableCount: 0 };
    
    await this.refreshBalance();
    
    const totalCost = count * this.detailCost;
    if (this.currentBalance >= totalCost) {
      return { canAfford: true, affordableCount: count };
    }
    
    // 计算可以负担多少条
    const affordableCount = Math.floor(this.currentBalance / this.detailCost);
    return { canAfford: affordableCount > 0, affordableCount };
  }
  
  /**
   * 扣除搜索页费用
   */
  async deductSearchPage(): Promise<CreditDeductionResult> {
    return this.deduct(this.searchCost, 'search');
  }
  
  /**
   * 扣除详情页费用
   */
  async deductDetailPage(): Promise<CreditDeductionResult> {
    return this.deduct(this.detailCost, 'detail');
  }
  
  /**
   * 批量扣除详情页费用
   */
  async deductDetailPages(count: number): Promise<CreditDeductionResult> {
    const totalCost = count * this.detailCost;
    const result = await this.deduct(totalCost, 'detail', count);
    if (result.success) {
      // 已经在 deduct 中增加了 1，这里需要额外增加 count - 1
      this.totalDetailPages += count - 1;
    }
    return result;
  }
  
  /**
   * 原子扣除操作
   */
  private async deduct(
    amount: number, 
    type: 'search' | 'detail',
    count: number = 1
  ): Promise<CreditDeductionResult> {
    const database = await getDb();
    if (!database) {
      return {
        success: false,
        newBalance: this.currentBalance,
        deductedAmount: 0,
        message: "数据库连接失败",
      };
    }
    
    // 四舍五入到一位小数
    const roundedAmount = Math.round(amount * 10) / 10;
    
    try {
      // 使用原子操作：检查并扣除
      // 使用 SQL 条件更新，确保余额足够才扣除
      const updateResult = await database
        .update(users)
        .set({
          credits: sql`${users.credits} - ${roundedAmount}`,
        })
        .where(
          sql`${users.id} = ${this.userId} AND ${users.credits} >= ${roundedAmount}`
        );
      
      // 检查是否成功更新
      if ((updateResult as any).rowsAffected === 0 || (updateResult as any).affectedRows === 0) {
        // 扣除失败，余额不足
        await this.refreshBalance();
        this.stop(`积分不足，需要 ${roundedAmount} 积分，当前余额 ${this.currentBalance} 积分`);
        return {
          success: false,
          newBalance: this.currentBalance,
          deductedAmount: 0,
          message: `积分不足`,
        };
      }
      
      // 获取新余额
      const newBalanceResult = await database
        .select({ credits: users.credits })
        .from(users)
        .where(eq(users.id, this.userId));
      
      const newBalance = newBalanceResult[0]?.credits || 0;
      
      // 记录扣费日志
      const description = type === 'search' 
        ? `SPF搜索页 [${this.taskId}] - ${roundedAmount} 积分`
        : `SPF详情页 [${this.taskId}] - ${count}条 × ${this.detailCost} = ${roundedAmount} 积分`;
      
      await database.insert(creditLogs).values({
        userId: this.userId,
        amount: -roundedAmount,
        balanceAfter: newBalance,
        type: "search",
        description,
        relatedTaskId: this.taskId,
      });
      
      // 更新统计
      this.currentBalance = newBalance;
      this.totalDeducted += roundedAmount;
      if (type === 'search') {
        this.totalSearchPages += 1;
      } else {
        this.totalDetailPages += 1;
      }
      
      return {
        success: true,
        newBalance,
        deductedAmount: roundedAmount,
        message: "扣除成功",
      };
    } catch (error: any) {
      console.error(`[SPF] 积分扣除失败:`, error);
      return {
        success: false,
        newBalance: this.currentBalance,
        deductedAmount: 0,
        message: error.message,
      };
    }
  }
  
  /**
   * 刷新余额
   */
  private async refreshBalance(): Promise<void> {
    const database = await getDb();
    if (!database) return;
    
    const result = await database
      .select({ credits: users.credits })
      .from(users)
      .where(eq(users.id, this.userId));
    
    this.currentBalance = result[0]?.credits || 0;
  }
  
  /**
   * 停止跟踪器
   */
  stop(reason: string): void {
    this.stopped = true;
    this.stopReason = reason;
  }
  
  /**
   * 获取停止原因
   */
  getStopReason(): string | null {
    return this.stopReason;
  }
  
  /**
   * 获取是否已停止
   */
  isStopped(): boolean {
    return this.stopped;
  }
  
  /**
   * 获取费用明细
   */
  getCostBreakdown(): CostBreakdown {
    const searchCostTotal = Math.round(this.totalSearchPages * this.searchCost * 10) / 10;
    const detailCostTotal = Math.round(this.totalDetailPages * this.detailCost * 10) / 10;
    
    return {
      searchPages: this.totalSearchPages,
      searchCost: searchCostTotal,
      detailPages: this.totalDetailPages,
      detailCost: detailCostTotal,
      totalCost: Math.round((searchCostTotal + detailCostTotal) * 10) / 10,
    };
  }
  
  /**
   * 获取当前状态
   */
  getState(): RealtimeCreditTrackerState {
    return {
      userId: this.userId,
      taskId: this.taskId,
      searchCost: this.searchCost,
      detailCost: this.detailCost,
      totalSearchPages: this.totalSearchPages,
      totalDetailPages: this.totalDetailPages,
      totalDeducted: this.totalDeducted,
      currentBalance: this.currentBalance,
      stopped: this.stopped,
      stopReason: this.stopReason,
    };
  }
  
  /**
   * 获取当前余额
   */
  getCurrentBalance(): number {
    return this.currentBalance;
  }
  
  /**
   * 获取总扣除金额
   */
  getTotalDeducted(): number {
    return this.totalDeducted;
  }
}

// ==================== 工厂函数 ====================

/**
 * 创建实时积分跟踪器
 */
export async function createRealtimeCreditTracker(
  userId: number,
  taskId: string,
  searchCost: number,
  detailCost: number
): Promise<RealtimeCreditTracker> {
  const tracker = new RealtimeCreditTracker(userId, taskId, searchCost, detailCost);
  await tracker.initialize();
  return tracker;
}

// ==================== 辅助函数 ====================

/**
 * 格式化费用明细为日志字符串
 */
export function formatCostBreakdown(
  breakdown: CostBreakdown,
  currentBalance: number,
  totalResults: number
): string[] {
  const lines: string[] = [];
  
  lines.push(`═══════════════════════════════════════════════════`);
  lines.push(`💰 费用明细`);
  lines.push(`═══════════════════════════════════════════════════`);
  lines.push(`📋 搜索页: ${breakdown.searchPages} 页 × ${(breakdown.searchCost / breakdown.searchPages || 0).toFixed(2)} = ${breakdown.searchCost.toFixed(1)} 积分`);
  lines.push(`📋 详情页: ${breakdown.detailPages} 页 × ${(breakdown.detailCost / breakdown.detailPages || 0).toFixed(2)} = ${breakdown.detailCost.toFixed(1)} 积分`);
  lines.push(`───────────────────────────────────────────────────`);
  lines.push(`📊 本次消耗: ${breakdown.totalCost.toFixed(1)} 积分`);
  lines.push(`📊 剩余余额: ${currentBalance.toFixed(1)} 积分`);
  lines.push(`📊 获取结果: ${totalResults} 条`);
  
  if (totalResults > 0) {
    const costPerResult = breakdown.totalCost / totalResults;
    lines.push(`📊 每条成本: ${costPerResult.toFixed(2)} 积分`);
  }
  
  lines.push(`═══════════════════════════════════════════════════`);
  
  return lines;
}
