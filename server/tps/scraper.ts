/**
 * TruePeopleSearch 爬虫服务
 * 
 * 基于 EXE 版本的 scraper.js 移植，适配 DataReach Pro Web 平台
 * 
 * 功能：
 * - 通过 Scrape.do 代理访问 TruePeopleSearch
 * - 解析搜索页和详情页
 * - 支持并发控制和缓存
 * - 过滤和去重
 * - 2+2 延后重试机制（与 EXE 客户端一致）
 * 
 * v2.0 更新:
 * - 添加 2+2 延后重试机制：即时重试2次（1秒间隔）+ 延后重试2次（2秒间隔）
 * - 与 EXE 客户端的并发策略保持一致
 */

import * as cheerio from 'cheerio';

// ==================== 配置 ====================
export const TPS_CONFIG = {
  SCRAPEDO_BASE: 'https://api.scrape.do',
  TPS_BASE: 'https://www.truepeoplesearch.com',
  RESULTS_PER_PAGE: 10,
  MAX_SAFE_PAGES: 25,
  MAX_RECORDS: 250,
  REQUEST_TIMEOUT: 30000,
  BATCH_DELAY: 200,
  SCRAPEDO_CONCURRENCY: 10,  // 每任务 10 并发（4 任务并发时总共 40）
  // 重试配置（与 EXE 客户端一致）
  IMMEDIATE_RETRIES: 2,       // 即时重试次数
  IMMEDIATE_RETRY_DELAY: 1000, // 即时重试延迟 (1秒)
  DEFERRED_RETRIES: 2,        // 延后重试次数
  DEFERRED_RETRY_DELAY: 2000, // 延后重试延迟 (2秒)
};

// ==================== 类型定义 ====================
export interface TpsFilters {
  minAge?: number;
  maxAge?: number;
  minYear?: number;
  minPropertyValue?: number;
  excludeTMobile?: boolean;
  excludeComcast?: boolean;
  excludeLandline?: boolean;
}

export interface TpsSearchResult {
  name: string;
  detailLink: string;
  age?: number;
  location?: string;
}

export interface TpsDetailResult {
  name: string;
  firstName: string;
  lastName: string;
  age: number;
  city: string;
  state: string;
  location: string;
  phone: string;
  phoneType: string;
  carrier: string;
  reportYear: number | null;
  isPrimary: boolean;
  propertyValue: number;
  yearBuilt: number | null;
  isDeceased: boolean;
}

export interface TpsSearchPageResult {
  totalRecords: number;
  results: TpsSearchResult[];
  hasNextPage: boolean;
  stats: {
    skippedNoAge: number;
    skippedDeceased: number;
    skippedAgeRange: number;
  };
}

export interface TpsFetchResult {
  ok: boolean;
  html?: string;
  error?: string;
  statusCode?: number;
  needDeferredRetry?: boolean;  // 标记是否需要延后重试（429 限流）
}

export interface TpsFullSearchStats {
  totalRecords: number;
  pagesSearched: number;
  detailsFetched: number;
  skippedNoAge: number;
  skippedDeceased: number;
  skippedAgeRange: number;
  skippedFilters: number;
  validResults: number;
  searchPageRequests: number;
  detailPageRequests: number;
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  skippedDuplicateLinks?: number;
  skippedDuplicatePhones?: number;
  // 新增：重试统计
  immediateRetries?: number;
  deferredRetries?: number;
  rateLimitedRequests?: number;
}

export interface TpsFullSearchResult {
  success: boolean;
  error?: string;
  results: TpsDetailResult[];
  totalRecords: number;
  pagesSearched: number;
  finalCount: number;
  stats: TpsFullSearchStats;
  logs: string[];
}

// ==================== URL 构建 ====================

/**
 * 构建搜索页 URL
 */
export function buildSearchUrl(name: string, location: string = '', page: number = 1): string {
  const encodedName = encodeURIComponent(name.trim());
  let url = `${TPS_CONFIG.TPS_BASE}/results?name=${encodedName}`;
  
  if (location && location.trim()) {
    url += `&citystatezip=${encodeURIComponent(location.trim())}`;
  }
  
  if (page > 1) {
    url += `&page=${page}`;
  }
  
  return url;
}

