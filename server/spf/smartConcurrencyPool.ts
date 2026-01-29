/**
 * SPF 智能动态并发池 (Smart Concurrency Pool)
 * 
 * 版本: 5.0
 * 
 * 核心特性:
 * - 2 虚拟线程 × 8 并发 = 最大 16 并发
 * - 智能任务规模评估，动态调整并发数
 * - 错误回退机制，保护 API
 * - 负载均衡，任务均匀分配
 * 
 * 独立模块: 仅用于 SPF 搜索功能
 */

// ============================================================================
// 配置参数
// ============================================================================

export const SPF_POOL_CONFIG = {
  // 线程配置 (2×8=16)
  MAX_THREADS: 2,                    // 最大虚拟线程数
  MAX_CONCURRENCY_PER_THREAD: 8,     // 每线程最大并发数
  GLOBAL_MAX_CONCURRENCY: 16,        // 全局最大并发 (2 × 8 = 16)
  
  // 任务规模阈值
  SMALL_TASK_THRESHOLD: 5,           // 小任务: ≤5 页
  MEDIUM_TASK_THRESHOLD: 15,         // 中任务: 6-15 页
  // 大任务: 16-25 页
  
  // 动态并发配置 (SPF 专用: 2×8=16)
  SMALL_TASK_THREADS: 1,             // 小任务线程数
  SMALL_TASK_CONCURRENCY: 4,         // 小任务每线程并发 (1×4=4)
  MEDIUM_TASK_THREADS: 1,            // 中任务线程数
  MEDIUM_TASK_CONCURRENCY: 8,        // 中任务每线程并发 (1×8=8)
  LARGE_TASK_THREADS: 2,             // 大任务线程数
  LARGE_TASK_CONCURRENCY: 8,         // 大任务每线程并发 (2×8=16)
  
  // 速率限制
  REQUEST_DELAY_MS: 200,             // 请求间隔 (毫秒)
  ERROR_BACKOFF_MULTIPLIER: 2,       // 错误回退倍数
  MAX_ERROR_RATE: 0.1,               // 最大错误率 (10%)
  
  // 重试配置
  MAX_RETRIES: 2,                    // 最大重试次数
  RETRY_DELAY_MS: 1000,              // 重试延迟 (毫秒)
};

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
    const promises: Promise<void>[] = [];

    while ((this.taskQueue.length > 0 || promises.length > 0) && !this.shouldStop) {
      // 启动新任务
      while (this.taskQueue.length > 0 && this.semaphore.available() > 0 && !this.shouldStop) {
        const task = this.taskQueue.shift()!;
        const promise = this.executeTask(task, onResult);
        promises.push(promise);
        
        // 请求间隔
        await this.delay(SPF_POOL_CONFIG.REQUEST_DELAY_MS);
      }

      // 等待至少一个任务完成
      if (promises.length > 0) {
        await Promise.race(promises);
        // 移除已完成的 promises
        for (let i = promises.length - 1; i >= 0; i--) {
          const p = promises[i];
          const status = await Promise.race([p.then(() => 'resolved'), Promise.resolve('pending')]);
          if (status === 'resolved') {
            promises.splice(i, 1);
          }
        }
      }
    }

    // 等待所有剩余任务完成
    await Promise.all(promises);
    this.isRunning = false;
  }

  private async executeTask(task: PoolTask<T, R>, onResult: (result: PoolResult<R>) => void): Promise<void> {
    await this.semaphore.acquire();
    const startTime = Date.now();
    
    try {
      let lastError: Error | null = null;
      
      for (let retry = 0; retry <= SPF_POOL_CONFIG.MAX_RETRIES; retry++) {
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
          if (retry < SPF_POOL_CONFIG.MAX_RETRIES) {
            await this.delay(SPF_POOL_CONFIG.RETRY_DELAY_MS * Math.pow(SPF_POOL_CONFIG.ERROR_BACKOFF_MULTIPLIER, retry));
          }
        }
      }
      
      // 所有重试都失败
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

export class SpfSmartConcurrencyPool<T, R> {
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
    };

    // 创建虚拟线程
    for (let i = 0; i < this.dynamicConfig.threads; i++) {
      this.threads.push(new VirtualThread<T, R>(i, this.dynamicConfig.concurrencyPerThread));
    }

    console.log(`[SPF Pool] 初始化智能并发池: ${this.dynamicConfig.threads} 线程 × ${this.dynamicConfig.concurrencyPerThread} 并发 = ${this.dynamicConfig.totalConcurrency} 总并发`);
  }

  /**
   * 评估任务规模，返回最优配置
   */
  private evaluateTaskScale(taskCount: number): DynamicConfig {
    const pageCount = Math.ceil(taskCount / 10); // 假设每页 10 条

    if (pageCount <= SPF_POOL_CONFIG.SMALL_TASK_THRESHOLD) {
      // 小任务
      return {
        threads: SPF_POOL_CONFIG.SMALL_TASK_THREADS,
        concurrencyPerThread: SPF_POOL_CONFIG.SMALL_TASK_CONCURRENCY,
        totalConcurrency: SPF_POOL_CONFIG.SMALL_TASK_THREADS * SPF_POOL_CONFIG.SMALL_TASK_CONCURRENCY,
      };
    } else if (pageCount <= SPF_POOL_CONFIG.MEDIUM_TASK_THRESHOLD) {
      // 中任务
      return {
        threads: SPF_POOL_CONFIG.MEDIUM_TASK_THREADS,
        concurrencyPerThread: SPF_POOL_CONFIG.MEDIUM_TASK_CONCURRENCY,
        totalConcurrency: SPF_POOL_CONFIG.MEDIUM_TASK_THREADS * SPF_POOL_CONFIG.MEDIUM_TASK_CONCURRENCY,
      };
    } else {
      // 大任务
      return {
        threads: SPF_POOL_CONFIG.LARGE_TASK_THREADS,
        concurrencyPerThread: SPF_POOL_CONFIG.LARGE_TASK_CONCURRENCY,
        totalConcurrency: SPF_POOL_CONFIG.LARGE_TASK_THREADS * SPF_POOL_CONFIG.LARGE_TASK_CONCURRENCY,
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
   * 执行所有任务
   */
  async execute(tasks: PoolTask<T, R>[]): Promise<PoolResult<R>[]> {
    const results: PoolResult<R>[] = [];
    
    // 负载均衡: 将任务均匀分配到各线程
    tasks.forEach((task, index) => {
      const threadIndex = index % this.threads.length;
      this.threads[threadIndex].addTask(task);
    });

    console.log(`[SPF Pool] 开始执行 ${tasks.length} 个任务，分配到 ${this.threads.length} 个线程`);

    // 结果回调
    const onResult = (result: PoolResult<R>) => {
      results.push(result);
      if (result.success) {
        this.stats.completedTasks++;
      } else {
        this.stats.failedTasks++;
      }
      this.stats.errorRate = this.stats.failedTasks / (this.stats.completedTasks + this.stats.failedTasks);
      
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

    // 并行启动所有线程
    await Promise.all(this.threads.map(thread => thread.start(onResult)));

    console.log(`[SPF Pool] 执行完成: 成功 ${this.stats.completedTasks}, 失败 ${this.stats.failedTasks}, 错误率 ${(this.stats.errorRate * 100).toFixed(1)}%`);

    return results;
  }
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 创建 SPF 智能并发池并执行任务
 */
export async function executeWithSpfPool<T, R>(
  tasks: PoolTask<T, R>[],
  onProgress?: (stats: PoolStats) => void
): Promise<PoolResult<R>[]> {
  const pool = new SpfSmartConcurrencyPool<T, R>(tasks.length, onProgress);
  return pool.execute(tasks);
}

/**
 * 获取任务规模描述
 */
export function getTaskScaleDescription(taskCount: number): string {
  const pageCount = Math.ceil(taskCount / 10);
  
  if (pageCount <= SPF_POOL_CONFIG.SMALL_TASK_THRESHOLD) {
    return `小任务 (${pageCount}页): ${SPF_POOL_CONFIG.SMALL_TASK_THREADS}线程 × ${SPF_POOL_CONFIG.SMALL_TASK_CONCURRENCY}并发`;
  } else if (pageCount <= SPF_POOL_CONFIG.MEDIUM_TASK_THRESHOLD) {
    return `中任务 (${pageCount}页): ${SPF_POOL_CONFIG.MEDIUM_TASK_THREADS}线程 × ${SPF_POOL_CONFIG.MEDIUM_TASK_CONCURRENCY}并发`;
  } else {
    return `大任务 (${pageCount}页): ${SPF_POOL_CONFIG.LARGE_TASK_THREADS}线程 × ${SPF_POOL_CONFIG.LARGE_TASK_CONCURRENCY}并发`;
  }
}
