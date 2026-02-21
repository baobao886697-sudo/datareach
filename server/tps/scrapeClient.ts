/**
 * Scrape.do API 客户端
 * 
 * 共享的核心请求模块，提供统一的 API 调用接口
 * 
 * 使用场景:
 * - scraper.ts: 搜索阶段（配合全局信号量使用）
 * - smartPoolExecutor.ts: 详情获取阶段（配合智能并发池使用）
 * 
 * v2.0 容错升级:
 * - 区分 429/502 错误类型，分别处理
 * - 502 错误: 指数退避重试 (2s → 4s → 6s)，最多重试 3 次
 * - 429 错误: 即时重试后抛出特殊错误，由上层延后重试队列处理
 * - 超时/网络错误: 保持原有重试逻辑
 * 
 * v2.1 内存优化:
 * - 接入全局 HTTP 并发信号量，限制整个系统的最大并发 HTTP 请求数
 * - 防止多用户同时运行大任务时内存溢出 (OOM)
 */

import { globalHttpSemaphore } from './httpSemaphore';

// ============================================================================
// 类型定义
// ============================================================================

export interface ScrapeOptions {
  /** 请求超时时间（毫秒），默认 20000 */
  timeoutMs?: number;
  /** 最大重试次数（超时/网络错误），默认 1 */
  maxRetries?: number;
  /** 重试前等待时间（毫秒，超时/网络错误用），默认 0 */
  retryDelayMs?: number;
  /** 是否输出日志，默认 false */
  enableLogging?: boolean;
  /** 502 最大重试次数，默认 3 */
  maxRetries502?: number;
  /** 502 基础重试延迟（毫秒），默认 2000 (2s → 4s → 6s) */
  retryBaseDelay502Ms?: number;
  /** 429 即时重试次数，默认 2 */
  maxRetries429?: number;
  /** 429 即时重试延迟（毫秒），默认 1000 */
  retryDelay429Ms?: number;
}

// ============================================================================
// 自定义错误类型
// ============================================================================

/**
 * 429 限流错误 - 即时重试已用尽，需要延后重试
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
 * 502 服务器错误 - 所有重试已用尽
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
 * Scrape.do API 积分耗尽错误 - HTTP 401
 * Scrape.do 返回 401 表示 API token 积分耗尽或订阅已暂停
 * 此错误不可重试，应立即停止所有请求
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
  maxRetries: 1,
  retryDelayMs: 0,
  enableLogging: false,
  maxRetries502: 3,
  retryBaseDelay502Ms: 2000,
  maxRetries429: 2,
  retryDelay429Ms: 1000,
};

// ============================================================================
// 核心请求函数
// ============================================================================

/**
 * 使用 Scrape.do API 获取页面内容
 * 
 * 特性:
 * - 可配置超时和重试
 * - 502 错误: 指数退避重试 (2s → 4s → 6s)，最多 3 次
 * - 429 错误: 即时重试 2 次（间隔 1s），仍失败则抛出 ScrapeRateLimitError
 * - 超时或网络错误: 保持原有重试逻辑
 * - 不包含并发控制（由调用方管理）
 * 
 * @param url 目标 URL
 * @param token Scrape.do API token
 * @param options 可选配置
 * @returns 页面 HTML 内容
 * @throws ScrapeRateLimitError 当 429 即时重试用尽时
 * @throws ScrapeServerError 当 502 重试用尽时
 * @throws Error 其他错误
 */
