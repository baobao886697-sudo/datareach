/**
 * SPF 配置文件
 * 
 * 统一管理 SPF 模块的所有配置参数
 * 
 * 基于 Scrape.do 官方文档最佳实践：
 * - 线程池 + 并发模式
 * - 3 个 Worker Thread，每个 Worker 5 并发
 * - 全局最大 15 并发
 */

// ==================== 线程池配置 ====================

/**
 * 线程池配置
 * 
 * 架构说明：
 * - WORKER_THREAD_COUNT: Worker Thread 数量
 * - CONCURRENCY_PER_WORKER: 每个 Worker 的并发数
 * - GLOBAL_MAX_CONCURRENCY: 全局最大并发（WORKER_THREAD_COUNT × CONCURRENCY_PER_WORKER）
 */
export const THREAD_POOL_CONFIG = {
  /** Worker Thread 数量 */
  WORKER_THREAD_COUNT: 3,
  
  /** 每个 Worker 的并发数 */
  CONCURRENCY_PER_WORKER: 5,
  
  /** 全局最大并发（3 × 5 = 15） */
  GLOBAL_MAX_CONCURRENCY: 15,
  
  /** 任务队列最大长度 */
  TASK_QUEUE_MAX_SIZE: 1000,
  
  /** Worker 重启延迟（毫秒） */
  WORKER_RESTART_DELAY: 1000,
  
  /** Worker 最大重启次数 */
  WORKER_RESTART_MAX_RETRIES: 3,
};

// ==================== 搜索配置 ====================

/**
 * SPF 搜索配置
 */
export const SPF_SEARCH_CONFIG = {
  /** 最大搜索页数（网站上限） */
  MAX_SAFE_PAGES: 25,
  
  /** 每个任务最大详情数 (25页 × 10条/页) */
  MAX_DETAILS_PER_TASK: 250,
  
  /** 搜索页成本（每次 API 调用） */
  SEARCH_COST: 0.85,
  
  /** 详情页成本（每次 API 调用） */
  DETAIL_COST: 0.85,
  
  /** 默认最小年龄 */
  DEFAULT_MIN_AGE: 50,
  
  /** 默认最大年龄 */
  DEFAULT_MAX_AGE: 79,
  
  /** 缓存天数 */
  CACHE_DAYS: 180,
};

// ==================== Scrape.do API 配置 ====================

/**
 * Scrape.do API 配置
 */
export const SCRAPEDO_CONFIG = {
  /** 请求超时（毫秒） */
  TIMEOUT_MS: 10000,
  
  /** 最大重试次数 */
  MAX_RETRIES: 2,
  
  /** 重试延迟基数（毫秒） */
  RETRY_DELAY_BASE: 3000,
  
  /** 请求间延迟（毫秒） */
  REQUEST_DELAY: 500,
  
  /** 使用住宅代理 */
  USE_SUPER: true,
  
  /** 地理位置代码 */
  GEO_CODE: 'us',
};

// ==================== 兼容旧配置 ====================

/**
 * 兼容旧的 SPF_CONFIG 导出
 * 
 * @deprecated 请使用 THREAD_POOL_CONFIG 和 SPF_SEARCH_CONFIG
 */
export const SPF_CONFIG = {
  // 线程池配置
  TASK_CONCURRENCY: THREAD_POOL_CONFIG.WORKER_THREAD_COUNT,
  SCRAPEDO_CONCURRENCY: THREAD_POOL_CONFIG.CONCURRENCY_PER_WORKER,
  TOTAL_CONCURRENCY: THREAD_POOL_CONFIG.GLOBAL_MAX_CONCURRENCY,
  
  // 搜索配置
  MAX_SAFE_PAGES: SPF_SEARCH_CONFIG.MAX_SAFE_PAGES,
  MAX_DETAILS_PER_TASK: SPF_SEARCH_CONFIG.MAX_DETAILS_PER_TASK,
  SEARCH_COST: SPF_SEARCH_CONFIG.SEARCH_COST,
  DETAIL_COST: SPF_SEARCH_CONFIG.DETAIL_COST,
};

// ==================== 运行模式 ====================

/**
 * SPF 运行模式
 * 
 * - 'thread_pool': 线程池 + 并发模式（推荐，基于 Scrape.do 最佳实践）
 * - 'async_only': 纯异步并发模式（旧模式，兼容性）
 */
export type SpfRunMode = 'thread_pool' | 'async_only';

/**
 * 当前运行模式
 * 
 * 设置为 'thread_pool' 启用线程池模式
 * 设置为 'async_only' 使用旧的纯异步模式
 */
export const CURRENT_RUN_MODE: SpfRunMode = 'async_only';

/**
 * 是否启用线程池模式
 */
export function isThreadPoolEnabled(): boolean {
  return CURRENT_RUN_MODE === 'thread_pool';
}

// ==================== 日志配置 ====================

/**
 * 日志配置
 */
export const LOG_CONFIG = {
  /** 是否启用详细日志 */
  VERBOSE: false,
  
  /** 日志前缀 */
  PREFIX: '[SPF]',
  
  /** 是否记录 API 调用 */
  LOG_API_CALLS: true,
  
  /** 是否记录缓存命中 */
  LOG_CACHE_HITS: true,
};

// ==================== 导出所有配置 ====================

export default {
  THREAD_POOL_CONFIG,
  SPF_SEARCH_CONFIG,
  SCRAPEDO_CONFIG,
  SPF_CONFIG,
  CURRENT_RUN_MODE,
  LOG_CONFIG,
};
