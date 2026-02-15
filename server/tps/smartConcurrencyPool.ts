/**
 * TPS 智能动态并发池 (Smart Concurrency Pool)
 * 
 * 版本: 7.0 (全局弹性并发版)
 * 
 * 核心特性:
 * - 4 虚拟线程 × 10 并发 = 最大 40 并发
 * - 智能任务规模评估，动态调整并发数
 * - 错误回退机制，保护 API
 * - 负载均衡，任务均匀分配
 * 
 * v7.0 升级:
 * - 延后重试从串行改为并行：失败任务重新分配到虚拟线程并行执行
 * - 彻底消除串行重试导致的长时间阻塞（"卡住"现象）
 * - HTTP请求的实际并发由外部全局弹性信号量控制
 * 
 * 独立模块: 仅用于 TPS 搜索功能
 */

import { ScrapeRateLimitError, ScrapeServerError } from './scrapeClient';

// ============================================================================
// 配置参数
// ============================================================================

export const TPS_POOL_CONFIG = {
  // 线程配置 (v7.1: 降低并发，配合全局信号量30硬顶)
  MAX_THREADS: 3,                    // 最大虚拟线程数 (v7.1: 4→3)
  MAX_CONCURRENCY_PER_THREAD: 7,     // 每线程最大并发数 (v7.1: 10→7)
  GLOBAL_MAX_CONCURRENCY: 21,        // 全局最大并发 (3 × 7 = 21, v7.1: 40→21)
  
  // 任务规模阈值（基于详情页数量）
  SMALL_TASK_THRESHOLD: 50,          // 小任务: ≤50 条详情
  MEDIUM_TASK_THRESHOLD: 150,        // 中任务: 51-150 条详情
  // 大任务: >150 条详情
  
  // 动态并发配置 (v7.1: 全面降低，避免502)
  SMALL_TASK_THREADS: 2,             // 小任务线程数
  SMALL_TASK_CONCURRENCY: 4,         // 小任务每线程并发 (v7.1: 5→4)
  MEDIUM_TASK_THREADS: 2,            // 中任务线程数 (v7.1: 3→2)
  MEDIUM_TASK_CONCURRENCY: 5,        // 中任务每线程并发 (v7.1: 8→5)
  LARGE_TASK_THREADS: 3,             // 大任务线程数 (v7.1: 4→3)
  LARGE_TASK_CONCURRENCY: 5,         // 大任务每线程并发 (v7.1: 10→5)
  
  // 速率限制
  REQUEST_DELAY_MS: 100,             // 请求间隔 (毫秒)
  ERROR_BACKOFF_MULTIPLIER: 2,       // 错误回退倍数
  MAX_ERROR_RATE: 0.1,               // 最大错误率 (10%)
  
  // 重试配置
  MAX_RETRIES: 1,                    // 即时重试次数（并发池层面）
  RETRY_DELAY_MS: 1000,              // 即时重试延迟 (毫秒)
  
  // 延后重试配置 (v7.0: 改为并行)
  DELAYED_RETRY_MAX: 2,              // 延后重试最大次数
  DELAYED_RETRY_DELAY_MS: 3000,      // 延后重试前等待时间 (毫秒)
};

// ============================================================================
// 内部常量
// ============================================================================

/** 标记任务需要延后重试的特殊错误字符串 */
const NEEDS_DELAYED_RETRY = '__NEEDS_DELAYED_RETRY__';

// ============================================================================
// 类型定义
// ============================================================================

export interface PoolTask<T, R> {
  id: string;
  data: T;
  execute: (data: T) => Promise<R>;
}

export interface PoolResult<R> {
  id: string;
  success: boolean;
  result?: R;
  error?: string;
}

export interface PoolStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  activeThreads: number;
  currentConcurrency: number;
  errorRate: number;
  avgResponseTime: number;
  /** v6.0: 延后重试队列中的任务数 */
  delayedRetryCount?: number;
  /** v6.0: 延后重试成功数 */
  delayedRetrySuccess?: number;
}

export interface DynamicConfig {
  threads: number;
  concurrencyPerThread: number;
  totalConcurrency: number;
}

// ============================================================================
// 信号量实现
// ============================================================================

class Semaphore {
  private permits: number;
  private waitQueue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    const next = this.waitQueue.shift();
    if (next) {
      this.permits--;
      next();
    }
  }

  available(): number {
    return this.permits;
  }
}

// ============================================================================
// 虚拟线程实现
// ============================================================================