/**
 * 构建详情页 URL
 */
export function buildDetailUrl(detailLink: string): string {
  if (detailLink.startsWith('http')) {
    return detailLink;
  }
  return `${TPS_CONFIG.TPS_BASE}${detailLink}`;
}

// ==================== 代理请求 ====================

/**
 * 通过 Scrape.do 代理获取页面
 * 
 * 支持 429 限流重试机制（即时重试阶段）：
 * - 遇到 429 时，最多重试 IMMEDIATE_RETRIES 次
 * - 每次重试间隔 IMMEDIATE_RETRY_DELAY 毫秒
 * - 如果即时重试后仍然 429，返回 needDeferredRetry=true，等待延后重试
 */
export async function fetchViaProxy(
  url: string, 
  token: string, 
  maxRetries: number = TPS_CONFIG.IMMEDIATE_RETRIES,
  retryDelay: number = TPS_CONFIG.IMMEDIATE_RETRY_DELAY
): Promise<TpsFetchResult> {
  let lastError: TpsFetchResult = { ok: false, error: '未知错误' };
  let rateLimitedCount = 0;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const encodedUrl = encodeURIComponent(url);
      const apiUrl = `${TPS_CONFIG.SCRAPEDO_BASE}/?token=${token}&url=${encodedUrl}&super=true&geoCode=us`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TPS_CONFIG.REQUEST_TIMEOUT);
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        }
      });
      
      clearTimeout(timeoutId);
      
      // 429 限流处理
      if (response.status === 429) {
        rateLimitedCount++;
        lastError = {
          ok: false,
          error: `请求被限流 (429)，第 ${attempt + 1} 次尝试`,
          statusCode: 429
        };
        
        if (attempt < maxRetries) {
          // 还有即时重试机会
          await delay(retryDelay);
          continue;
        }
        
        // 即时重试用完，标记需要延后重试
        return {
          ok: false,
          error: '请求被限流 (429)，需要延后重试',
          statusCode: 429,
          needDeferredRetry: true
        };
      }
      
      if (!response.ok) {
        return {
          ok: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          statusCode: response.status
        };
      }
      
      const html = await response.text();
      
      // 检查是否被阻止
      if (html.includes('Access Denied') || html.includes('blocked') || html.includes('captcha')) {
        return {
          ok: false,
          error: '访问被阻止，请稍后重试',
          statusCode: 403
        };
      }
      
      return { ok: true, html };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        lastError = { ok: false, error: '请求超时', statusCode: 408 };
      } else {
        lastError = { ok: false, error: error.message || '请求失败' };
      }
      
      // 如果还有重试机会，等待后重试
      if (attempt < maxRetries) {
        await delay(retryDelay);
        continue;
      }
    }
  }
  
  return lastError;
}

// ==================== 页面解析 ====================

/**
 * 解析搜索页
 */
export function parseSearchPage(html: string, filters: TpsFilters): TpsSearchPageResult {
  const $ = cheerio.load(html);
  
  // 提取总记录数
  let totalRecords = 0;
  const recordText = $('.search-results-header, .results-header').text();
  const totalMatch = recordText.match(/(\d+)\s*records?\s*found/i);
  if (totalMatch) {
    totalRecords = parseInt(totalMatch[1]);
  }
  
  // 如果没找到，尝试其他方式
  if (totalRecords === 0) {
    const countEl = $('[data-total-count]');
    if (countEl.length) {
      totalRecords = parseInt(countEl.attr('data-total-count') || '0');
    }
  }
  
  const results: TpsSearchResult[] = [];
  const stats = {
    skippedNoAge: 0,
    skippedDeceased: 0,
    skippedAgeRange: 0
  };
  
  // 解析人员卡片
  $('.card-summary').each((i, card) => {
    const $card = $(card);
    const cardText = $card.text();
    
    // 跳过已故
    if (cardText.includes('Deceased')) {
      stats.skippedDeceased++;
      return;
    }
    
    // 提取详情链接
    const detailLink = $card.attr('data-detail-link');
    if (!detailLink) return;
    
    // 提取姓名
    const name = $card.find('.content-header').first().text().trim();
    if (!name) return;
    
    // 提取年龄 - 方法1: 查找 "Age " 后面的 content-value
    let age: number | undefined;
    $card.find('.content-label').each((j, label) => {
      if ($(label).text().trim() === 'Age') {
        const ageValue = $(label).next('.content-value').text().trim();
        const parsed = parseInt(ageValue);
        if (!isNaN(parsed)) {
          age = parsed;
        }
      }
    });
    
    // 提取年龄 - 方法2: 从文本中提取 "Age XX"（备用方法）
    if (!age) {
      const ageMatch = cardText.match(/Age\s+(\d+)/i);
      if (ageMatch) {
        age = parseInt(ageMatch[1]);
      }
    }
    
    // 年龄过滤
    if (filters.minAge || filters.maxAge) {
      if (!age) {
        stats.skippedNoAge++;
        return;
      }
      const minAge = filters.minAge || 0;
      const maxAge = filters.maxAge || 120;
      if (age < minAge || age > maxAge) {
        stats.skippedAgeRange++;
        return;
      }
    }
    
    // 提取位置
    const locationEl = $card.find('.content-value').first();
    const location = locationEl.text().trim();
    
    results.push({
      name,
      detailLink,
      age,
      location
    });
  });
  
  // 检查是否有下一页
  const hasNextPage = $('#btnNextPage').length > 0;
  
  return {
    totalRecords,
    results,
    hasNextPage,
    stats
  };
}

