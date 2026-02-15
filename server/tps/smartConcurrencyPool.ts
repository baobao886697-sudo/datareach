/**
 * TPS 智能动态并发池 - 已废弃 (v8.0)
 * 
 * 此模块已被 smartPoolExecutor.ts 中的"分批+延迟"模式完全替代。
 * 保留此文件仅为防止其他模块的间接引用导致编译错误。
 * 
 * 新的并发控制逻辑请参见:
 * - smartPoolExecutor.ts: fetchDetailsWithSmartPool() + BATCH_CONFIG
 */

// 保留类型导出以防编译错误
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
  delayedRetryCount?: number;
  delayedRetrySuccess?: number;
}

// 废弃的配置，保留以防间接引用
export const TPS_POOL_CONFIG = {
  MAX_THREADS: 0,
  MAX_CONCURRENCY_PER_THREAD: 0,
  GLOBAL_MAX_CONCURRENCY: 15,  // 仅作为参考值
  SMALL_TASK_THRESHOLD: 50,
  MEDIUM_TASK_THRESHOLD: 150,
  SMALL_TASK_THREADS: 0,
  SMALL_TASK_CONCURRENCY: 0,
  MEDIUM_TASK_THREADS: 0,
  MEDIUM_TASK_CONCURRENCY: 0,
  LARGE_TASK_THREADS: 0,
  LARGE_TASK_CONCURRENCY: 0,
  REQUEST_DELAY_MS: 0,
  ERROR_BACKOFF_MULTIPLIER: 0,
  MAX_ERROR_RATE: 0,
  MAX_RETRIES: 0,
  RETRY_DELAY_MS: 0,
  DELAYED_RETRY_MAX: 0,
  DELAYED_RETRY_DELAY_MS: 0,
};

export function getTpsTaskScaleDescription(taskCount: number): string {
  return `[已废弃] ${taskCount} 条详情将使用分批模式获取`;
}

// 废弃的类，保留空壳防止编译错误
export class TpsSmartConcurrencyPool<T, R> {
  constructor(taskCount: number, onProgress?: (stats: PoolStats) => void) {
    console.warn('[TPS v8.0] TpsSmartConcurrencyPool 已废弃，请使用 fetchDetailsWithSmartPool');
  }
  async execute(tasks: PoolTask<T, R>[]): Promise<PoolResult<R>[]> {
    throw new Error('TpsSmartConcurrencyPool 已废弃');
  }
  stop(): void {}
  getStats(): PoolStats {
    return { totalTasks: 0, completedTasks: 0, failedTasks: 0, activeThreads: 0, currentConcurrency: 0, errorRate: 0, avgResponseTime: 0 };
  }
}

export async function executeWithTpsPool<T, R>(
  tasks: PoolTask<T, R>[],
  onProgress?: (stats: PoolStats) => void
): Promise<PoolResult<R>[]> {
  throw new Error('executeWithTpsPool 已废弃');
}
