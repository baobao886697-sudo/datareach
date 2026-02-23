/**
 * Scrape.do API 客户端
 * 
 * 共享的核心请求模块，提供统一的 API 调用接口
 * 
 * 使用场景:
 * - scraper.ts: 搜索阶段
 * - smartPoolExecutor.ts: 详情获取阶段
 * 
 * v3.0 简化重构:
 * - 取消所有重试机制（502/429/超时均不重试）
 * - 每次调用 = 1次 Scrape.do API 请求 = 1次扣费，简单直接
 * - 失败直接抛出错误，由上层决定是否跳过
 * - 保留全局 HTTP 并发信号量，防止 OOM
 */

import { globalHttpSemaphore } from './httpSemaphore';

// ============================================================================
// 类型定义
// ============================================================================

export interface ScrapeOptions {
  /** 请求超时时间（毫秒），默认 20000 */
  timeoutMs?: number;
  /** 是否输出日志，默认 false */
  enableLogging?: boolean;
}

// ============================================================================
// 自定义错误类型
// ============================================================================

/**
 * 429 限流错误
 * 上层代码通过 instanceof ScrapeRateLimitError 来识别
 */
export class ScrapeRateLimitError extends Error {
  public readonly statusCode = 429;
  constructor(message: string) {
    super(message);
    this.name = 'ScrapeRateLimitError';
  }
}

/**
 * 502/5xx 服务器错误
 * 上层代码通过 instanceof ScrapeServerError 来识别
 */
export class ScrapeServerError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number = 502) {
    super(message);
    this.name = 'ScrapeServerError';
    this.statusCode = statusCode;
  }
}

/**
 * Scrape.do API 积分耗尽错误 - HTTP 401/403
 * 此错误应立即停止所有请求
 */
export class ScrapeApiCreditsError extends Error {
  public readonly statusCode = 401;
  constructor(message: string = 'Scrape.do API 积分已耗尽或订阅已暂停 (HTTP 401)') {
    super(message);
    this.name = 'ScrapeApiCreditsError';
  }
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_OPTIONS: Required<ScrapeOptions> = {
  timeoutMs: 20000,
  enableLogging: false,
};

// ============================================================================
// 核心请求函数
// ============================================================================

/**
 * 使用 Scrape.do API 获取页面内容 (v3.0 零重试版)
 * 
 * 特性:
 * - 零重试：每次调用只发起 1 次 HTTP 请求，失败直接抛出错误
 * - 1次调用 = 1次 API 消耗 = 1次扣费，简单直接
 * - 保留全局 HTTP 并发信号量，防止 OOM
 * 
 * @param url 目标 URL
 * @param token Scrape.do API token
 * @param options 可选配置
 * @returns 页面 HTML 内容
 * @throws ScrapeRateLimitError 当收到 429 时
 * @throws ScrapeServerError 当收到 5xx 时
 * @throws ScrapeApiCreditsError 当收到 401/403 时
 * @throws Error 其他错误（超时、网络等）
 */
export async function fetchWithScrapeClient(
  url: string,
  token: string,
  options?: ScrapeOptions
): Promise<string> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { timeoutMs, enableLogging } = opts;
  
  const encodedUrl = encodeURIComponent(url);
  const apiUrl = `https://api.scrape.do/?token=${token}&url=${encodedUrl}&super=true&geoCode=us&timeout=${timeoutMs}`;
  
  const controller = new AbortController();
  // 客户端超时比 API 超时多 5 秒，确保能收到 API 的超时响应
  const clientTimeoutMs = timeoutMs + 5000;
  
  // ⭐ 全局HTTP并发信号量保护：等待获取许可后才发起请求
  await globalHttpSemaphore.acquire();
  const timeoutId = setTimeout(() => controller.abort(), clientTimeoutMs);
  let response: Response;
  try {
    response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    });
  } catch (error: any) {
    // 超时或网络错误，直接抛出，不重试
    clearTimeout(timeoutId);
    globalHttpSemaphore.release();
    throw error;
  } finally {
    clearTimeout(timeoutId);
    globalHttpSemaphore.release();
  }
  
  if (!response.ok) {
    const statusCode = response.status;
    
    // 5xx 服务器错误 — 直接抛出，不重试
    if (statusCode >= 500) {
      throw new ScrapeServerError(
        `Scrape.do API 服务器错误: HTTP ${statusCode}`,
        statusCode
      );
    }
    
    // 429 限流 — 直接抛出，不重试
    if (statusCode === 429) {
      throw new ScrapeRateLimitError(
        `Scrape.do API 限流: HTTP 429`
      );
    }
    
    // 401 API 积分耗尽
    if (statusCode === 401) {
      throw new ScrapeApiCreditsError(
        `Scrape.do API 积分已耗尽或订阅已暂停: HTTP 401 ${response.statusText}`
      );
    }
    
    // 403 认证错误
    if (statusCode === 403) {
      throw new ScrapeApiCreditsError(
        `Scrape.do API 认证失败或权限不足: HTTP 403 ${response.statusText}`
      );
    }
    
    // 其他 HTTP 错误
    throw new Error(`API 请求失败: ${statusCode} ${response.statusText}`);
  }
  
  return await response.text();
}
