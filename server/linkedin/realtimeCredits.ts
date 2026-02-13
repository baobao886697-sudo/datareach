/**
 * LinkedIn 实时积分扣除模块
 * 
 * 核心理念：用多少，扣多少，扣完即停，有始有终
 * 
 * 功能：
 * 1. 实时余额检查 - 每次请求前检查余额是否足够
 * 2. 实时扣除 - 每完成一条数据处理，立即扣除对应积分
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

export interface LinkedInCostBreakdown {
  searchFee: number;
  dataRecords: number;
  dataFee: number;  // 数据费用
  totalCost: number;
}

export interface LinkedInRealtimeCreditTrackerState {
  userId: number;
  taskId: string;
  searchCost: number;
  dataCostPerPerson: number;
  searchFeeDeducted: boolean;
  totalDataRecords: number;
  totalDeducted: number;
  currentBalance: number;
  stopped: boolean;
  stopReason: string | null;
}

// ==================== 实时积分跟踪器 ====================

/**
 * LinkedIn 实时积分跟踪器
 * 
 * 用于跟踪单个任务的积分消耗，支持：
 * - 实时余额检查
 * - 原子扣除操作
 * - 优雅停止
 * - 费用明细统计
 */
export class LinkedInRealtimeCreditTracker {
  private userId: number;
  private taskId: string;
  private searchCost: number;        // 搜索费（模糊1，精准5）
  private dataCostPerPerson: number; // 每条数据费（模糊2，精准10）
  
  // 统计数据
  private searchFeeDeducted: boolean = false;
  private totalDataRecords: number = 0;
  private totalDeducted: number = 0;
  private currentBalance: number = 0;
  
  // 停止标志
  private stopped: boolean = false;
  private stopReason: string | null = null;
  
  constructor(
    userId: number,
    taskId: string,
    searchCost: number,
    dataCostPerPerson: number
  ) {
    this.userId = userId;
    this.taskId = taskId;
    this.searchCost = searchCost;
    this.dataCostPerPerson = dataCostPerPerson;
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
    
    this.currentBalance = parseFloat(String(result[0]?.credits)) || 0;
    return this.currentBalance;
  }
  
  /**
   * 检查是否可以继续（未停止）
   */
  canContinue(): boolean {
    return !this.stopped;
  }
  
  /**
   * 检查余额是否足够支付指定费用
   */
  async checkBalance(requiredAmount: number): Promise<CreditCheckResult> {
    await this.refreshBalance();
    
    return {
      sufficient: this.currentBalance >= requiredAmount,
      currentBalance: this.currentBalance,
      requiredAmount,
    };
  }
  
  /**
   * 检查是否可以开始搜索（支付搜索费）
   */
  async canAffordSearch(): Promise<boolean> {
    if (this.stopped) return false;
    
    const check = await this.checkBalance(this.searchCost);
    if (!check.sufficient) {
      this.stop(`积分不足，需要 ${this.searchCost} 积分，当前余额 ${check.currentBalance} 积分`);
      return false;
    }
    return true;
  }
  
  /**
   * 检查是否可以处理一条数据
   */
  async canAffordDataRecord(): Promise<boolean> {
    if (this.stopped) return false;
    
    const check = await this.checkBalance(this.dataCostPerPerson);
    if (!check.sufficient) {
      this.stop(`积分不足，需要 ${this.dataCostPerPerson} 积分，当前余额 ${check.currentBalance} 积分`);
      return false;
    }
    return true;
  }
  
  /**
   * 检查可以处理多少条数据
   */
  async getAffordableCount(requestedCount: number): Promise<{ canAfford: boolean; affordableCount: number }> {
    if (this.stopped) return { canAfford: false, affordableCount: 0 };
    
    await this.refreshBalance();
    
    const totalCost = requestedCount * this.dataCostPerPerson;
    if (this.currentBalance >= totalCost) {
      return { canAfford: true, affordableCount: requestedCount };
    }
    
    // 计算可以负担多少条
    const affordableCount = Math.floor(this.currentBalance / this.dataCostPerPerson);
    return { canAfford: affordableCount > 0, affordableCount };
  }
  