/**
 * 解析详情页
 */
export function parseDetailPage(html: string): TpsDetailResult | null {
  const $ = cheerio.load(html);
  
  // 检查是否已故
  const pageText = $('body').text();
  if (pageText.includes('Deceased')) {
    return { isDeceased: true } as any;
  }
  
  // 基本信息 - 从 #personDetails 提取
  const personDetails = $('#personDetails');
  if (!personDetails.length) {
    return null;
  }
  
  const firstName = personDetails.attr('data-fn') || '';
  const lastName = personDetails.attr('data-ln') || '';
  const ageStr = personDetails.attr('data-age');
  const city = personDetails.attr('data-city') || '';
  const state = personDetails.attr('data-state') || '';
  
  // 年龄必填
  const age = parseInt(ageStr || '0');
  if (!age || isNaN(age)) {
    return null;
  }
  
  // 房产信息
  let propertyValue = 0;
  let yearBuilt: number | null = null;
  
  const addressLink = $('a[data-link-to-more="address"]').first();
  if (addressLink.length) {
    const addressContainer = addressLink.parent();
    const propertyInfo = addressContainer.find('.dt-sb').first().text();
    
    const priceMatch = propertyInfo.match(/\$([0-9,]+)/);
    if (priceMatch) {
      propertyValue = parseInt(priceMatch[1].replace(/,/g, ''));
    }
    
    const builtMatch = propertyInfo.match(/Built\s*(\d{4})/i);
    if (builtMatch) {
      yearBuilt = parseInt(builtMatch[1]);
    }
  }
  
  // 第一个电话号码（最重要，最新）
  const firstPhoneLink = $('a[data-link-to-more="phone"]').first();
  if (!firstPhoneLink.length) {
    return null;
  }
  
  const phone = firstPhoneLink.find('span').first().text().trim();
  if (!phone) {
    return null;
  }
  
  // 电话类型
  let phoneType = '';
  const phoneTypeSpan = firstPhoneLink.parent().find('span.smaller').first();
  if (phoneTypeSpan.length) {
    phoneType = phoneTypeSpan.text().trim();
  } else {
    const phoneContainerText = firstPhoneLink.parent().text();
    if (phoneContainerText.includes('Wireless')) phoneType = 'Wireless';
    else if (phoneContainerText.includes('Landline')) phoneType = 'Landline';
    else if (phoneContainerText.includes('Voip')) phoneType = 'Voip';
  }
  
  // 电话详情
  const phoneContainer = firstPhoneLink.parent();
  const phoneInfoDiv = phoneContainer.find('.dt-ln');
  const phoneInfoText = phoneInfoDiv.text();
  
  const isPrimary = phoneInfoText.includes('Primary');
  
  // 报告年份
  let reportYear: number | null = null;
  const yearMatch = phoneInfoText.match(/Last reported\s+\w+\s+(\d{4})/i);
  if (yearMatch) {
    reportYear = parseInt(yearMatch[1]);
  }
  
  // 运营商
  let carrier = '';
  phoneInfoDiv.find('.dt-sb').each((i, el) => {
    const text = $(el).text().trim();
    if (text && 
        !text.includes('Last reported') && 
        !text.includes('Primary') &&
        !text.match(/^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/)) {
      carrier = text;
    }
  });
  
  if (!carrier) {
    const carrierMatch = phoneInfoText.match(/(?:Last reported.*?\n|Primary.*?\n)([A-Za-z&\s.-]+?)(?:\n|$)/);
    if (carrierMatch) {
      carrier = carrierMatch[1].trim();
    }
  }
  
  return {
    name: `${firstName} ${lastName}`.trim(),
    firstName,
    lastName,
    age,
    city,
    state,
    location: city && state ? `${city}, ${state}` : (city || state),
    phone,
    phoneType,
    carrier,
    reportYear,
    isPrimary,
    propertyValue,
    yearBuilt,
    isDeceased: false
  };
}

