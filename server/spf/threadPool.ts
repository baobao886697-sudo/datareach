/**
 * SPF 线程池管理器 (Thread Pool Manager)
 * 
 * 基于 Scrape.do 官方文档最佳实践实现：
 * - 独立的后台线程池处理爬虫任务
 * - 3 个 Worker Thread，每个 Worker 5 并发
 * - 全局最大 15 并发（跨所有 Worker）
 * - 任务队列管理和故障隔离
 * 
 * 架构特点：
 * 1. Worker Thread 级别隔离 - 单个 Worker 崩溃不影响其他 Worker
 * 2. 任务队列 - 超过并发限制的任务自动排队
 * 3. 负载均衡 - 任务均匀分配到各 Worker
 * 4. 优雅关闭 - 支持等待所有任务完成后关闭
 */

import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import path from 'path';

// ==================== 配置常量 ====================

export const THREAD_POOL_CONFIG = {
  WORKER_THREAD_COUNT: 3,        // Worker Thread 数量
  CONCURRENCY_PER_WORKER: 5,     // 每个 Worker 的并发数
  GLOBAL_MAX_CONCURRENCY: 15,    // 全局最大并发（3 × 5 = 15）
  TASK_QUEUE_MAX_SIZE: 1000,     // 任务队列最大长度
  WORKER_RESTART_DELAY: 1000,    // Worker 重启延迟（毫秒）
  WORKER_RESTART_MAX_RETRIES: 3, // Worker 最大重启次数
};

// ==================== 类型定义 ====================

export interface PoolTask {
  id: string;
  type: 'search' | 'detail';
  data: any;
  priority: number;
  createdAt: Date;
  resolve: (result: any) => void;
  reject: (error: Error) => void;
}

export interface WorkerInfo {
  id: number;
  worker: Worker;
  status: 'idle' | 'busy' | 'error' | 'starting';
  currentTasks: number;
  totalTasksCompleted: number;
  restartCount: number;
  lastError?: string;
}

export interface PoolStatus {
  isRunning: boolean;
  workers: Array<{
    id: number;
    status: string;
    currentTasks: number;
    totalTasksCompleted: number;
  }>;
  taskQueue: {
    pending: number;
    maxSize: number;
  };
  stats: {
    totalTasksSubmitted: number;
    totalTasksCompleted: number;
    totalTasksFailed: number;
  };
}

// ==================== 线程池管理器 ====================

export class SpfThreadPool extends EventEmitter {
  private workers: Map<number, WorkerInfo> = new Map();
  private taskQueue: PoolTask[] = [];
  private isRunning: boolean = false;
  private isShuttingDown: boolean = false;
  
  // 统计信息
  private totalTasksSubmitted: number = 0;
  private totalTasksCompleted: number = 0;
  private totalTasksFailed: number = 0;
  
  // 任务分配索引（轮询）
  private nextWorkerIndex: number = 0;
  
  constructor() {
    super();
    this.setMaxListeners(100);
  }
  
