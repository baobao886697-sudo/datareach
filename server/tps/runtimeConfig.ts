/**
 * TPS 运行时配置模块 (Runtime Config)
 * 
 * 版本: 1.0
 * 
 * 功能:
 * - 从数据库动态读取配置
 * - 配置缓存机制（减少数据库查询）
 * - 配置验证和默认值回退
 * - 支持管理后台动态修改
 * 
 * 独立模块: 仅用于 TPS 搜索功能
 */

import { getDb, getConfig } from "../db";
import { systemConfigs } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

// ============================================================================
// 默认配置值（与 smartConcurrencyPool.ts 保持一致）
// ============================================================================

const DEFAULT_CONFIG = {
  // 线程池配置
  MAX_THREADS: 4,
  MAX_CONCURRENCY_PER_THREAD: 10,
  GLOBAL_MAX_CONCURRENCY: 40,
  
  // 任务规模阈值
  SMALL_TASK_THRESHOLD: 50,
  MEDIUM_TASK_THRESHOLD: 150,
  
  // 动态并发配置
  SMALL_TASK_THREADS: 2,
  SMALL_TASK_CONCURRENCY: 5,
  MEDIUM_TASK_THREADS: 3,
  MEDIUM_TASK_CONCURRENCY: 8,
  LARGE_TASK_THREADS: 4,
  LARGE_TASK_CONCURRENCY: 10,
  
  // 请求配置
  TIMEOUT_MS: 5000,
  MAX_RETRIES: 1,
  REQUEST_DELAY_MS: 100,
  
  // 积分配置
  SEARCH_COST: 0.5,
  DETAIL_COST: 0.5,
};

// ============================================================================
// 配置键名常量
// ============================================================================

export const TPS_CONFIG_KEYS = {
  // 线程池配置
  MAX_THREADS: 'TPS_MAX_THREADS',
  MAX_CONCURRENCY_PER_THREAD: 'TPS_MAX_CONCURRENCY_PER_THREAD',
  GLOBAL_MAX_CONCURRENCY: 'TPS_GLOBAL_MAX_CONCURRENCY',
  
  // 请求配置
  TIMEOUT_MS: 'TPS_TIMEOUT_MS',
  MAX_RETRIES: 'TPS_MAX_RETRIES',
  
  // 积分配置
  SEARCH_CREDITS: 'TPS_SEARCH_CREDITS',
  DETAIL_CREDITS: 'TPS_DETAIL_CREDITS',
};

// ============================================================================
// 配置缓存
// ============================================================================

interface ConfigCache {
  data: TpsRuntimeConfig | null;
  timestamp: number;
}

const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存
let configCache: ConfigCache = {
  data: null,
  timestamp: 0,
};

// ============================================================================
// 运行时配置接口
// ============================================================================

export interface TpsRuntimeConfig {
  // 线程池配置
  maxThreads: number;
  maxConcurrencyPerThread: number;
  globalMaxConcurrency: number;
  
  // 任务规模阈值
  smallTaskThreshold: number;
  mediumTaskThreshold: number;
  
  // 动态并发配置
  smallTaskThreads: number;
  smallTaskConcurrency: number;
  mediumTaskThreads: number;
  mediumTaskConcurrency: number;
  largeTaskThreads: number;
  largeTaskConcurrency: number;
  
  // 请求配置
  timeoutMs: number;
  maxRetries: number;
  requestDelayMs: number;
  
  // 积分配置
  searchCost: number;
  detailCost: number;
}

// ============================================================================
// 配置读取函数
// ============================================================================

/**
 * 从数据库获取配置值
 */
async function getConfigValue(key: string): Promise<string | null> {
  try {
    const db = await getDb();
    if (!db) {
      console.error(`[TPS RuntimeConfig] 数据库未初始化`);
      return null;
    }
    const result = await db
      .select()
      .from(systemConfigs)
      .where(eq(systemConfigs.key, key))
      .limit(1);
    
    return result.length > 0 ? result[0].value : null;
  } catch (error) {
    console.error(`[TPS RuntimeConfig] 读取配置失败: ${key}`, error);
    return null;
  }
}