// ==================== 过滤函数 ====================

/**
 * 检查结果是否应该被包含
 */
export function shouldIncludeResult(result: TpsDetailResult, filters: TpsFilters): boolean {
  if (!result) return false;
  if (result.isDeceased) return false;
  if (!result.age) return false;
  
  // 年龄范围
  const minAge = filters.minAge || 0;
  const maxAge = filters.maxAge || 120;
  if (result.age < minAge || result.age > maxAge) return false;
  
  // 报告年份
  const minYear = filters.minYear || 2000;
  if (result.reportYear && result.reportYear < minYear) return false;
  
  // 最低房产价值
  const minPropertyValue = filters.minPropertyValue || 0;
  if (minPropertyValue > 0 && result.propertyValue < minPropertyValue) return false;
  
  // 运营商过滤
  const carrierLower = (result.carrier || '').toLowerCase();
  if (filters.excludeTMobile && carrierLower.includes('t-mobile')) return false;
  if (filters.excludeComcast && (carrierLower.includes('comcast') || carrierLower.includes('spectrum'))) return false;
  
  // 固话过滤
  if (filters.excludeLandline && result.phoneType === 'Landline') return false;
  
  return true;
}

// ==================== 工具函数 ====================

/**
 * 延迟函数
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 批量获取结果接口
 */
interface BatchFetchResult {
  results: TpsFetchResult[];
  deferredUrls: string[];  // 需要延后重试的 URL
}

/**
 * 并发批量获取页面（支持收集需要延后重试的请求）
 */
export async function fetchBatch(
  urls: string[], 
  token: string, 
  concurrency: number = TPS_CONFIG.SCRAPEDO_CONCURRENCY
): Promise<TpsFetchResult[]> {
  const results: TpsFetchResult[] = [];
  
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    
    const batchPromises = batch.map(url => fetchViaProxy(url, token));
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // 批次间延迟
    if (i + concurrency < urls.length) {
      await delay(TPS_CONFIG.BATCH_DELAY);
    }
  }
  
  return results;
}

/**
 * 并发批量获取页面（带延后重试队列收集）
 * 
 * 返回：
 * - results: 成功获取的结果（包括失败但不需要重试的）
 * - deferredUrls: 需要延后重试的 URL 列表
 */
export async function fetchBatchWithDeferredRetry(
  urls: string[], 
  token: string, 
  concurrency: number = TPS_CONFIG.SCRAPEDO_CONCURRENCY
): Promise<BatchFetchResult> {
  const results: TpsFetchResult[] = [];
  const deferredUrls: string[] = [];
  
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    
    const batchPromises = batch.map(url => fetchViaProxy(url, token));
    const batchResults = await Promise.all(batchPromises);
    
    // 分离需要延后重试的请求
    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const url = batch[j];
      
      if (result.needDeferredRetry) {
        // 需要延后重试
        deferredUrls.push(url);
        // 暂时放入一个占位结果
        results.push({ ok: false, error: 'DEFERRED', statusCode: 429, needDeferredRetry: true });
      } else {
        results.push(result);
      }
    }
    
    // 批次间延迟
    if (i + concurrency < urls.length) {
      await delay(TPS_CONFIG.BATCH_DELAY);
    }
  }
  
  return { results, deferredUrls };
}

