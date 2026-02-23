/**
 * 全局搜索任务队列 v1.2
 * 
 * 🛡️ 防止多个搜索任务同时运行导致内存溢出（OOM）
 * 
 * 核心设计:
 * - 全局最多同时运行 MAX_CONCURRENT_TASKS 个搜索任务（TPS/SPF/Anywho 共享）
 * - 超出限制的任务进入排队等待，按提交顺序依次执行
 * - 排队中的任务状态为 "queued"，用户可以在前端看到排队位置
 * - 任务完成或失败后自动释放槽位，触发下一个排队任务
 * - 排队超时保护：排队超过 MAX_QUEUE_WAIT_MS 自动标记为失败
 * 
 * v1.2 变更:
 * - 移除 2小时硬超时（避免误杀大任务，如100×100=10000个搜索组合）
 * - 任务卡死检测完全交给看门狗（每5分钟检测，30分钟无进度 → 标记失败）
 * - 保留 AbortController，暴露 abortTask() 方法供看门狗调用终止任务
 * - 看门狗发现卡死任务后，调用 abortTask() 通知任务停止执行
 * 
 * 使用方式:
 * ```ts
 * import { globalTaskQueue } from '../_core/taskQueue';
 * 
 * // 提交任务
 * globalTaskQueue.enqueue({
 *   taskDbId: task.id,
 *   taskId: task.taskId,
 *   userId,
 *   module: 'tps',
 *   execute: async (signal) => { ... 可检查 signal.aborted ... }
 * });
 * 
 * // 看门狗发现卡死时调用
 * globalTaskQueue.abortTask(taskId);
 * ```
 */

import { getDbSync } from '../db';
import { sql } from 'drizzle-orm';

// ============================================================================
// 配置
// ============================================================================

/** 全局最大并发搜索任务数（TPS/SPF/Anywho 共享）
 * 内存评估: 15个任务 × 23MB(流式保存) = 345MB，远低于8GB上限
 * HTTP评估: 15个任务共享180个HTTP并发信号量，每任务详情阶段30并发 = 峰值450，受信号量限制为180
 */
const MAX_CONCURRENT_TASKS = 15;

/** BUG-17: 排队最大等待时间（毫秒）：30分钟 */
const MAX_QUEUE_WAIT_MS = 30 * 60 * 1000;

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
  module: 'tps' | 'spf' | 'anywho';
  /** 实际执行函数（可选接收 AbortSignal 用于终止） */
  execute: (signal?: AbortSignal) => Promise<void>;
  /** 入队时间 */
  enqueuedAt: number;
}

interface RunningTask {
  taskDbId: number;
  taskId: string;
  userId: number;
  module: string;
  startedAt: number;
  /** AbortController 用于看门狗发现卡死时通知任务停止 */
  abortController: AbortController;
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
   * 外部终止任务（供看门狗调用）
   * 
   * 看门狗发现任务30分钟无进度后，调用此方法：
   * 1. 发送 AbortSignal 通知任务内部停止
   * 2. 30秒兜底：如果任务仍未结束，强制从 running 中移除释放槽位
   * 
   * 注意：数据库状态由看门狗自己更新，这里只负责终止执行和释放槽位
   */
  abortTask(taskId: string): boolean {
    const runningTask = this.running.get(taskId);
    if (!runningTask) {
      return false;
    }
    
    console.log(`[TaskQueue] 收到终止指令，任务 ${taskId} (${runningTask.module})，发送 AbortSignal`);
    
    // 发送终止信号，通知任务内部停止执行
    runningTask.abortController.abort();
    
    // 兜底：30秒后如果任务仍未结束，强制清理释放槽位
    setTimeout(() => {
      if (this.running.has(taskId)) {
        console.error(`[TaskQueue] ⚠️ 任务 ${taskId} 终止信号发送后 30s 仍未结束，强制清理`);
        this.running.delete(taskId);
        this.processNext();
      }
    }, 30000);
    
    return true;
  }
  
  /**
   * 启动一个任务
   * 
   * v1.2: 不再设置硬超时定时器，任务卡死检测完全交给看门狗
   */
  private startTask(task: QueuedTask) {
    // 创建 AbortController，供看门狗发现卡死时调用 abortTask() 终止
    const abortController = new AbortController();
    
    // 记录为运行中（不再设置超时定时器）
    this.running.set(task.taskId, {
      taskDbId: task.taskDbId,
      taskId: task.taskId,
      userId: task.userId,
      module: task.module,
      startedAt: Date.now(),
      abortController,
    });
    
    console.log(`[TaskQueue] 任务 ${task.taskId} (${task.module}) 开始执行，当前运行 ${this.running.size}/${MAX_CONCURRENT_TASKS}`);
    
    // 执行任务（异步，不阻塞队列），传入 AbortSignal
    task.execute(abortController.signal)
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
      this.running.delete(taskId);
      
      const duration = Math.round((Date.now() - runningTask.startedAt) / 1000);
      console.log(`[TaskQueue] 任务 ${taskId} 完成，耗时 ${duration}s，当前运行 ${this.running.size}/${MAX_CONCURRENT_TASKS}，排队 ${this.queue.length}`);
    }
    
    // 触发下一个排队任务
    this.processNext();
  }
  
  /**
   * 处理下一个排队任务
   * BUG-17修复：添加排队超时检查
   */
  private processNext() {
    while (this.running.size < MAX_CONCURRENT_TASKS && this.queue.length > 0) {
      const nextTask = this.queue.shift()!;
      const waitTime = Date.now() - nextTask.enqueuedAt;
      const waitTimeSec = Math.round(waitTime / 1000);
      
      // BUG-17: 检查排队是否超时
      if (waitTime > MAX_QUEUE_WAIT_MS) {
        console.error(`[TaskQueue] ⚠️ 排队任务 ${nextTask.taskId} (${nextTask.module}) 等待超时（${waitTimeSec}s），标记为失败`);
        this.handleQueueTimeout(nextTask);
        continue;  // 跳过这个任务，处理下一个
      }
      
      console.log(`[TaskQueue] 排队任务 ${nextTask.taskId} (${nextTask.module}) 开始执行，等待了 ${waitTimeSec}s`);
      this.startTask(nextTask);
    }
  }
  
  /**
   * BUG-17: 处理排队超时的任务
   */
  private async handleQueueTimeout(task: QueuedTask) {
    try {
      const db = getDbSync();
      if (db) {
        const tableMap: Record<string, string> = {
          tps: 'tps_search_tasks',
          spf: 'spf_search_tasks',
          anywho: 'anywho_search_tasks',
        };
        const table = tableMap[task.module];
        if (table) {
          await db.execute(
            sql`UPDATE ${sql.raw(table)} SET status = 'failed', completedAt = NOW() WHERE id = ${task.taskDbId} AND status IN ('queued', 'pending')`
          );
        }
      }
    } catch (err: any) {
      console.error(`[TaskQueue] 排队超时任务状态更新失败:`, err.message);
    }
  }
}

// 导出全局单例
export const globalTaskQueue = new GlobalTaskQueue();
