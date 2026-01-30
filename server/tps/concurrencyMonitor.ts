/**
 * TPS 并发监控模块 (Concurrency Monitor)
 * 
 * 版本: 1.0
 * 
 * 功能:
 * - 实时监控并发状态
 * - 记录任务执行统计
 * - 提供监控数据 API
 * 
 * 独立模块: 仅用于 TPS 搜索功能
 */

// ============================================================================
// 并发状态接口
// ============================================================================

export interface ConcurrencyStats {
  // 当前状态
  activeThreads: number;           // 活跃线程数
  activeTasks: number;             // 活跃任务数
  queuedTasks: number;             // 排队任务数
  currentConcurrency: number;      // 当前并发数
  
  // 配置信息
  maxThreads: number;              // 最大线程数
  maxConcurrencyPerThread: number; // 每线程最大并发
  globalMaxConcurrency: number;    // 全局最大并发
  
  // 统计信息
  totalTasksProcessed: number;     // 总处理任务数
  totalRequestsCompleted: number;  // 总完成请求数
  totalRequestsFailed: number;     // 总失败请求数
  averageResponseTime: number;     // 平均响应时间 (ms)
  
  // 时间信息
  startTime: number;               // 监控开始时间
  lastUpdateTime: number;          // 最后更新时间
  uptime: number;                  // 运行时间 (秒)
}

export interface TaskStats {
  taskId: string;
  userId: number;
  startTime: number;
  status: 'running' | 'completed' | 'failed';
  totalDetails: number;
  completedDetails: number;
  failedDetails: number;
  creditsUsed: number;
}

// ============================================================================
// 监控状态存储
// ============================================================================

interface MonitorState {
  // 当前状态
  activeThreads: number;
  activeTasks: Map<string, TaskStats>;
  queuedTasks: number;
  currentConcurrency: number;
  
  // 配置信息
  maxThreads: number;
  maxConcurrencyPerThread: number;
  globalMaxConcurrency: number;
  
  // 统计信息
  totalTasksProcessed: number;
  totalRequestsCompleted: number;
  totalRequestsFailed: number;
  totalResponseTime: number;
  responseCount: number;
  
  // 时间信息
  startTime: number;
  lastUpdateTime: number;
}

const monitorState: MonitorState = {
  activeThreads: 0,
  activeTasks: new Map(),
  queuedTasks: 0,
  currentConcurrency: 0,
  
  maxThreads: 4,
  maxConcurrencyPerThread: 10,
  globalMaxConcurrency: 40,
  
  totalTasksProcessed: 0,
  totalRequestsCompleted: 0,
  totalRequestsFailed: 0,
  totalResponseTime: 0,
  responseCount: 0,
  
  startTime: Date.now(),
  lastUpdateTime: Date.now(),
};

// ============================================================================
// 监控 API
// ============================================================================

/**
 * 获取当前并发统计
 */
export function getConcurrencyStats(): ConcurrencyStats {
  const now = Date.now();
  const uptime = Math.floor((now - monitorState.startTime) / 1000);
  const averageResponseTime = monitorState.responseCount > 0 
    ? Math.round(monitorState.totalResponseTime / monitorState.responseCount)
    : 0;
  
  return {
    activeThreads: monitorState.activeThreads,
    activeTasks: monitorState.activeTasks.size,
    queuedTasks: monitorState.queuedTasks,
    currentConcurrency: monitorState.currentConcurrency,
    
    maxThreads: monitorState.maxThreads,
    maxConcurrencyPerThread: monitorState.maxConcurrencyPerThread,
    globalMaxConcurrency: monitorState.globalMaxConcurrency,
    
    totalTasksProcessed: monitorState.totalTasksProcessed,
    totalRequestsCompleted: monitorState.totalRequestsCompleted,
    totalRequestsFailed: monitorState.totalRequestsFailed,
    averageResponseTime,
    
    startTime: monitorState.startTime,
    lastUpdateTime: monitorState.lastUpdateTime,
    uptime,
  };
}

/**
 * 获取活跃任务列表
 */
export function getActiveTasks(): TaskStats[] {
  return Array.from(monitorState.activeTasks.values());
}

/**
 * 更新配置信息
 */