/**
 * 解析数字配置值
 */
function parseNumber(value: string | null, defaultValue: number, min?: number, max?: number): number {
  if (!value) return defaultValue;
  
  const num = parseFloat(value);
  if (isNaN(num)) return defaultValue;
  
  // 范围验证
  let result = num;
  if (min !== undefined && result < min) result = min;
  if (max !== undefined && result > max) result = max;
  
  return result;
}

/**
 * 获取 TPS 运行时配置（支持缓存）
 */
export async function getTpsRuntimeConfig(): Promise<TpsRuntimeConfig> {
  // 检查缓存是否有效
  const now = Date.now();
  if (configCache.data && (now - configCache.timestamp) < CONFIG_CACHE_TTL) {
    return configCache.data;
  }
  
  try {
    // 从数据库读取配置
    const [
      maxThreadsStr,
      maxConcurrencyPerThreadStr,
      globalMaxConcurrencyStr,
      timeoutMsStr,
      maxRetriesStr,
      searchCreditsStr,
      detailCreditsStr,
    ] = await Promise.all([
      getConfigValue(TPS_CONFIG_KEYS.MAX_THREADS),
      getConfigValue(TPS_CONFIG_KEYS.MAX_CONCURRENCY_PER_THREAD),
      getConfigValue(TPS_CONFIG_KEYS.GLOBAL_MAX_CONCURRENCY),
      getConfigValue(TPS_CONFIG_KEYS.TIMEOUT_MS),
      getConfigValue(TPS_CONFIG_KEYS.MAX_RETRIES),
      getConfigValue(TPS_CONFIG_KEYS.SEARCH_CREDITS),
      getConfigValue(TPS_CONFIG_KEYS.DETAIL_CREDITS),
    ]);
    
    // 解析配置值（带范围验证）
    const maxThreads = parseNumber(maxThreadsStr, DEFAULT_CONFIG.MAX_THREADS, 1, 10);
    const maxConcurrencyPerThread = parseNumber(maxConcurrencyPerThreadStr, DEFAULT_CONFIG.MAX_CONCURRENCY_PER_THREAD, 1, 20);
    const globalMaxConcurrency = parseNumber(globalMaxConcurrencyStr, DEFAULT_CONFIG.GLOBAL_MAX_CONCURRENCY, 1, 100);
    
    const config: TpsRuntimeConfig = {
      // 线程池配置（可从数据库覆盖）
      maxThreads,
      maxConcurrencyPerThread,
      globalMaxConcurrency,
      
      // 任务规模阈值（使用默认值）
      smallTaskThreshold: DEFAULT_CONFIG.SMALL_TASK_THRESHOLD,
      mediumTaskThreshold: DEFAULT_CONFIG.MEDIUM_TASK_THRESHOLD,
      
      // 动态并发配置（根据线程池配置计算）
      smallTaskThreads: Math.min(2, maxThreads),
      smallTaskConcurrency: Math.min(5, maxConcurrencyPerThread),
      mediumTaskThreads: Math.min(3, maxThreads),
      mediumTaskConcurrency: Math.min(8, maxConcurrencyPerThread),
      largeTaskThreads: maxThreads,
      largeTaskConcurrency: maxConcurrencyPerThread,
      
      // 请求配置
      timeoutMs: parseNumber(timeoutMsStr, DEFAULT_CONFIG.TIMEOUT_MS, 1000, 60000),
      maxRetries: parseNumber(maxRetriesStr, DEFAULT_CONFIG.MAX_RETRIES, 0, 5),
      requestDelayMs: DEFAULT_CONFIG.REQUEST_DELAY_MS,
      
      // 积分配置
      searchCost: parseNumber(searchCreditsStr, DEFAULT_CONFIG.SEARCH_COST, 0.1, 10),
      detailCost: parseNumber(detailCreditsStr, DEFAULT_CONFIG.DETAIL_COST, 0.1, 10),
    };
    
    // 更新缓存
    configCache = {
      data: config,
      timestamp: now,
    };
    
    return config;
  } catch (error) {
    console.error('[TPS RuntimeConfig] 获取配置失败，使用默认值', error);
    
    // 返回默认配置
    return {
      maxThreads: DEFAULT_CONFIG.MAX_THREADS,
      maxConcurrencyPerThread: DEFAULT_CONFIG.MAX_CONCURRENCY_PER_THREAD,
      globalMaxConcurrency: DEFAULT_CONFIG.GLOBAL_MAX_CONCURRENCY,
      smallTaskThreshold: DEFAULT_CONFIG.SMALL_TASK_THRESHOLD,
      mediumTaskThreshold: DEFAULT_CONFIG.MEDIUM_TASK_THRESHOLD,
      smallTaskThreads: DEFAULT_CONFIG.SMALL_TASK_THREADS,
      smallTaskConcurrency: DEFAULT_CONFIG.SMALL_TASK_CONCURRENCY,
      mediumTaskThreads: DEFAULT_CONFIG.MEDIUM_TASK_THREADS,
      mediumTaskConcurrency: DEFAULT_CONFIG.MEDIUM_TASK_CONCURRENCY,
      largeTaskThreads: DEFAULT_CONFIG.LARGE_TASK_THREADS,
      largeTaskConcurrency: DEFAULT_CONFIG.LARGE_TASK_CONCURRENCY,
      timeoutMs: DEFAULT_CONFIG.TIMEOUT_MS,
      maxRetries: DEFAULT_CONFIG.MAX_RETRIES,
      requestDelayMs: DEFAULT_CONFIG.REQUEST_DELAY_MS,
      searchCost: DEFAULT_CONFIG.SEARCH_COST,
      detailCost: DEFAULT_CONFIG.DETAIL_COST,
    };
  }
}