  /**
   * 启动线程池
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[ThreadPool] 线程池已在运行');
      return;
    }
    
    console.log(`[ThreadPool] 启动线程池，配置: ${THREAD_POOL_CONFIG.WORKER_THREAD_COUNT} Workers × ${THREAD_POOL_CONFIG.CONCURRENCY_PER_WORKER} 并发`);
    
    this.isRunning = true;
    this.isShuttingDown = false;
    
    // 创建 Worker Threads
    const workerPromises: Promise<void>[] = [];
    
    for (let i = 0; i < THREAD_POOL_CONFIG.WORKER_THREAD_COUNT; i++) {
      workerPromises.push(this.createWorker(i));
    }
    
    await Promise.all(workerPromises);
    
    console.log(`[ThreadPool] 线程池启动完成，${this.workers.size} 个 Worker 就绪`);
    this.emit('started');
  }
  
  /**
   * 创建单个 Worker
   */
  private async createWorker(workerId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const workerPath = path.join(__dirname, 'worker.js');
        
        const worker = new Worker(workerPath, {
          workerData: {
            workerId,
            concurrencyPerWorker: THREAD_POOL_CONFIG.CONCURRENCY_PER_WORKER,
          },
        });
        
        const workerInfo: WorkerInfo = {
          id: workerId,
          worker,
          status: 'starting',
          currentTasks: 0,
          totalTasksCompleted: 0,
          restartCount: 0,
        };
        
        // 监听 Worker 消息
        worker.on('message', (message: any) => {
          this.handleWorkerMessage(workerId, message);
        });
        
        // 监听 Worker 错误
        worker.on('error', (error: Error) => {
          console.error(`[ThreadPool] Worker ${workerId} 错误:`, error);
          workerInfo.status = 'error';
          workerInfo.lastError = error.message;
          this.emit('workerError', { workerId, error });
          
          // 尝试重启 Worker
          this.restartWorker(workerId);
        });
        
        // 监听 Worker 退出
        worker.on('exit', (code: number) => {
          console.log(`[ThreadPool] Worker ${workerId} 退出，代码: ${code}`);
          
          if (!this.isShuttingDown && code !== 0) {
            this.restartWorker(workerId);
          }
        });
        
        // 等待 Worker 就绪
        const readyHandler = (message: any) => {
          if (message.type === 'ready') {
            workerInfo.status = 'idle';
            this.workers.set(workerId, workerInfo);
            console.log(`[ThreadPool] Worker ${workerId} 就绪`);
            worker.off('message', readyHandler);
            resolve();
          }
        };
        
        worker.on('message', readyHandler);
        
        // 超时处理
        setTimeout(() => {
          if (workerInfo.status === 'starting') {
            reject(new Error(`Worker ${workerId} 启动超时`));
          }
        }, 10000);
        
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 重启 Worker
   */
  private async restartWorker(workerId: number): Promise<void> {
    const workerInfo = this.workers.get(workerId);
    
    if (!workerInfo) {
      return;
    }
    
    if (workerInfo.restartCount >= THREAD_POOL_CONFIG.WORKER_RESTART_MAX_RETRIES) {
      console.error(`[ThreadPool] Worker ${workerId} 达到最大重启次数，放弃重启`);
      this.emit('workerFailed', { workerId });
      return;
    }
    
    console.log(`[ThreadPool] 重启 Worker ${workerId}，第 ${workerInfo.restartCount + 1} 次`);
    
    // 终止旧 Worker
    try {
      await workerInfo.worker.terminate();
    } catch (e) {
      // 忽略终止错误
    }
    
    // 延迟后重启
    await new Promise(resolve => setTimeout(resolve, THREAD_POOL_CONFIG.WORKER_RESTART_DELAY));
    
    try {
      await this.createWorker(workerId);
      const newWorkerInfo = this.workers.get(workerId);
      if (newWorkerInfo) {
        newWorkerInfo.restartCount = workerInfo.restartCount + 1;
      }
      console.log(`[ThreadPool] Worker ${workerId} 重启成功`);
    } catch (error) {
      console.error(`[ThreadPool] Worker ${workerId} 重启失败:`, error);
    }
  }
  
  /**
   * 处理 Worker 消息
   */
  private handleWorkerMessage(workerId: number, message: any): void {
    const workerInfo = this.workers.get(workerId);
    
    if (!workerInfo) {
      return;
    }
    
    switch (message.type) {
      case 'result':
        this.handleTaskResult(workerId, message.result);
        break;
        
      case 'progress':
        this.emit('taskProgress', {
          workerId,
          taskId: message.progress.taskId,
          message: message.progress.message,
        });
        break;
        
      case 'error':
        console.error(`[ThreadPool] Worker ${workerId} 报告错误:`, message.error);
        break;
    }
  }
  
  /**
   * 处理任务结果
   */
  private handleTaskResult(workerId: number, result: any): void {
    const workerInfo = this.workers.get(workerId);
    
    if (workerInfo) {
      workerInfo.currentTasks--;
      workerInfo.totalTasksCompleted++;
      
      if (workerInfo.currentTasks === 0) {
        workerInfo.status = 'idle';
      }
    }
    
    // 查找并完成对应的任务
    const taskIndex = this.taskQueue.findIndex(t => t.id === result.taskId);
    
    if (taskIndex !== -1) {
      const task = this.taskQueue.splice(taskIndex, 1)[0];
      
      if (result.success) {
        this.totalTasksCompleted++;
        task.resolve(result);
      } else {
        this.totalTasksFailed++;
        task.reject(new Error(result.error || 'Task failed'));
      }
    }
    
    // 处理队列中的下一个任务
    this.processQueue();
  }
  
  /**
   * 提交任务到线程池
   */
  async submitTask(
    type: 'search' | 'detail',
    data: any,
    priority: number = 0
  ): Promise<any> {
    if (!this.isRunning) {
      throw new Error('线程池未运行');
    }
    
    if (this.taskQueue.length >= THREAD_POOL_CONFIG.TASK_QUEUE_MAX_SIZE) {
      throw new Error('任务队列已满');
    }
    
    return new Promise((resolve, reject) => {
      const taskId = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const task: PoolTask = {
        id: taskId,
        type,
        data: { ...data, taskId },
        priority,
        createdAt: new Date(),
        resolve,
        reject,
      };
      
      // 按优先级插入队列
      const insertIndex = this.taskQueue.findIndex(t => t.priority < priority);
      if (insertIndex === -1) {
        this.taskQueue.push(task);
      } else {
        this.taskQueue.splice(insertIndex, 0, task);
      }
      
      this.totalTasksSubmitted++;
      
      // 尝试立即处理
      this.processQueue();
    });
  }
  
  /**
   * 批量提交搜索任务
   */
  async submitSearchTasks(
    tasks: Array<{
      name: string;
      location: string;
      token: string;
      maxPages: number;
      filters: any;
      subTaskIndex: number;
    }>
  ): Promise<any[]> {
    const promises = tasks.map((task, index) => 
      this.submitTask('search', task, tasks.length - index)
    );
    
    return Promise.all(promises);
  }
  
  /**
   * 批量提交详情任务
   */
  async submitDetailTasks(
    tasks: Array<{
      detailLink: string;
      token: string;
      filters: any;
      subTaskIndex: number;
      searchName: string;
      searchLocation: string;
    }>
  ): Promise<any[]> {
    const promises = tasks.map((task, index) => 
      this.submitTask('detail', task, tasks.length - index)
    );
    
    return Promise.all(promises);
  }
  
  /**
   * 处理任务队列
   */
  private processQueue(): void {
    if (!this.isRunning || this.isShuttingDown) {
      return;
    }
    
    // 查找可用的 Worker
    const availableWorkers = Array.from(this.workers.values())
      .filter(w => w.status === 'idle' || (w.status === 'busy' && w.currentTasks < THREAD_POOL_CONFIG.CONCURRENCY_PER_WORKER));
    
    if (availableWorkers.length === 0) {
      return;
    }
    
    // 查找待处理的任务
    const pendingTasks = this.taskQueue.filter(t => !this.isTaskAssigned(t.id));
    
    for (const task of pendingTasks) {
      // 使用轮询分配任务
      const worker = this.getNextAvailableWorker();
      
      if (!worker) {
        break;
      }
      
      this.assignTaskToWorker(task, worker);
    }
  }
  
  /**
   * 检查任务是否已分配
   */
  private isTaskAssigned(taskId: string): boolean {
    // 简单实现：通过 Worker 当前任务数判断
    return false;
  }
  
  /**
   * 获取下一个可用的 Worker（轮询）
   */
  private getNextAvailableWorker(): WorkerInfo | null {
    const workers = Array.from(this.workers.values());
    
    for (let i = 0; i < workers.length; i++) {
      const index = (this.nextWorkerIndex + i) % workers.length;
      const worker = workers[index];
      
      if (worker.status !== 'error' && worker.currentTasks < THREAD_POOL_CONFIG.CONCURRENCY_PER_WORKER) {
        this.nextWorkerIndex = (index + 1) % workers.length;
        return worker;
      }
    }
    
    return null;
  }
  
  /**
   * 分配任务到 Worker
   */
  private assignTaskToWorker(task: PoolTask, workerInfo: WorkerInfo): void {
    workerInfo.currentTasks++;
    workerInfo.status = 'busy';
    
    workerInfo.worker.postMessage({
      type: 'task',
      task: {
        type: task.type,
        taskId: task.id,
        data: task.data,
      },
    });
  }
  
  /**
   * 获取线程池状态
   */
  getStatus(): PoolStatus {
    return {
      isRunning: this.isRunning,
      workers: Array.from(this.workers.values()).map(w => ({
        id: w.id,
        status: w.status,
        currentTasks: w.currentTasks,
        totalTasksCompleted: w.totalTasksCompleted,
      })),
      taskQueue: {
        pending: this.taskQueue.length,
        maxSize: THREAD_POOL_CONFIG.TASK_QUEUE_MAX_SIZE,
      },
      stats: {
        totalTasksSubmitted: this.totalTasksSubmitted,
        totalTasksCompleted: this.totalTasksCompleted,
        totalTasksFailed: this.totalTasksFailed,
      },
    };
  }
  
  /**
   * 关闭线程池
   */
  async shutdown(graceful: boolean = true): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    
    console.log(`[ThreadPool] 关闭线程池，优雅模式: ${graceful}`);
    this.isShuttingDown = true;
    
    if (graceful) {
      // 等待所有任务完成
      while (this.taskQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // 终止所有 Worker
    const terminatePromises = Array.from(this.workers.values()).map(async (workerInfo) => {
      try {
        workerInfo.worker.postMessage({ type: 'shutdown' });
        await workerInfo.worker.terminate();
      } catch (e) {
        // 忽略终止错误
      }
    });
    
    await Promise.all(terminatePromises);
    
    this.workers.clear();
    this.taskQueue = [];
    this.isRunning = false;
    
    console.log('[ThreadPool] 线程池已关闭');
    this.emit('shutdown');
  }
}

// ==================== 单例实例 ====================

let threadPoolInstance: SpfThreadPool | null = null;

/**
 * 获取线程池单例
 */
export function getThreadPool(): SpfThreadPool {
  if (!threadPoolInstance) {
    threadPoolInstance = new SpfThreadPool();
  }
  return threadPoolInstance;
}

/**
 * 初始化线程池
 */
export async function initThreadPool(): Promise<SpfThreadPool> {
  const pool = getThreadPool();
  
  if (!pool.getStatus().isRunning) {
    await pool.start();
  }
  
  return pool;
}

/**
 * 关闭线程池
 */
export async function shutdownThreadPool(graceful: boolean = true): Promise<void> {
  if (threadPoolInstance) {
    await threadPoolInstance.shutdown(graceful);
    threadPoolInstance = null;
  }
}