  /**
   * 扣除搜索费
   */
  async deductSearchFee(): Promise<CreditDeductionResult> {
    if (this.searchFeeDeducted) {
      return {
        success: true,
        newBalance: this.currentBalance,
        deductedAmount: 0,
        message: "搜索费已扣除",
      };
    }
    
    const result = await this.deduct(this.searchCost, 'search');
    if (result.success) {
      this.searchFeeDeducted = true;
    }
    return result;
  }
  
  /**
   * 扣除单条数据费用
   */
  async deductDataRecord(): Promise<CreditDeductionResult> {
    return this.deduct(this.dataCostPerPerson, 'data');
  }
  
  /**
   * 批量扣除数据费用
   */
  async deductDataRecords(count: number): Promise<CreditDeductionResult> {
    const totalCost = count * this.dataCostPerPerson;
    const result = await this.deduct(totalCost, 'data', count);
    return result;
  }
  
  /**
   * 原子扣除操作
   */
  private async deduct(
    amount: number, 
    type: 'search' | 'data',
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
      
      const newBalance = parseFloat(String(newBalanceResult[0]?.credits)) || 0;
      
      // 记录扣费日志
      const description = type === 'search' 
        ? `LinkedIn搜索费 [${this.taskId.substring(0, 8)}] - ${roundedAmount} 积分`
        : `LinkedIn数据 [${this.taskId.substring(0, 8)}] - ${count}条 × ${this.dataCostPerPerson} = ${roundedAmount} 积分`;
      
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
      if (type === 'data') {
        this.totalDataRecords += count;
      }
      
      return {
        success: true,
        newBalance,
        deductedAmount: roundedAmount,
        message: "扣除成功",
      };
    } catch (error: any) {
      console.error(`[LinkedIn] 积分扣除失败:`, error);
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
    
    this.currentBalance = parseFloat(String(result[0]?.credits)) || 0;
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
  getCostBreakdown(): LinkedInCostBreakdown {
    const searchFee = this.searchFeeDeducted ? this.searchCost : 0;
    const dataFee = Math.round(this.totalDataRecords * this.dataCostPerPerson * 10) / 10;
    
    return {
      searchFee,
      dataRecords: this.totalDataRecords,
      dataFee,
      totalCost: Math.round((searchFee + dataFee) * 10) / 10,
    };
  }
  
  /**
   * 获取当前状态
   */
  getState(): LinkedInRealtimeCreditTrackerState {
    return {
      userId: this.userId,
      taskId: this.taskId,
      searchCost: this.searchCost,
      dataCostPerPerson: this.dataCostPerPerson,
      searchFeeDeducted: this.searchFeeDeducted,
      totalDataRecords: this.totalDataRecords,
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
  
  /**
   * 获取搜索费用
   */
  getSearchCost(): number {
    return this.searchCost;
  }
  
  /**
   * 获取每条数据费用
   */
  getDataCostPerPerson(): number {
    return this.dataCostPerPerson;
  }
}

// ==================== 工厂函数 ====================

/**
 * 创建 LinkedIn 实时积分跟踪器
 */
export async function createLinkedInRealtimeCreditTracker(
  userId: number,
  taskId: string,
  searchCost: number,
  dataCostPerPerson: number
): Promise<LinkedInRealtimeCreditTracker> {
  const tracker = new LinkedInRealtimeCreditTracker(userId, taskId, searchCost, dataCostPerPerson);
  await tracker.initialize();
  return tracker;
}

// ==================== 辅助函数 ====================

/**
 * 格式化费用明细为日志字符串
 */
export function formatLinkedInCostBreakdown(
  breakdown: LinkedInCostBreakdown,
  currentBalance: number,
  totalResults: number,
  searchCost: number,
  dataCostPerPerson: number
): string[] {
  // 简洁专业版 - 只输出一行汇总
  return [
    `📊 结果: ${totalResults} 条 | 消耗: ${breakdown.totalCost.toFixed(1)} 积分 | 余额: ${currentBalance.toFixed(1)} 积分`
  ];
}