/**
 * 清除配置缓存（配置更新后调用）
 */
export function clearTpsConfigCache(): void {
  configCache = {
    data: null,
    timestamp: 0,
  };
  console.log('[TPS RuntimeConfig] 配置缓存已清除');
}

/**
 * 验证配置值是否合理
 */
export function validateTpsConfig(config: Partial<TpsRuntimeConfig>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (config.maxThreads !== undefined) {
    if (config.maxThreads < 1 || config.maxThreads > 10) {
      errors.push('线程数必须在 1-10 之间');
    }
  }
  
  if (config.maxConcurrencyPerThread !== undefined) {
    if (config.maxConcurrencyPerThread < 1 || config.maxConcurrencyPerThread > 20) {
      errors.push('每线程并发数必须在 1-20 之间');
    }
  }
  
  if (config.globalMaxConcurrency !== undefined) {
    if (config.globalMaxConcurrency < 1 || config.globalMaxConcurrency > 100) {
      errors.push('全局并发数必须在 1-100 之间');
    }
  }
  
  if (config.timeoutMs !== undefined) {
    if (config.timeoutMs < 1000 || config.timeoutMs > 60000) {
      errors.push('超时时间必须在 1000-60000 毫秒之间');
    }
  }
  
  if (config.maxRetries !== undefined) {
    if (config.maxRetries < 0 || config.maxRetries > 5) {
      errors.push('重试次数必须在 0-5 之间');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 获取当前配置摘要（用于日志）
 */
export async function getTpsConfigSummary(): Promise<string> {
  const config = await getTpsRuntimeConfig();
  return `线程: ${config.maxThreads} | 并发: ${config.maxConcurrencyPerThread} | 总并发: ${config.globalMaxConcurrency} | 超时: ${config.timeoutMs}ms | 重试: ${config.maxRetries}`;
}