export function updateMonitorConfig(config: {
  maxThreads?: number;
  maxConcurrencyPerThread?: number;
  globalMaxConcurrency?: number;
}): void {
  if (config.maxThreads !== undefined) {
    monitorState.maxThreads = config.maxThreads;
  }
  if (config.maxConcurrencyPerThread !== undefined) {
    monitorState.maxConcurrencyPerThread = config.maxConcurrencyPerThread;
  }
  if (config.globalMaxConcurrency !== undefined) {
    monitorState.globalMaxConcurrency = config.globalMaxConcurrency;
  }
  monitorState.lastUpdateTime = Date.now();
}

// ============================================================================
// 任务生命周期跟踪
// ============================================================================

/**
 * 记录任务开始
 */
export function recordTaskStart(taskId: string, userId: number, totalDetails: number): void {
  monitorState.activeTasks.set(taskId, {
    taskId,
    userId,
    startTime: Date.now(),
    status: 'running',
    totalDetails,
    completedDetails: 0,
    failedDetails: 0,
    creditsUsed: 0,
  });
  monitorState.lastUpdateTime = Date.now();
  
  console.log(`[TPS Monitor] 任务开始: ${taskId}, 用户: ${userId}, 详情数: ${totalDetails}`);
}

/**
 * 记录任务进度
 */
export function recordTaskProgress(taskId: string, completedDetails: number, failedDetails: number, creditsUsed: number): void {
  const task = monitorState.activeTasks.get(taskId);
  if (task) {
    task.completedDetails = completedDetails;
    task.failedDetails = failedDetails;
    task.creditsUsed = creditsUsed;
    monitorState.lastUpdateTime = Date.now();
  }
}

/**
 * 记录任务完成
 */
export function recordTaskComplete(taskId: string, success: boolean): void {
  const task = monitorState.activeTasks.get(taskId);
  if (task) {
    task.status = success ? 'completed' : 'failed';
    monitorState.totalTasksProcessed++;
    monitorState.activeTasks.delete(taskId);
    monitorState.lastUpdateTime = Date.now();
    
    console.log(`[TPS Monitor] 任务${success ? '完成' : '失败'}: ${taskId}, 完成: ${task.completedDetails}, 失败: ${task.failedDetails}`);
  }
}

// ============================================================================
// 并发状态跟踪
// ============================================================================

/**
 * 更新线程状态
 */
export function updateThreadCount(count: number): void {
  monitorState.activeThreads = count;
  monitorState.lastUpdateTime = Date.now();
}

/**
 * 更新并发数
 */
export function updateConcurrency(count: number): void {
  monitorState.currentConcurrency = count;
  monitorState.lastUpdateTime = Date.now();
}

/**
 * 更新排队任务数
 */
export function updateQueuedTasks(count: number): void {
  monitorState.queuedTasks = count;
  monitorState.lastUpdateTime = Date.now();
}

// ============================================================================
// 请求统计跟踪
// ============================================================================

/**
 * 记录请求完成
 */
export function recordRequestComplete(responseTime: number, success: boolean): void {
  if (success) {
    monitorState.totalRequestsCompleted++;
  } else {
    monitorState.totalRequestsFailed++;
  }
  
  monitorState.totalResponseTime += responseTime;
  monitorState.responseCount++;
  monitorState.lastUpdateTime = Date.now();
}

/**
 * 重置统计数据
 */
export function resetStats(): void {
  monitorState.totalTasksProcessed = 0;
  monitorState.totalRequestsCompleted = 0;
  monitorState.totalRequestsFailed = 0;
  monitorState.totalResponseTime = 0;
  monitorState.responseCount = 0;
  monitorState.startTime = Date.now();
  monitorState.lastUpdateTime = Date.now();
  
  console.log('[TPS Monitor] 统计数据已重置');
}

/**
 * 获取监控摘要（用于日志）
 */
export function getMonitorSummary(): string {
  const stats = getConcurrencyStats();
  return `活跃任务: ${stats.activeTasks} | 并发: ${stats.currentConcurrency}/${stats.globalMaxConcurrency} | 完成: ${stats.totalRequestsCompleted} | 失败: ${stats.totalRequestsFailed} | 平均响应: ${stats.averageResponseTime}ms`;
}
