/**
 * 全局 HTTP 并发信号量 (Global HTTP Semaphore)
 * 
 * 版本: 1.0
 * 
 * 功能:
 * - 限制整个系统的最大并发 HTTP 请求数
 * - 所有模块 (TPS/SPF/Anywho) 共享同一个信号量
 * - 当并发达到上限时，新请求自动排队等待
 * - 防止内存溢出 (OOM) 导致进程崩溃
 * 
 * 设计原则:
 * - 全局单例，进程内唯一
 * - 无锁设计，基于 Promise 队列
 * - 公平调度，先到先得 (FIFO)
 */

// ============================================================================
// 信号量配置
// ============================================================================

/**
 * 全局最大并发 HTTP 请求数
 * 
 * 计算依据:
 * - 每个 HTTP 请求峰值内存 ≈ 2-5MB (HTML 响应 + 解析)
 * - 60 并发 × 5MB = 300MB 峰值，在 8GB 限制下非常安全
 * - 即使 20 个用户同时运行任务，总并发也不会超过 60
 */
const GLOBAL_MAX_CONCURRENT_HTTP = 60;

// ============================================================================
// 信号量实现
// ============================================================================

class HttpSemaphore {
  private maxConcurrent: number;
  private currentCount: number = 0;
  private waitQueue: Array<() => void> = [];

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * 获取一个信号量许可
   * 如果当前并发数已达上限，会自动排队等待
   */
  async acquire(): Promise<void> {
    if (this.currentCount < this.maxConcurrent) {
      this.currentCount++;
      return;
    }

    // 排队等待
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.currentCount++;
        resolve();
      });
    });
  }

  /**
   * 释放一个信号量许可
   * 如果有等待中的请求，会立即唤醒队首
   */
  release(): void {
    this.currentCount--;

    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      // 使用 queueMicrotask 确保在当前事件循环结束后执行
      // 避免栈溢出和保证公平性
      queueMicrotask(next);
    }
  }

  /**
   * 获取当前并发数（用于监控）
   */
  getCurrentCount(): number {
    return this.currentCount;
  }

  /**
   * 获取等待队列长度（用于监控）
   */
  getWaitingCount(): number {
    return this.waitQueue.length;
  }

  /**
   * 获取最大并发数
   */
  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  /**
   * 动态调整最大并发数（运行时可调）
   */
  setMaxConcurrent(newMax: number): void {
    const oldMax = this.maxConcurrent;
    this.maxConcurrent = newMax;

    // 如果增大了上限，唤醒等待中的请求
    if (newMax > oldMax) {
      const toRelease = Math.min(newMax - oldMax, this.waitQueue.length);
      for (let i = 0; i < toRelease; i++) {
        const next = this.waitQueue.shift()!;
        this.currentCount++;
        queueMicrotask(next);
      }
    }

    console.log(`[HttpSemaphore] 最大并发数调整: ${oldMax} → ${newMax}`);
  }
}

// ============================================================================
// 全局单例
// ============================================================================

/** 全局 HTTP 并发信号量实例（进程内唯一） */
export const globalHttpSemaphore = new HttpSemaphore(GLOBAL_MAX_CONCURRENT_HTTP);

// ============================================================================
// 便捷包装函数
// ============================================================================

/**
 * 在全局信号量保护下执行异步操作
 * 
 * 使用方式:
 * ```typescript
 * const html = await withHttpSemaphore(() => fetch(url));
 * ```
 * 
 * @param fn 需要执行的异步操作
 * @returns 异步操作的结果
 */
export async function withHttpSemaphore<T>(fn: () => Promise<T>): Promise<T> {
  await globalHttpSemaphore.acquire();
  try {
    return await fn();
  } finally {
    globalHttpSemaphore.release();
  }
}

/**
 * 获取信号量状态摘要（用于日志和监控）
 */
export function getHttpSemaphoreStatus(): string {
  return `HTTP并发: ${globalHttpSemaphore.getCurrentCount()}/${globalHttpSemaphore.getMaxConcurrent()} (等待: ${globalHttpSemaphore.getWaitingCount()})`;
}