class VirtualThread<T, R> {
  private id: number;
  private semaphore: Semaphore;
  private isRunning: boolean = false;
  private taskQueue: PoolTask<T, R>[] = [];
  private errorCount: number = 0;
  private totalCount: number = 0;
  private responseTimes: number[] = [];
  private shouldStop: boolean = false;

  constructor(id: number, concurrency: number) {
    this.id = id;
    this.semaphore = new Semaphore(concurrency);
  }

  getId(): number {
    return this.id;
  }

  getQueueLength(): number {
    return this.taskQueue.length;
  }

  getErrorRate(): number {
    return this.totalCount > 0 ? this.errorCount / this.totalCount : 0;
  }

  getAvgResponseTime(): number {
    if (this.responseTimes.length === 0) return 0;
    return this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
  }

  addTask(task: PoolTask<T, R>): void {
    this.taskQueue.push(task);
  }

  stop(): void {
    this.shouldStop = true;
  }

  async start(onResult: (result: PoolResult<R>) => void): Promise<void> {
    this.isRunning = true;
    
    // 修复: 使用 Map 跟踪 Promise 完成状态，避免原有的 Promise.race 检测 bug
    const activePromises = new Map<number, Promise<void>>();
    let promiseId = 0;

    while ((this.taskQueue.length > 0 || activePromises.size > 0) && !this.shouldStop) {
      // 启动新任务
      while (this.taskQueue.length > 0 && this.semaphore.available() > 0 && !this.shouldStop) {
        const task = this.taskQueue.shift()!;
        const currentId = promiseId++;
        
        // 创建 Promise 并在完成时自动从 Map 中移除
        const promise = this.executeTask(task, onResult).finally(() => {
          activePromises.delete(currentId);
        });
        
        activePromises.set(currentId, promise);
        
        // 请求间隔
        await this.delay(TPS_POOL_CONFIG.REQUEST_DELAY_MS);
      }

      // 等待至少一个任务完成
      if (activePromises.size > 0) {
        await Promise.race(Array.from(activePromises.values()));
      }
    }

    // 等待所有剩余任务完成
    if (activePromises.size > 0) {
      await Promise.all(Array.from(activePromises.values()));
    }
    this.isRunning = false;
  }

