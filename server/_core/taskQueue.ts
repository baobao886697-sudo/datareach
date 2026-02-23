/**
 * 全局搜索任务队列 v1.0
 * 
 * 🛡️ 防止多个搜索任务同时运行导致内存溢出（OOM）
 * 
 * 核心设计:
 * - 全局最多同时运行 MAX_CONCURRENT_TASKS 个搜索任务（TPS/SPF/Anywho 共享）
 * - 超出限制的任务进入排队等待，按提交顺序依次执行
 * - 排队中的任务状态为 "queued"，用户可以在前端看到排队位置
 * - 任务完成或失败后自动释放槽位，触发下一个排队任务
 * - 支持任务超时保护：超过 MAX_TASK_DURATION_MS 自动标记为失败
 * 
 * 使用方式:
 * ```ts
 * import { globalTaskQueue } from '../_core/taskQueue';
 * 
 * // 在搜索 mutation 中，替换直接调用为队列提交
 * globalTaskQueue.enqueue({
 *   taskDbId: task.id,
 *   taskId: task.taskId,
 *   userId,
 *   module: 'tps',
 *   execute: async () => { ... 原来的异步执行函数 ... }
 * });
 * ```
 */

import { getDbSync } from '../db';
import { sql } from 'drizzle-orm';

// ============================================================================
// 配置
// ============================================================================

/** 全局最大并发搜索任务数（TPS/SPF/Anywho 共享） */
const MAX_CONCURRENT_TASKS = 5;

/** 单个任务最大执行时间（毫秒）：2小时 */
const MAX_TASK_DURATION_MS = 2 * 60 * 60 * 1000;

// ============================================================================
// 类型定义
// ============================================================================

export interface QueuedTask {
  /** 数据库中的任务ID */
  taskDbId: number;
  /** 前端使用的任务ID */
  taskId: string;
  /** 用户ID */
  userId: number;
  /** 搜索模块类型 */
  module: 'tps' | 'spf' | 'anywho' | 'batch';
  /** 实际执行函数 */
  execute: () => Promise<void>;
  /** 入队时间 */
  enqueuedAt: number;
}

interface RunningTask {
  taskDbId: number;
  taskId: string;
  userId: number;
  module: string;
  startedAt: number;
  timeoutTimer: ReturnType<typeof setTimeout>;
}

// ============================================================================
// 全局任务队列
// ============================================================================

class GlobalTaskQueue {
  private queue: QueuedTask[] = [];
  private running: Map<string, RunningTask> = new Map(); // key: taskId
  
  /**
   * 提交任务到队列
   * 
   * 如果有空闲槽位，立即执行；否则排队等待。
   */
  enqueue(task: QueuedTask): { queued: boolean; position: number } {
    if (this.running.size < MAX_CONCURRENT_TASKS) {
      // 有空闲槽位，立即执行
      this.startTask(task);
      return { queued: false, position: 0 };
    }
    
    // 没有空闲槽位，加入队列
    this.queue.push(task);
    const position = this.queue.length;
    console.log(`[TaskQueue] 任务 ${task.taskId} (${task.module}) 进入排队，位置 #${position}，当前运行 ${this.running.size}/${MAX_CONCURRENT_TASKS}`);
    
    return { queued: true, position };
  }
  
  /**
   * 获取当前队列状态
   */
  getStatus() {
    return {
      running: this.running.size,
      queued: this.queue.length,
      maxConcurrent: MAX_CONCURRENT_TASKS,
      runningTasks: Array.from(this.running.values()).map(t => ({
        taskId: t.taskId,
        userId: t.userId,
        module: t.module,
        runningFor: Math.round((Date.now() - t.startedAt) / 1000),
      })),
      queuedTasks: this.queue.map((t, i) => ({
        taskId: t.taskId,
        userId: t.userId,
        module: t.module,
        waitingFor: Math.round((Date.now() - t.enqueuedAt) / 1000),
        position: i + 1,
      })),
    };
  }
  
  /**
   * 启动一个任务
   */
  private startTask(task: QueuedTask) {
    // 设置超时保护
    const timeoutTimer = setTimeout(() => {
      this.handleTaskTimeout(task.taskId);
    }, MAX_TASK_DURATION_MS);
    
    // 记录为运行中
    this.running.set(task.taskId, {
      taskDbId: task.taskDbId,
      taskId: task.taskId,
      userId: task.userId,
      module: task.module,
      startedAt: Date.now(),
      timeoutTimer,
    });
    
    console.log(`[TaskQueue] 任务 ${task.taskId} (${task.module}) 开始执行，当前运行 ${this.running.size}/${MAX_CONCURRENT_TASKS}`);
    
    // 执行任务（异步，不阻塞队列）
    task.execute()
      .catch(err => {
        console.error(`[TaskQueue] 任务 ${task.taskId} 执行异常:`, err.message);
      })
      .finally(() => {
        this.completeTask(task.taskId);
      });
  }
  
  /**
   * 任务完成（成功或失败），释放槽位并触发下一个
   */
  private completeTask(taskId: string) {
    const runningTask = this.running.get(taskId);
    if (runningTask) {
      clearTimeout(runningTask.timeoutTimer);
      this.running.delete(taskId);
      
      const duration = Math.round((Date.now() - runningTask.startedAt) / 1000);
      console.log(`[TaskQueue] 任务 ${taskId} 完成，耗时 ${duration}s，当前运行 ${this.running.size}/${MAX_CONCURRENT_TASKS}，排队 ${this.queue.length}`);
    }
    
    // 触发下一个排队任务
    this.processNext();
  }
  
  /**
   * 处理下一个排队任务
   */
  private processNext() {
    while (this.running.size < MAX_CONCURRENT_TASKS && this.queue.length > 0) {
      const nextTask = this.queue.shift()!;
      const waitTime = Math.round((Date.now() - nextTask.enqueuedAt) / 1000);
      console.log(`[TaskQueue] 排队任务 ${nextTask.taskId} (${nextTask.module}) 开始执行，等待了 ${waitTime}s`);
      this.startTask(nextTask);
    }
  }
  
  /**
   * 处理任务超时
   */
  private async handleTaskTimeout(taskId: string) {
    const runningTask = this.running.get(taskId);
    if (!runningTask) return;
    
    console.error(`[TaskQueue] ⚠️ 任务 ${taskId} 超时（超过 ${MAX_TASK_DURATION_MS / 60000} 分钟），强制标记为失败`);
    
    // 更新数据库状态
    try {
      const db = getDbSync();
      if (db) {
        const tableMap: Record<string, string> = {
          tps: 'tps_search_tasks',
          spf: 'spf_search_tasks',
          anywho: 'anywho_search_tasks',
          batch: 'batch_search_tasks',
        };
        const table = tableMap[runningTask.module];
        if (table) {
          await db.execute(
            sql`UPDATE ${sql.raw(table)} SET status = 'failed', completedAt = NOW() WHERE id = ${runningTask.taskDbId} AND status = 'running'`
          );
        }
      }
    } catch (err: any) {
      console.error(`[TaskQueue] 超时任务状态更新失败:`, err.message);
    }
    
    // 从运行列表中移除并触发下一个
    this.running.delete(taskId);
    this.processNext();
  }
}

// 导出全局单例
export const globalTaskQueue = new GlobalTaskQueue();