/**
 * 执行延后重试
 * 
 * 对于 429 限流的请求，在所有任务完成后进行延后重试
 * 使用更长的等待时间（2秒）和更少的并发
 */
async function executeDeferredRetry(
  urls: string[],
  token: string,
  log: (msg: string) => void
): Promise<Map<string, TpsFetchResult>> {
  const results = new Map<string, TpsFetchResult>();
  
  if (urls.length === 0) {
    return results;
  }
  
  log(`⏳ 开始延后重试 ${urls.length} 个被限流的请求...`);
  
  // 延后重试使用更低的并发（降低到原来的一半）
  const deferredConcurrency = Math.max(5, Math.floor(TPS_CONFIG.SCRAPEDO_CONCURRENCY / 2));
  
  for (let retryAttempt = 0; retryAttempt < TPS_CONFIG.DEFERRED_RETRIES; retryAttempt++) {
    if (urls.length === 0) break;
    
    log(`⏳ 延后重试第 ${retryAttempt + 1}/${TPS_CONFIG.DEFERRED_RETRIES} 轮，剩余 ${urls.length} 个请求...`);
    
    // 等待更长时间
    await delay(TPS_CONFIG.DEFERRED_RETRY_DELAY);
    
    const stillDeferred: string[] = [];
    
    // 分批处理
    for (let i = 0; i < urls.length; i += deferredConcurrency) {
      const batch = urls.slice(i, i + deferredConcurrency);
      
      const batchPromises = batch.map(url => 
        fetchViaProxy(url, token, 1, TPS_CONFIG.DEFERRED_RETRY_DELAY)  // 延后重试只重试1次
      );
      const batchResults = await Promise.all(batchPromises);
      
      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        const url = batch[j];
        
        if (result.ok) {
          results.set(url, result);
        } else if (result.statusCode === 429) {
          // 仍然被限流，加入下一轮重试
          stillDeferred.push(url);
        } else {
          // 其他错误，记录失败
          results.set(url, result);
        }
      }
      
      // 批次间延迟（延后重试使用更长的延迟）
      if (i + deferredConcurrency < urls.length) {
        await delay(TPS_CONFIG.BATCH_DELAY * 2);
      }
    }
    
    urls = stillDeferred;
  }
  
  // 最终仍然失败的请求
  for (const url of urls) {
    results.set(url, {
      ok: false,
      error: '延后重试后仍然被限流 (429)',
      statusCode: 429
    });
  }
  
  if (urls.length > 0) {
    log(`⚠️ ${urls.length} 个请求在延后重试后仍然失败`);
  } else {
    log(`✅ 延后重试完成，所有请求已处理`);
  }
  
  return results;
}

// ==================== 完整搜索流程 ====================

export interface TpsFullSearchOptions {
  maxPages?: number;
  filters?: TpsFilters;
  concurrency?: number;
  onProgress?: (message: string) => void;
  getCachedDetails?: (links: string[]) => Promise<Map<string, TpsDetailResult>>;
  setCachedDetails?: (items: Array<{ link: string; data: TpsDetailResult }>) => Promise<void>;
}

/**
 * 完整搜索流程
 * 
 * 实现与 EXE 客户端一致的 2+2 重试机制：
 * 1. 即时重试：遇到 429 时，最多重试 2 次，每次间隔 1 秒
 * 2. 延后重试：即时重试失败后，在所有请求完成后，再重试 2 次，每次间隔 2 秒
 */