  private async executeTask(task: PoolTask<T, R>, onResult: (result: PoolResult<R>) => void): Promise<void> {
    await this.semaphore.acquire();
    const startTime = Date.now();
    
    try {
      let lastError: Error | null = null;
      
      for (let retry = 0; retry <= TPS_POOL_CONFIG.MAX_RETRIES; retry++) {
        try {
          const result = await task.execute(task.data);
          this.totalCount++;
          this.responseTimes.push(Date.now() - startTime);
          
          onResult({
            id: task.id,
            success: true,
            result,
          });
          return;
        } catch (error) {
          lastError = error as Error;
          
          // v6.0: 检测 429/502 错误
          const isRetryableError = (
            lastError instanceof ScrapeRateLimitError ||
            lastError instanceof ScrapeServerError
          );
          
          if (retry < TPS_POOL_CONFIG.MAX_RETRIES) {
            // 还有即时重试机会
            await this.delay(TPS_POOL_CONFIG.RETRY_DELAY_MS * Math.pow(TPS_POOL_CONFIG.ERROR_BACKOFF_MULTIPLIER, retry));
          } else if (isRetryableError) {
            // 即时重试用尽 + 是429/502错误 → 标记为需要延后重试
            this.totalCount++;
            this.responseTimes.push(Date.now() - startTime);
            
            onResult({
              id: task.id,
              success: false,
              error: NEEDS_DELAYED_RETRY,
            });
            return;
          }
        }
      }
      
      // 所有重试都失败（非429/502错误）
      this.totalCount++;
      this.errorCount++;
      this.responseTimes.push(Date.now() - startTime);
      
      onResult({
        id: task.id,
        success: false,
        error: lastError?.message || 'Unknown error',
      });
    } finally {
      this.semaphore.release();
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// 智能动态并发池
// ============================================================================

export class TpsSmartConcurrencyPool<T, R> {
  private threads: VirtualThread<T, R>[] = [];
  private dynamicConfig: DynamicConfig;
  private stats: PoolStats;
  private onProgress?: (stats: PoolStats) => void;

  constructor(taskCount: number, onProgress?: (stats: PoolStats) => void) {
    this.dynamicConfig = this.evaluateTaskScale(taskCount);
    this.onProgress = onProgress;
    this.stats = {
      totalTasks: taskCount,
      completedTasks: 0,
      failedTasks: 0,
      activeThreads: this.dynamicConfig.threads,
      currentConcurrency: this.dynamicConfig.totalConcurrency,
      errorRate: 0,
      avgResponseTime: 0,
      delayedRetryCount: 0,
      delayedRetrySuccess: 0,
    };

    // 创建虚拟线程
    for (let i = 0; i < this.dynamicConfig.threads; i++) {
      this.threads.push(new VirtualThread<T, R>(i, this.dynamicConfig.concurrencyPerThread));
    }

    console.log(`[TPS Pool] 初始化智能并发池: ${this.dynamicConfig.threads} 线程 × ${this.dynamicConfig.concurrencyPerThread} 并发 = ${this.dynamicConfig.totalConcurrency} 总并发`);
  }

  /**
   * 评估任务规模，返回最优配置
   */
  private evaluateTaskScale(taskCount: number): DynamicConfig {
    if (taskCount <= TPS_POOL_CONFIG.SMALL_TASK_THRESHOLD) {
      return {
        threads: TPS_POOL_CONFIG.SMALL_TASK_THREADS,
        concurrencyPerThread: TPS_POOL_CONFIG.SMALL_TASK_CONCURRENCY,
        totalConcurrency: TPS_POOL_CONFIG.SMALL_TASK_THREADS * TPS_POOL_CONFIG.SMALL_TASK_CONCURRENCY,
      };
    } else if (taskCount <= TPS_POOL_CONFIG.MEDIUM_TASK_THRESHOLD) {
      return {
        threads: TPS_POOL_CONFIG.MEDIUM_TASK_THREADS,
        concurrencyPerThread: TPS_POOL_CONFIG.MEDIUM_TASK_CONCURRENCY,
        totalConcurrency: TPS_POOL_CONFIG.MEDIUM_TASK_THREADS * TPS_POOL_CONFIG.MEDIUM_TASK_CONCURRENCY,
      };
    } else {
      return {
        threads: TPS_POOL_CONFIG.LARGE_TASK_THREADS,
        concurrencyPerThread: TPS_POOL_CONFIG.LARGE_TASK_CONCURRENCY,
        totalConcurrency: TPS_POOL_CONFIG.LARGE_TASK_THREADS * TPS_POOL_CONFIG.LARGE_TASK_CONCURRENCY,
      };
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): DynamicConfig {
    return this.dynamicConfig;
  }

  /**
   * 获取统计信息
   */
  getStats(): PoolStats {
    return this.stats;
  }

  /**
   * 停止所有线程
   */
  stop(): void {
    for (const thread of this.threads) {
      thread.stop();
    }
  }

  /**
   * 执行所有任务（含并行延后重试）
   * 
   * v7.0 流程:
   * 1. 主批次: 将所有任务分配到虚拟线程并行执行
   * 2. 收集延后重试: 识别 429/502 失败的任务
   * 3. 并行延后重试: 等待后将失败任务重新分配到虚拟线程并行执行（不再串行！）
   */
  async execute(tasks: PoolTask<T, R>[]): Promise<PoolResult<R>[]> {
    const results: PoolResult<R>[] = [];
    const delayedRetryTasks: PoolTask<T, R>[] = [];
    
    // 建立 taskId → task 的映射，用于延后重试时找回原始任务
    const taskMap = new Map<string, PoolTask<T, R>>();
    for (const task of tasks) {
      taskMap.set(task.id, task);
    }
    
    // 负载均衡: 将任务均匀分配到各线程
    tasks.forEach((task, index) => {
      const threadIndex = index % this.threads.length;
      this.threads[threadIndex].addTask(task);
    });

    console.log(`[TPS Pool] 开始执行 ${tasks.length} 个任务，分配到 ${this.threads.length} 个线程`);

    // 结果回调
    const onResult = (result: PoolResult<R>) => {
      if (result.success) {
        results.push(result);
        this.stats.completedTasks++;
      } else if (result.error === NEEDS_DELAYED_RETRY) {
        // v6.0: 429/502 失败的任务，加入延后重试队列
        const originalTask = taskMap.get(result.id);
        if (originalTask) {
          delayedRetryTasks.push(originalTask);
        }
      } else {
        results.push(result);
        this.stats.failedTasks++;
      }
      
      this.stats.errorRate = this.stats.failedTasks / Math.max(1, this.stats.completedTasks + this.stats.failedTasks);
      
      // 计算平均响应时间
      const avgTimes = this.threads.map(t => t.getAvgResponseTime()).filter(t => t > 0);
      this.stats.avgResponseTime = avgTimes.length > 0 
        ? avgTimes.reduce((a, b) => a + b, 0) / avgTimes.length 
        : 0;

      // 进度回调
      if (this.onProgress) {
        this.onProgress(this.stats);
      }
    };

    // ==================== 第一阶段：主批次执行 ====================
    await Promise.all(this.threads.map(thread => thread.start(onResult)));

    // ==================== 第二阶段：并行延后重试 (v7.0 升级) ====================
    if (delayedRetryTasks.length > 0) {
      console.log(`[TPS Pool] 🔄 第二阶段并行延后重试: ${delayedRetryTasks.length} 个任务 (429/502)`);
      this.stats.delayedRetryCount = delayedRetryTasks.length;
      
      // 等待一段时间，给上游服务恢复时间
      await new Promise(resolve => setTimeout(resolve, TPS_POOL_CONFIG.DELAYED_RETRY_DELAY_MS));
      
      let delayedSuccess = 0;
      
      // v7.1: 使用新的虚拟线程池并行执行延后重试，而不是串行逐个重试
      // 延后重试使用更低的并发度（2线程×3并发=6并发），避免再次压夸上游
      const retryThreads: VirtualThread<T, R>[] = [];
      const retryThreadCount = Math.min(2, delayedRetryTasks.length);
      const retryConcurrencyPerThread = 3;
      
      for (let i = 0; i < retryThreadCount; i++) {
        retryThreads.push(new VirtualThread<T, R>(100 + i, retryConcurrencyPerThread));
      }
      
      // 将延后重试任务均匀分配到重试线程
      delayedRetryTasks.forEach((task, index) => {
        const threadIndex = index % retryThreads.length;
        retryThreads[threadIndex].addTask(task);
      });
      
      // 重试结果回调
      const onRetryResult = (result: PoolResult<R>) => {
        if (result.success) {
          results.push(result);
          this.stats.completedTasks++;
          delayedSuccess++;
        } else {
          // 延后重试也失败，标记为最终失败
          results.push({
            id: result.id,
            success: false,
            error: `延后重试后仍失败: ${result.error}`,
          });
          this.stats.failedTasks++;
        }
        
        // 更新进度
        if (this.onProgress) {
          this.onProgress(this.stats);
        }
      };
      
      // 并行执行所有重试线程
      await Promise.all(retryThreads.map(thread => thread.start(onRetryResult)));
      
      this.stats.delayedRetrySuccess = delayedSuccess;
      console.log(`[TPS Pool] 🔄 并行延后重试完成: ${delayedSuccess}/${delayedRetryTasks.length} 成功`);
      
      // 更新进度
      if (this.onProgress) {
        this.onProgress(this.stats);
      }
    }

    return results;
  }
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 创建 TPS 智能并发池并执行任务
 */
export async function executeWithTpsPool<T, R>(
  tasks: PoolTask<T, R>[],
  onProgress?: (stats: PoolStats) => void
): Promise<PoolResult<R>[]> {
  const pool = new TpsSmartConcurrencyPool<T, R>(tasks.length, onProgress);
  return pool.execute(tasks);
}

/**
 * 获取任务规模描述
 */
export function getTpsTaskScaleDescription(taskCount: number): string {
  if (taskCount <= TPS_POOL_CONFIG.SMALL_TASK_THRESHOLD) {
    return `小任务 (${taskCount}条): ${TPS_POOL_CONFIG.SMALL_TASK_THREADS}线程 × ${TPS_POOL_CONFIG.SMALL_TASK_CONCURRENCY}并发 = ${TPS_POOL_CONFIG.SMALL_TASK_THREADS * TPS_POOL_CONFIG.SMALL_TASK_CONCURRENCY}并发`;
  } else if (taskCount <= TPS_POOL_CONFIG.MEDIUM_TASK_THRESHOLD) {
    return `中任务 (${taskCount}条): ${TPS_POOL_CONFIG.MEDIUM_TASK_THREADS}线程 × ${TPS_POOL_CONFIG.MEDIUM_TASK_CONCURRENCY}并发 = ${TPS_POOL_CONFIG.MEDIUM_TASK_THREADS * TPS_POOL_CONFIG.MEDIUM_TASK_CONCURRENCY}并发`;
  } else {
    return `大任务 (${taskCount}条): ${TPS_POOL_CONFIG.LARGE_TASK_THREADS}线程 × ${TPS_POOL_CONFIG.LARGE_TASK_CONCURRENCY}并发 = ${TPS_POOL_CONFIG.LARGE_TASK_THREADS * TPS_POOL_CONFIG.LARGE_TASK_CONCURRENCY}并发`;
  }
}
