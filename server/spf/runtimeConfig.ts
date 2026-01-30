/**
 * SPF 运行时配置管理模块
 * 
 * v1.0 - 动态配置支持
 * 
 * 功能：
 * 1. 从数据库读取动态配置
 * 2. 提供默认值回退机制
 * 3. 配置缓存（避免频繁数据库查询）
 * 4. 支持管理员通过控制台动态修改
 * 
 * 设计原则：
 * - 不修改原有 scraper.ts 的核心逻辑
 * - 通过配置注入方式提供动态参数
 * - 保持向后兼容性
 */

import { getConfig } from "../db";
import { SCRAPEDO_CONFIG, SPF_CONFIG_KEYS } from "./config";

// ==================== 类型定义 ====================

export interface SpfRuntimeConfig {
  /** 全局最大并发数 */
  globalConcurrency: number;
  
  /** 请求超时（毫秒） */
  timeoutMs: number;
  
  /** 最大重试次数 */
  maxRetries: number;
  
  /** 重试延迟基数（毫秒） */
  retryDelayBase: number;
  
  /** 搜索页积分消耗 */
  searchCredits: number;
  
  /** 详情页积分消耗 */
  detailCredits: number;
}

// ==================== 配置缓存 ====================

interface ConfigCache {
  config: SpfRuntimeConfig | null;
  expireAt: number;
}

// 缓存有效期：5 分钟
const CACHE_TTL_MS = 5 * 60 * 1000;

let configCache: ConfigCache = {
  config: null,
  expireAt: 0,
};

// ==================== 核心函数 ====================

/**
 * 获取 SPF 运行时配置
 * 
 * 优先级：数据库配置 > 静态默认值
 * 
 * @param forceRefresh 是否强制刷新缓存
 * @returns SPF 运行时配置
 */
export async function getSpfRuntimeConfig(forceRefresh: boolean = false): Promise<SpfRuntimeConfig> {
  // 检查缓存
  if (!forceRefresh && configCache.config && Date.now() < configCache.expireAt) {
    return configCache.config;
  }
  
  // 从数据库读取配置
  const [
    globalConcurrencyStr,
    timeoutMsStr,
    maxRetriesStr,
    searchCreditsStr,
    detailCreditsStr,
  ] = await Promise.all([
    getConfig(SPF_CONFIG_KEYS.GLOBAL_CONCURRENCY),
    getConfig(SPF_CONFIG_KEYS.TIMEOUT_MS),
    getConfig(SPF_CONFIG_KEYS.MAX_RETRIES),
    getConfig(SPF_CONFIG_KEYS.SEARCH_CREDITS),
    getConfig(SPF_CONFIG_KEYS.DETAIL_CREDITS),
  ]);
  
  // 解析配置，使用默认值回退
  const config: SpfRuntimeConfig = {
    globalConcurrency: globalConcurrencyStr 
      ? parseInt(globalConcurrencyStr, 10) 
      : SCRAPEDO_CONFIG.GLOBAL_MAX_CONCURRENCY,
    
    timeoutMs: timeoutMsStr 
      ? parseInt(timeoutMsStr, 10) 
      : SCRAPEDO_CONFIG.TIMEOUT_MS,
    
    maxRetries: maxRetriesStr 
      ? parseInt(maxRetriesStr, 10) 
      : SCRAPEDO_CONFIG.MAX_RETRIES,
    
    retryDelayBase: SCRAPEDO_CONFIG.RETRY_DELAY_BASE,
    
    searchCredits: searchCreditsStr 
      ? parseFloat(searchCreditsStr) 
      : 0.85,
    
    detailCredits: detailCreditsStr 
      ? parseFloat(detailCreditsStr) 
      : 0.85,
  };
  
  // 验证配置值的合理性
  config.globalConcurrency = Math.max(1, Math.min(50, config.globalConcurrency));
  config.timeoutMs = Math.max(10000, Math.min(120000, config.timeoutMs));
  config.maxRetries = Math.max(0, Math.min(5, config.maxRetries));
  config.searchCredits = Math.max(0, config.searchCredits);
  config.detailCredits = Math.max(0, config.detailCredits);
  
  // 更新缓存
  configCache = {
    config,
    expireAt: Date.now() + CACHE_TTL_MS,
  };
  
  return config;
}

/**
 * 清除配置缓存
 * 
 * 在管理员更新配置后调用，确保新配置立即生效
 */
export function clearSpfConfigCache(): void {
  configCache = {
    config: null,
    expireAt: 0,
  };
  console.log('[SPF RuntimeConfig] 配置缓存已清除');
}

/**
 * 获取当前配置状态（用于监控和调试）
 */
export async function getSpfConfigStatus(): Promise<{
  config: SpfRuntimeConfig;
  cacheStatus: {
    isCached: boolean;
    expireAt: number;
    remainingMs: number;
  };
  defaults: {
    globalConcurrency: number;
    timeoutMs: number;
    maxRetries: number;
  };
}> {
  const config = await getSpfRuntimeConfig();
  const now = Date.now();
  
  return {
    config,
    cacheStatus: {
      isCached: configCache.config !== null && now < configCache.expireAt,
      expireAt: configCache.expireAt,
      remainingMs: Math.max(0, configCache.expireAt - now),
    },
    defaults: {
      globalConcurrency: SCRAPEDO_CONFIG.GLOBAL_MAX_CONCURRENCY,
      timeoutMs: SCRAPEDO_CONFIG.TIMEOUT_MS,
      maxRetries: SCRAPEDO_CONFIG.MAX_RETRIES,
    },
  };
}

// ==================== 配置验证 ====================

/**
 * 验证配置值是否在合理范围内
 */
export function validateSpfConfig(config: Partial<SpfRuntimeConfig>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (config.globalConcurrency !== undefined) {
    if (config.globalConcurrency < 1 || config.globalConcurrency > 50) {
      errors.push('全局并发数必须在 1-50 之间');
    }
  }
  
  if (config.timeoutMs !== undefined) {
    if (config.timeoutMs < 10000 || config.timeoutMs > 120000) {
      errors.push('超时时间必须在 10000-120000 毫秒之间');
    }
  }
  
  if (config.maxRetries !== undefined) {
    if (config.maxRetries < 0 || config.maxRetries > 5) {
      errors.push('重试次数必须在 0-5 之间');
    }
  }
  
  if (config.searchCredits !== undefined) {
    if (config.searchCredits < 0) {
      errors.push('搜索积分消耗不能为负数');
    }
  }
  
  if (config.detailCredits !== undefined) {
    if (config.detailCredits < 0) {
      errors.push('详情积分消耗不能为负数');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

// ==================== 导出 ====================

export default {
  getSpfRuntimeConfig,
  clearSpfConfigCache,
  getSpfConfigStatus,
  validateSpfConfig,
};