export async function fullSearch(
  name: string,
  location: string = '',
  token: string,
  options: TpsFullSearchOptions = {}
): Promise<TpsFullSearchResult> {
  const {
    maxPages = TPS_CONFIG.MAX_SAFE_PAGES,
    filters = {},
    concurrency = TPS_CONFIG.SCRAPEDO_CONCURRENCY,
    onProgress = () => {},
    getCachedDetails,
    setCachedDetails
  } = options;
  
  const logs: string[] = [];
  const log = (msg: string) => {
    const logMsg = `[${new Date().toISOString()}] ${msg}`;
    logs.push(logMsg);
    onProgress(logMsg);
  };
  
  log(`🔍 开始搜索: ${name}${location ? ` @ ${location}` : ''}`);
  
  // 统计
  const stats: TpsFullSearchStats = {
    totalRecords: 0,
    pagesSearched: 0,
    detailsFetched: 0,
    skippedNoAge: 0,
    skippedDeceased: 0,
    skippedAgeRange: 0,
    skippedFilters: 0,
    validResults: 0,
    searchPageRequests: 0,
    detailPageRequests: 0,
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    immediateRetries: 0,
    deferredRetries: 0,
    rateLimitedRequests: 0
  };
  
  // 延后重试队列
  const deferredSearchPages: string[] = [];
  const deferredDetailPages: string[] = [];
  
  // ==================== 第一阶段：获取第一页 ====================
  const firstPageUrl = buildSearchUrl(name, location, 1);
  log(`📄 获取第一页...`);
  
  const firstPageResult = await fetchViaProxy(firstPageUrl, token);
  
  // 如果第一页就被限流，直接返回错误
  if (!firstPageResult.ok) {
    if (firstPageResult.needDeferredRetry) {
      log(`⚠️ 第一页被限流，尝试延后重试...`);
      const deferredResults = await executeDeferredRetry([firstPageUrl], token, log);
      const retryResult = deferredResults.get(firstPageUrl);
      if (!retryResult?.ok) {
        log(`❌ 第一页获取失败: ${retryResult?.error || firstPageResult.error}`);
        return {
          success: false,
          error: retryResult?.error || firstPageResult.error,
          results: [],
          totalRecords: 0,
          pagesSearched: 0,
          finalCount: 0,
          stats,
          logs
        };
      }
      // 使用重试成功的结果
      firstPageResult.ok = true;
      firstPageResult.html = retryResult.html;
    } else {
      log(`❌ 第一页获取失败: ${firstPageResult.error}`);
      return {
        success: false,
        error: firstPageResult.error,
        results: [],
        totalRecords: 0,
        pagesSearched: 0,
        finalCount: 0,
        stats,
        logs
      };
    }
  }
  
  const firstPageData = parseSearchPage(firstPageResult.html!, filters);
  stats.totalRecords = firstPageData.totalRecords;
  stats.pagesSearched = 1;
  stats.searchPageRequests = 1;
  stats.skippedNoAge += firstPageData.stats.skippedNoAge;
  stats.skippedDeceased += firstPageData.stats.skippedDeceased;
  stats.skippedAgeRange += firstPageData.stats.skippedAgeRange;
  
  log(`📊 找到 ${firstPageData.totalRecords} 条记录`);
  log(`✅ 第一页: ${firstPageData.results.length} 条通过初筛`);
  
  // 收集详情链接
  const allDetailLinks = [...firstPageData.results.map(r => r.detailLink)];
  const searchPageResults = [...firstPageData.results];
  
  // ==================== 第二阶段：并发获取剩余搜索页 ====================
  if (firstPageData.totalRecords > TPS_CONFIG.RESULTS_PER_PAGE && firstPageData.hasNextPage) {
    const totalPages = Math.min(
      Math.ceil(firstPageData.totalRecords / TPS_CONFIG.RESULTS_PER_PAGE),
      maxPages
    );
    
    if (totalPages > 1) {
      log(`📄 并发获取剩余 ${totalPages - 1} 个搜索页 (并发数: ${concurrency})...`);
      
      const remainingPageUrls: string[] = [];
      for (let page = 2; page <= totalPages; page++) {
        remainingPageUrls.push(buildSearchUrl(name, location, page));
      }
      
      // 使用带延后重试收集的批量获取
      const { results: pageResults, deferredUrls } = await fetchBatchWithDeferredRetry(
        remainingPageUrls, token, concurrency
      );
      stats.searchPageRequests += remainingPageUrls.length;
      
      // 记录需要延后重试的搜索页
      deferredSearchPages.push(...deferredUrls);
      if (deferredUrls.length > 0) {
        stats.rateLimitedRequests = (stats.rateLimitedRequests || 0) + deferredUrls.length;
        log(`⚠️ ${deferredUrls.length} 个搜索页被限流，将在后续延后重试`);
      }
      
      // 处理成功的结果
      for (let i = 0; i < pageResults.length; i++) {
        const pageResult = pageResults[i];
        const pageNum = i + 2;
        
        if (pageResult.ok && pageResult.html) {
          const pageData = parseSearchPage(pageResult.html, filters);
          stats.pagesSearched++;
          stats.skippedNoAge += pageData.stats.skippedNoAge;
          stats.skippedDeceased += pageData.stats.skippedDeceased;
          stats.skippedAgeRange += pageData.stats.skippedAgeRange;
          
          for (const result of pageData.results) {
            allDetailLinks.push(result.detailLink);
            searchPageResults.push(result);
          }
          
          log(`✅ 搜索页 ${pageNum}: ${pageData.results.length} 条通过初筛`);
        } else if (!pageResult.needDeferredRetry) {
          log(`❌ 搜索页 ${pageNum} 获取失败: ${pageResult.error}`);
        }
      }
    }
  }
  
  // ==================== 搜索页延后重试 ====================
  if (deferredSearchPages.length > 0) {
    const deferredResults = await executeDeferredRetry(deferredSearchPages, token, log);
    stats.deferredRetries = (stats.deferredRetries || 0) + deferredSearchPages.length;
    
    for (const [url, result] of deferredResults) {
      if (result.ok && result.html) {
        const pageData = parseSearchPage(result.html, filters);
        stats.pagesSearched++;
        stats.skippedNoAge += pageData.stats.skippedNoAge;
        stats.skippedDeceased += pageData.stats.skippedDeceased;
        stats.skippedAgeRange += pageData.stats.skippedAgeRange;
        
        for (const r of pageData.results) {
          allDetailLinks.push(r.detailLink);
          searchPageResults.push(r);
        }
        
        log(`✅ 延后重试成功: ${pageData.results.length} 条通过初筛`);
      }
    }
  }
  
  // 详情链接去重
  const uniqueDetailLinks = Array.from(new Set(allDetailLinks));
  stats.skippedDuplicateLinks = allDetailLinks.length - uniqueDetailLinks.length;
  
  if (stats.skippedDuplicateLinks > 0) {
    log(`🔄 任务内去重: 发现 ${stats.skippedDuplicateLinks} 个重复的详情链接`);
  }
  
  log(`📋 搜索页完成: 共 ${uniqueDetailLinks.length} 条需要获取详情`);
  
  // ==================== 第三阶段：并发获取详情页 ====================
  if (uniqueDetailLinks.length === 0) {
    return {
      success: true,
      results: [],
      totalRecords: stats.totalRecords,
      pagesSearched: stats.pagesSearched,
      finalCount: 0,
      stats,
      logs
    };
  }
  
  // 查询缓存
  let cachedResults = new Map<string, TpsDetailResult>();
  let linksToFetch = uniqueDetailLinks;
  
  if (getCachedDetails) {
    try {
      cachedResults = await getCachedDetails(uniqueDetailLinks);
      linksToFetch = uniqueDetailLinks.filter(link => !cachedResults.has(link));
      
      stats.cacheHits = cachedResults.size;
      stats.cacheMisses = linksToFetch.length;
      
      if (cachedResults.size > 0) {
        log(`💾 缓存命中: ${cachedResults.size} 条记录从缓存读取`);
      }
    } catch (error) {
      console.error('缓存查询失败:', error);
      linksToFetch = uniqueDetailLinks;
    }
  }
  
  // 获取未缓存的详情
  const fetchedResults: Array<{ link: string; data: TpsDetailResult | null }> = [];
  
  if (linksToFetch.length > 0) {
    log(`🔄 并发获取 ${linksToFetch.length} 个详情页 (并发数: ${concurrency})...`);
    
    const detailUrls = linksToFetch.map(link => buildDetailUrl(link));
    
    // 使用带延后重试收集的批量获取
    const { results: detailFetchResults, deferredUrls } = await fetchBatchWithDeferredRetry(
      detailUrls, token, concurrency
    );
    
    // 记录需要延后重试的详情页
    if (deferredUrls.length > 0) {
      stats.rateLimitedRequests = (stats.rateLimitedRequests || 0) + deferredUrls.length;
      log(`⚠️ ${deferredUrls.length} 个详情页被限流，将在后续延后重试`);
    }
    
    // 建立 URL 到 link 的映射
    const urlToLink = new Map<string, string>();
    for (let i = 0; i < linksToFetch.length; i++) {
      urlToLink.set(detailUrls[i], linksToFetch[i]);
    }
    
    const cacheItems: Array<{ link: string; data: TpsDetailResult }> = [];
    
    // 处理成功的结果
    for (let i = 0; i < detailFetchResults.length; i++) {
      const result = detailFetchResults[i];
      const link = linksToFetch[i];
      
      if (result.ok && result.html) {
        const parsed = parseDetailPage(result.html);
        fetchedResults.push({ link, data: parsed });
        
        if (parsed && setCachedDetails) {
          cacheItems.push({ link, data: parsed });
        }
      } else if (!result.needDeferredRetry) {
        fetchedResults.push({ link, data: null });
      }
    }
    
    // ==================== 详情页延后重试 ====================
    if (deferredUrls.length > 0) {
      const deferredDetailResults = await executeDeferredRetry(deferredUrls, token, log);
      stats.deferredRetries = (stats.deferredRetries || 0) + deferredUrls.length;
      
      for (const [url, result] of deferredDetailResults) {
        const link = urlToLink.get(url);
        if (!link) continue;
        
        if (result.ok && result.html) {
          const parsed = parseDetailPage(result.html);
          fetchedResults.push({ link, data: parsed });
          
          if (parsed && setCachedDetails) {
            cacheItems.push({ link, data: parsed });
          }
          
          log(`✅ 详情页延后重试成功`);
        } else {
          fetchedResults.push({ link, data: null });
        }
      }
    }
    
    // 异步保存缓存
    if (cacheItems.length > 0 && setCachedDetails) {
      setCachedDetails(cacheItems).catch(err => {
        console.error('保存详情页缓存失败:', err);
      });
      log(`💾 缓存更新: ${cacheItems.length} 条新记录已加入缓存`);
    }
  }
  
  stats.detailPageRequests = linksToFetch.length;
  
  // 合并结果
  const detailResults = uniqueDetailLinks.map(link => {
    if (cachedResults.has(link)) {
      return cachedResults.get(link)!;
    }
    const fetched = fetchedResults.find(r => r.link === link);
    return fetched?.data || null;
  });
  
  stats.detailsFetched = detailResults.filter(r => r !== null).length;
  
  // ==================== 第四阶段：应用过滤条件 ====================
  const filteredResults: TpsDetailResult[] = [];
  
  for (const detail of detailResults) {
    if (!detail) {
      stats.skippedNoAge++;
      continue;
    }
    
    if (detail.isDeceased) {
      stats.skippedDeceased++;
      continue;
    }
    
    if (!shouldIncludeResult(detail, filters)) {
      stats.skippedFilters++;
      continue;
    }
    
    filteredResults.push(detail);
  }
  
  // 电话号码去重
  const seenPhones = new Set<string>();
  const finalResults: TpsDetailResult[] = [];
  stats.skippedDuplicatePhones = 0;
  
  for (const result of filteredResults) {
    if (result.phone && seenPhones.has(result.phone)) {
      stats.skippedDuplicatePhones++;
      continue;
    }
    if (result.phone) {
      seenPhones.add(result.phone);
    }
    finalResults.push(result);
  }
  
  if (stats.skippedDuplicatePhones > 0) {
    log(`📱 电话去重: 跳过 ${stats.skippedDuplicatePhones} 条重复电话号码的记录`);
  }
  
  stats.validResults = finalResults.length;
  stats.totalRequests = stats.searchPageRequests + stats.detailPageRequests;
  
  log(`✅ 搜索完成: ${finalResults.length} 条有效结果`);
  log(`📊 统计: 搜索页 ${stats.searchPageRequests} 次, 详情页 ${stats.detailPageRequests} 次, 缓存命中 ${stats.cacheHits} 次`);
  
  if (stats.rateLimitedRequests && stats.rateLimitedRequests > 0) {
    log(`⚠️ 限流统计: ${stats.rateLimitedRequests} 次 429 限流, ${stats.deferredRetries || 0} 次延后重试`);
  }
  
  return {
    success: true,
    results: finalResults,
    totalRecords: stats.totalRecords,
    pagesSearched: stats.pagesSearched,
    finalCount: finalResults.length,
    stats,
    logs
  };
}