export async function fetchWithScrapeClient(
  url: string,
  token: string,
  options?: ScrapeOptions
): Promise<string> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const {
    timeoutMs,
    maxRetries,
    retryDelayMs,
    enableLogging,
    maxRetries502,
    retryBaseDelay502Ms,
    maxRetries429,
    retryDelay429Ms,
  } = opts;
  
  const encodedUrl = encodeURIComponent(url);
  const apiUrl = `https://api.scrape.do/?token=${token}&url=${encodedUrl}&super=true&geoCode=us&timeout=${timeoutMs}`;
  
  let lastError: Error | null = null;
  
  // 总尝试次数 = 首次 + 最大重试次数（取所有重试策略中的最大值）
  const totalMaxAttempts = 1 + Math.max(maxRetries, maxRetries502, maxRetries429);
  
  // 各错误类型的已重试计数
  let retryCount502 = 0;
  let retryCount429 = 0;
  let retryCountGeneral = 0;
  
  for (let attempt = 0; attempt < totalMaxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      // 客户端超时比 API 超时多 5 秒，确保能收到 API 的超时响应
      const clientTimeoutMs = timeoutMs + 5000;
      
      // ⭐ 全局HTTP并发信号量保护：等待获取许可后才发起请求
      // 注意：setTimeout必须在acquire()之后启动，避免在排队等待期间就超时
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
      } finally {
        // 无论请求成功还是失败，都必须释放信号量并清除超时
        clearTimeout(timeoutId);
        globalHttpSemaphore.release();
      }
      
      if (!response.ok) {
        const statusCode = response.status;
        
        // ==================== 502/503/504 服务器错误处理 ====================
        if (statusCode >= 500) {
          if (retryCount502 < maxRetries502) {
            retryCount502++;
            // 指数退避: 2s → 4s → 6s (基础延迟 × 重试次数)
            const delay502 = retryBaseDelay502Ms * retryCount502;
            if (enableLogging) {
              console.log(`[ScrapeClient] HTTP ${statusCode} 服务器错误，第 ${retryCount502}/${maxRetries502} 次重试，等待 ${delay502}ms...`);
            }
            await new Promise(resolve => setTimeout(resolve, delay502));
            continue;
          }
          // 502 重试用尽
          throw new ScrapeServerError(
            `Scrape.do API 服务器错误: HTTP ${statusCode}，已重试 ${maxRetries502} 次仍失败`,
            statusCode
          );
        }
        
        // ==================== 429 限流错误处理 ====================
        if (statusCode === 429) {
          if (retryCount429 < maxRetries429) {
            retryCount429++;
            if (enableLogging) {
              console.log(`[ScrapeClient] HTTP 429 限流，第 ${retryCount429}/${maxRetries429} 次即时重试，等待 ${retryDelay429Ms}ms...`);
            }
            await new Promise(resolve => setTimeout(resolve, retryDelay429Ms));
            continue;
          }
          // 429 即时重试用尽，抛出特殊错误，由上层延后重试队列处理
          throw new ScrapeRateLimitError(
            `Scrape.do API 限流: HTTP 429，已即时重试 ${maxRetries429} 次仍被限流`
          );
        }
        
        // ==================== 401 API 积分耗尽处理 ====================
        if (statusCode === 401) {
          throw new ScrapeApiCreditsError(
            `Scrape.do API 积分已耗尽或订阅已暂停: HTTP 401 ${response.statusText}`
          );
        }
        
        // ==================== 403 认证错误处理 ====================
        if (statusCode === 403) {
          throw new ScrapeApiCreditsError(
            `Scrape.do API 认证失败或权限不足: HTTP 403 ${response.statusText}`
          );
        }
        
        // ==================== 其他 HTTP 错误 ====================
        throw new Error(`API 请求失败: ${statusCode} ${response.statusText}`);
      }
      
      return await response.text();
    } catch (error: any) {
      lastError = error;
      
      // 如果是我们自定义的错误类型，直接向上抛出，不再重试
      if (error instanceof ScrapeRateLimitError || error instanceof ScrapeServerError || error instanceof ScrapeApiCreditsError) {
        throw error;
      }
      
      // 超时或网络错误时重试（保持原有逻辑）
      const isTimeout = error.name === 'AbortError' || error.message?.includes('timeout');
      const isNetworkError = error.message?.includes('fetch') || error.message?.includes('network');
      
      if ((isTimeout || isNetworkError) && retryCountGeneral < maxRetries) {
        retryCountGeneral++;
        if (enableLogging) {
          console.log(`[ScrapeClient] 请求超时/网络错误，第 ${retryCountGeneral}/${maxRetries} 次重试...`);
        }
        
        // 重试前等待
        if (retryDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
        
        continue;
      }
      
      // 其他错误或重试用尽，直接抛出
      throw error;
    }
  }
  
  throw lastError || new Error('请求失败');
}
