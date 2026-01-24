/**
 * TruePeopleSearch 爬虫服务
 * 
 * 基于 EXE 版本的 scraper.js 移植，适配 DataReach Pro Web 平台
 * 
 * 功能：
 * - 通过 Scrape.do 代理访问 TruePeopleSearch
 * - 解析搜索页和详情页
 * - 支持统一队列模式（40 并发统一消费）
 * - 过滤和去重
 * - 2+2 延后重试机制（与 EXE 客户端一致）
 * 
 * v3.2 更新:
 * - 新增分离的搜索和详情抓取函数（支持统一队列模式）
 * - 保留原有 fullSearch 函数（向后兼容）
 * - 40 并发统一消费详情队列，最大化并发利用率
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
  BATCH_DELAY: 200,  // 批次延迟 200ms（稳定优先）
  // 统一队列并发配置
  TOTAL_CONCURRENCY: 40,    // 总并发数（与 Scrape.do 账户限制匹配）
  TASK_CONCURRENCY: 4,      // 搜索任务并发数
  SCRAPEDO_CONCURRENCY: 10, // 每任务详情并发（向后兼容）
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
  age?: number;
  location: string;
  detailLink: string;
}

export interface TpsDetailResult {
  name: string;
  age?: number;
  city?: string;
  state?: string;
  location?: string;
  phone?: string;
  phoneType?: string;
  carrier?: string;
  reportYear?: number;
  isPrimary?: boolean;
  propertyValue?: number;
  yearBuilt?: number;
  detailLink: string;
}

export interface TpsSearchOptions {
  maxPages: number;
  filters: TpsFilters;
  concurrency: number;
  onProgress?: (message: string) => void;
  getCachedDetails?: (links: string[]) => Promise<Map<string, TpsDetailResult>>;
  setCachedDetails?: (items: Array<{ link: string; data: TpsDetailResult }>) => Promise<void>;
}

// 统一队列模式的详情任务
export interface DetailTask {
  searchResult: TpsSearchResult;
  subTaskIndex: number;
  name: string;
  location: string;
}

// ==================== 辅助函数 ====================

/**
 * 通过 Scrape.do 代理获取页面
 * 
 * 支持即时重试（2次）和延后重试标记
 */
export async function fetchViaProxy(
  url: string,
  token: string,
  retryCount: number = 0
): Promise<{ html: string | null; status: number; shouldDeferRetry: boolean }> {
  const encodedUrl = encodeURIComponent(url);
  // 添加 timeout=30000 参数，与应用层超时保持一致
  const apiUrl = `${TPS_CONFIG.SCRAPEDO_BASE}/?token=${token}&url=${encodedUrl}&super=true&geoCode=us&timeout=30000`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TPS_CONFIG.REQUEST_TIMEOUT);
  
  try {
    const response = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    clearTimeout(timeoutId);
    
    if (response.status === 429) {
      // 429 限流：尝试即时重试
      if (retryCount < TPS_CONFIG.IMMEDIATE_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, TPS_CONFIG.IMMEDIATE_RETRY_DELAY));
        return fetchViaProxy(url, token, retryCount + 1);
      }
      // 即时重试用尽，标记为需要延后重试
      return { html: null, status: 429, shouldDeferRetry: true };
    }
    
    if (!response.ok) {
      return { html: null, status: response.status, shouldDeferRetry: false };
    }
    
    const html = await response.text();
    return { html, status: 200, shouldDeferRetry: false };
    
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      // 超时：尝试即时重试
      if (retryCount < TPS_CONFIG.IMMEDIATE_RETRIES) {
        return fetchViaProxy(url, token, retryCount + 1);
      }
      return { html: null, status: 408, shouldDeferRetry: true };
    }
    
    return { html: null, status: 500, shouldDeferRetry: false };
  }
}

/**
 * 解析搜索结果页
 * 
 * 使用两种方法提取年龄（DOM + 正则），与 EXE 客户端一致
 */
export function parseSearchPage(html: string): { results: TpsSearchResult[]; totalRecords: number } {
  const $ = cheerio.load(html);
  const results: TpsSearchResult[] = [];
  
  // 获取总记录数（使用多个选择器，与 EXE 客户端一致）
  let totalRecords = 0;
  const recordCountSelectors = [
    '.record-count .col-7',
    '.record-count .col',
    '.search-results-header',
    '.results-header'
  ];
  
  for (const selector of recordCountSelectors) {
    const text = $(selector).first().text();
    const match = text.match(/(\d+)\s*(?:records?|results?)/i);
    if (match) {
      totalRecords = parseInt(match[1], 10);
      break;
    }
  }
  
  // 解析搜索结果卡片
  // 尝试多种选择器来匹配卡片
  const cardSelectors = ['.card-summary', '.person-card', '.search-result-card', '[data-detail-link]'];
  let $cards = $();
  
  for (const selector of cardSelectors) {
    $cards = $(selector);
    if ($cards.length > 0) break;
  }
  
  // 如果没有找到卡片，记录调试信息
  if ($cards.length === 0) {
    console.log('[TPS Debug] No cards found. Page structure:', {
      bodyLength: $('body').text().length,
      hasCloudflare: $('body').text().includes('Cloudflare'),
      hasVerifying: $('body').text().includes('Verifying'),
      firstDivClasses: $('div').first().attr('class'),
    });
  }
  
  $cards.each((_, card) => {
    const $card = $(card);
    
    // 获取姓名（多种选择器，按优先级尝试）
    // TPS 有两种卡片结构：.h4 和 .content-header
    let name = $card.find('.h4').first().text().trim();
    if (!name) name = $card.find('.content-header').first().text().trim();
    if (!name) name = $card.find('.name, .person-name, h4, h3').first().text().trim();
    if (!name) return;
    
    // 获取年龄（两种方法，与 EXE 客户端一致）
    let age: number | undefined;
    
    // 方法 1: DOM 选择器
    const ageText = $card.find('.content-value').first().text().trim();
    if (ageText) {
      const ageMatch = ageText.match(/Age\s*(\d+)/i);
      if (ageMatch) {
        age = parseInt(ageMatch[1], 10);
      }
    }
    
    // 方法 2: 正则匹配整个卡片文本（备用）
    if (!age) {
      const cardText = $card.text();
      const ageMatch = cardText.match(/Age\s*(\d+)/i);
      if (ageMatch) {
        age = parseInt(ageMatch[1], 10);
      }
    }
    
    // 获取位置
    const location = $card.find('.content-value').eq(1).text().trim() || '';
    
    // 获取详情链接（多种选择器）
    let detailLink = $card.find('a[href*="/find/person/"]').first().attr('href') || '';
    if (!detailLink) detailLink = $card.find('a[href*="/person/"]').first().attr('href') || '';
    if (!detailLink) detailLink = $card.attr('data-detail-link') || '';
    if (!detailLink) detailLink = $card.find('a').first().attr('href') || '';
    
    // 过滤无效链接
    if (detailLink && !detailLink.includes('#') && detailLink !== '/') {
      results.push({ name, age, location, detailLink });
    }
  });
  
  return { results, totalRecords };
}

/**
 * 解析详情页
 * 
 * 使用两种方法提取电话类型和运营商（DOM + 正则），与 EXE 客户端一致
 */
export function parseDetailPage(html: string, searchResult: TpsSearchResult): TpsDetailResult[] {
  const $ = cheerio.load(html);
  const results: TpsDetailResult[] = [];
  
  // 获取基本信息
  const name = searchResult.name;
  const age = searchResult.age;
  
  // 解析位置
  let city = '';
  let state = '';
  const locationText = $('.location, .address').first().text().trim();
  if (locationText) {
    const parts = locationText.split(',').map(s => s.trim());
    if (parts.length >= 2) {
      city = parts[0];
      state = parts[1].split(' ')[0];
    }
  }
  
  // 获取房产信息
  let propertyValue: number | undefined;
  let yearBuilt: number | undefined;
  
  $('.property-value, [data-property-value]').each((_, el) => {
    const text = $(el).text();
    const valueMatch = text.match(/\$[\d,]+/);
    if (valueMatch) {
      propertyValue = parseInt(valueMatch[0].replace(/[$,]/g, ''), 10);
    }
  });
  
  $('.year-built, [data-year-built]').each((_, el) => {
    const text = $(el).text();
    const yearMatch = text.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      yearBuilt = parseInt(yearMatch[0], 10);
    }
  });
  
  // 解析电话号码
  $('[data-link-to-more="phone"]').each((_, phoneSection) => {
    const $section = $(phoneSection);
    
    // 获取电话号码
    const phone = $section.find('.content-value').first().text().trim().replace(/\D/g, '');
    if (!phone || phone.length < 10) return;
    
    // 获取电话类型（两种方法）
    let phoneType = '';
    
    // 方法 1: DOM 选择器
    const typeEl = $section.find('.phone-type, .type').first();
    if (typeEl.length) {
      phoneType = typeEl.text().trim();
    }
    
    // 方法 2: 文本判断（备用）
    if (!phoneType) {
      const sectionText = $section.text().toLowerCase();
      if (sectionText.includes('wireless') || sectionText.includes('mobile') || sectionText.includes('cell')) {
        phoneType = 'Wireless';
      } else if (sectionText.includes('landline') || sectionText.includes('land line')) {
        phoneType = 'Landline';
      } else if (sectionText.includes('voip')) {
        phoneType = 'VoIP';
      }
    }
    
    // 获取运营商（两种方法）
    let carrier = '';
    
    // 方法 1: DOM 选择器
    const carrierEl = $section.find('.carrier, .provider').first();
    if (carrierEl.length) {
      carrier = carrierEl.text().trim();
    }
    
    // 方法 2: 正则匹配（备用）
    if (!carrier) {
      const sectionText = $section.text();
      const carrierPatterns = [
        /(?:carrier|provider)[:\s]*([A-Za-z\s]+?)(?:\s*-|\s*\(|$)/i,
        /(T-Mobile|AT&T|Verizon|Sprint|Comcast|Spectrum|Xfinity)/i
      ];
      for (const pattern of carrierPatterns) {
        const match = sectionText.match(pattern);
        if (match) {
          carrier = match[1].trim();
          break;
        }
      }
    }
    
    // 获取报告年份
    let reportYear: number | undefined;
    const yearText = $section.find('.report-date, .date').first().text();
    const yearMatch = yearText.match(/\b(20\d{2})\b/);
    if (yearMatch) {
      reportYear = parseInt(yearMatch[1], 10);
    }
    
    // 判断是否为主号
    const isPrimary = $section.hasClass('primary') || 
                      $section.find('.primary').length > 0 ||
                      $section.text().toLowerCase().includes('primary');
    
    results.push({
      name,
      age,
      city,
      state,
      location: city && state ? `${city}, ${state}` : (city || state || ''),
      phone,
      phoneType,
      carrier,
      reportYear,
      isPrimary,
      propertyValue,
      yearBuilt,
      detailLink: searchResult.detailLink,
    });
  });
  
  // 如果没有找到电话，返回基本信息
  if (results.length === 0) {
    results.push({
      name,
      age,
      city,
      state,
      location: city && state ? `${city}, ${state}` : (city || state || ''),
      detailLink: searchResult.detailLink,
    });
  }
  
  return results;
}

/**
 * 检查结果是否应该被包含（过滤逻辑）
 * 
 * 过滤条件：
 * - 年龄范围
 * - 电话年份
 * - 房产价值
 * - T-Mobile 运营商
 * - Comcast/Spectrum 运营商
 * - 固话类型
 */
export function shouldIncludeResult(result: TpsDetailResult, filters: TpsFilters): boolean {
  // 年龄过滤
  if (result.age !== undefined) {
    if (filters.minAge !== undefined && result.age < filters.minAge) return false;
    if (filters.maxAge !== undefined && result.age > filters.maxAge) return false;
  }
  
  // 电话年份过滤
  if (filters.minYear !== undefined && result.reportYear !== undefined) {
    if (result.reportYear < filters.minYear) return false;
  }
  
  // 房产价值过滤（修复：如果设置了最低房产价值，没有房产信息的也过滤）
  if (filters.minPropertyValue !== undefined && filters.minPropertyValue > 0) {
    if (!result.propertyValue || result.propertyValue < filters.minPropertyValue) return false;
  }
  
  // T-Mobile 过滤
  if (filters.excludeTMobile && result.carrier) {
    if (result.carrier.toLowerCase().includes('t-mobile') || 
        result.carrier.toLowerCase().includes('tmobile')) {
      return false;
    }
  }
  
  // Comcast/Spectrum 过滤
  if (filters.excludeComcast && result.carrier) {
    const carrierLower = result.carrier.toLowerCase();
    if (carrierLower.includes('comcast') || 
        carrierLower.includes('spectrum') ||
        carrierLower.includes('xfinity')) {
      return false;
    }
  }
  
  // 固话过滤（修复：不区分大小写）
  if (filters.excludeLandline && result.phoneType) {
    if (result.phoneType.toLowerCase() === 'landline') {
      return false;
    }
  }
  
  return true;
}

/**
 * 批量获取页面（固定并发）
 * 
 * 使用固定的并发数，稳定可靠
 */
async function fetchBatch(
  urls: string[],
  token: string,
  concurrency: number,
  onProgress?: (message: string) => void
): Promise<{ results: Map<string, string>; deferredUrls: string[] }> {
  const results = new Map<string, string>();
  const deferredUrls: string[] = [];
  
  // 分批处理
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    
    const batchPromises = batch.map(async (url) => {
      const { html, status, shouldDeferRetry } = await fetchViaProxy(url, token);
      
      if (html) {
        results.set(url, html);
      } else if (shouldDeferRetry) {
        deferredUrls.push(url);
      }
      
      return { url, status };
    });
    
    await Promise.all(batchPromises);
    
    // 批次间延迟
    if (i + concurrency < urls.length) {
      await new Promise(resolve => setTimeout(resolve, TPS_CONFIG.BATCH_DELAY));
    }
  }
  
  return { results, deferredUrls };
}

/**
 * 执行延后重试
 * 
 * 在所有请求完成后，对 429 失败的请求进行延后重试
 * 最多重试 2 次，每次间隔 2 秒
 */
async function executeDeferredRetry(
  urls: string[],
  token: string,
  concurrency: number,
  onProgress?: (message: string) => void
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  let remainingUrls = [...urls];
  
  for (let retry = 0; retry < TPS_CONFIG.DEFERRED_RETRIES && remainingUrls.length > 0; retry++) {
    onProgress?.(`🔄 延后重试 ${retry + 1}/${TPS_CONFIG.DEFERRED_RETRIES}，${remainingUrls.length} 个请求`);
    
    // 等待延后重试延迟
    await new Promise(resolve => setTimeout(resolve, TPS_CONFIG.DEFERRED_RETRY_DELAY));
    
    // 降低并发进行重试
    const retryConcurrency = Math.max(1, Math.floor(concurrency / 2));
    const { results: retryResults, deferredUrls } = await fetchBatch(
      remainingUrls,
      token,
      retryConcurrency,
      onProgress
    );
    
    // 合并结果
    for (const [url, html] of retryResults) {
      results.set(url, html);
    }
    
    remainingUrls = deferredUrls;
  }
  
  if (remainingUrls.length > 0) {
    onProgress?.(`⚠️ ${remainingUrls.length} 个请求在延后重试后仍然失败`);
  }
  
  return results;
}

// ==================== 统一队列模式函数（新增） ====================

/**
 * 仅执行搜索阶段（不获取详情）
 * 
 * 用于统一队列模式：先收集所有搜索结果，再统一获取详情
 * 
 * @param name 搜索姓名
 * @param location 搜索地点（可选）
 * @param token Scrape.do API token
 * @param maxPages 最大页数
 * @param filters 过滤条件（用于年龄初筛）
 * @param onProgress 进度回调
 */
export async function searchOnly(
  name: string,
  location: string,
  token: string,
  maxPages: number,
  filters: TpsFilters,
  onProgress?: (message: string) => void
): Promise<{
  success: boolean;
  searchResults: TpsSearchResult[];
  stats: {
    searchPageRequests: number;
    filteredOut: number;
  };
  error?: string;
}> {
  const stats = {
    searchPageRequests: 0,
    filteredOut: 0,
  };
  
  try {
    // 构建搜索 URL
    const searchParams = new URLSearchParams();
    searchParams.set('name', name);
    if (location) {
      searchParams.set('citystatezip', location);
    }
    
    const baseSearchUrl = `${TPS_CONFIG.TPS_BASE}/results?${searchParams.toString()}`;
    
    // 获取第一页（确定总记录数）
    onProgress?.(`📄 获取搜索结果第 1 页...`);
    const { html: firstPageHtml, status: firstPageStatus } = await fetchViaProxy(baseSearchUrl, token);
    stats.searchPageRequests++;
    
    if (!firstPageHtml) {
      return {
        success: false,
        searchResults: [],
        stats,
        error: `获取第一页失败，状态码: ${firstPageStatus}`,
      };
    }
    
    const { results: firstPageResults, totalRecords } = parseSearchPage(firstPageHtml);
    onProgress?.(`📊 找到 ${totalRecords} 条记录`);
    
    // 计算需要获取的页数
    const totalPages = Math.min(
      maxPages,
      Math.ceil(totalRecords / TPS_CONFIG.RESULTS_PER_PAGE)
    );
    
    // 收集所有搜索结果
    let allSearchResults = [...firstPageResults];
    
    // 获取剩余搜索页（使用较低并发，因为搜索页数量有限）
    if (totalPages > 1) {
      const remainingPageUrls: string[] = [];
      for (let page = 2; page <= totalPages; page++) {
        remainingPageUrls.push(`${baseSearchUrl}&page=${page}`);
      }
      
      onProgress?.(`📄 获取剩余 ${remainingPageUrls.length} 页搜索结果...`);
      
      // 搜索页使用较低并发（5），因为数量有限且需要快速完成
      const { results: pageResults, deferredUrls } = await fetchBatch(
        remainingPageUrls,
        token,
        5,
        onProgress
      );
      
      stats.searchPageRequests += remainingPageUrls.length;
      
      // 解析搜索结果
      for (const [url, html] of pageResults) {
        const { results } = parseSearchPage(html);
        allSearchResults.push(...results);
      }
      
      // 延后重试
      if (deferredUrls.length > 0) {
        const retryResults = await executeDeferredRetry(deferredUrls, token, 5, onProgress);
        
        for (const [url, html] of retryResults) {
          const { results } = parseSearchPage(html);
          allSearchResults.push(...results);
        }
      }
    }
    
    // 搜索页初筛（年龄过滤 + 已故人员过滤）
    // 注意：如果搜索页没有解析到年龄，会保留该记录，在详情页再次过滤
    // 这样可以避免遗漏潜在符合条件的记录，同时详情页的 shouldIncludeResult 会进行二次过滤
    let filteredOutInSearch = 0;
    const filteredSearchResults = allSearchResults.filter(result => {
      // 跳过已故人员（姓名包含 deceased）
      if (result.name.toLowerCase().includes('deceased')) {
        filteredOutInSearch++;
        return false;
      }
      
      // 年龄初筛：只有当搜索页有年龄信息时才过滤
      // 如果没有年龄信息，保留该记录，在详情页再次验证
      if (result.age !== undefined) {
        if (filters.minAge !== undefined && result.age < filters.minAge) {
          filteredOutInSearch++;
          return false;
        }
        if (filters.maxAge !== undefined && result.age > filters.maxAge) {
          filteredOutInSearch++;
          return false;
        }
      }
      // 没有年龄信息的记录保留，等详情页进一步过滤
      
      return true;
    });
    
    stats.filteredOut += filteredOutInSearch;
    onProgress?.(`🔍 初筛后 ${filteredSearchResults.length} 条记录（过滤 ${filteredOutInSearch} 条）`);
    
    return {
      success: true,
      searchResults: filteredSearchResults,
      stats,
    };
    
  } catch (error: any) {
    return {
      success: false,
      searchResults: [],
      stats,
      error: error.message,
    };
  }
}

/**
 * 批量获取详情页（用于统一队列模式）
 * 
 * 使用指定的并发数获取详情页
 * 
 * @param tasks 详情任务列表
 * @param token Scrape.do API token
 * @param concurrency 并发数
 * @param filters 过滤条件
 * @param onProgress 进度回调
 * @param getCachedDetails 缓存读取函数
 * @param setCachedDetails 缓存写入函数
 */
export async function fetchDetailsInBatch(
  tasks: DetailTask[],
  token: string,
  concurrency: number,
  filters: TpsFilters,
  onProgress?: (message: string) => void,
  getCachedDetails?: (links: string[]) => Promise<Map<string, TpsDetailResult>>,
  setCachedDetails?: (items: Array<{ link: string; data: TpsDetailResult }>) => Promise<void>
): Promise<{
  results: Array<{ task: DetailTask; details: TpsDetailResult[] }>;
  stats: {
    detailPageRequests: number;
    cacheHits: number;
    filteredOut: number;
  };
}> {
  const stats = {
    detailPageRequests: 0,
    cacheHits: 0,
    filteredOut: 0,
  };
  
  const results: Array<{ task: DetailTask; details: TpsDetailResult[] }> = [];
  
  // 去重详情链接
  const uniqueLinks = [...new Set(tasks.map(t => t.searchResult.detailLink))];
  
  // 检查缓存
  let cachedDetails = new Map<string, TpsDetailResult>();
  if (getCachedDetails) {
    cachedDetails = await getCachedDetails(uniqueLinks);
    stats.cacheHits = cachedDetails.size;
    if (cachedDetails.size > 0) {
      onProgress?.(`💾 缓存命中 ${cachedDetails.size} 条`);
    }
  }
  
  // 需要获取的链接
  const linksToFetch = uniqueLinks.filter(link => !cachedDetails.has(link));
  
  // 构建链接到任务的映射
  const linkToTasks = new Map<string, DetailTask[]>();
  for (const task of tasks) {
    const link = task.searchResult.detailLink;
    if (!linkToTasks.has(link)) {
      linkToTasks.set(link, []);
    }
    linkToTasks.get(link)!.push(task);
  }
  
  // 处理缓存命中的结果
  for (const [link, cachedResult] of cachedDetails) {
    const tasksForLink = linkToTasks.get(link) || [];
    for (const task of tasksForLink) {
      if (shouldIncludeResult(cachedResult, filters)) {
        results.push({ task, details: [cachedResult] });
      } else {
        stats.filteredOut++;
      }
    }
  }
  
  // 获取新详情
  if (linksToFetch.length > 0) {
    onProgress?.(`📋 获取 ${linksToFetch.length} 条详情（${concurrency} 并发）...`);
    
    const detailUrls = linksToFetch.map(link => 
      link.startsWith('http') ? link : `${TPS_CONFIG.TPS_BASE}${link}`
    );
    
    stats.detailPageRequests = detailUrls.length;
    
    const { results: detailHtmlResults, deferredUrls } = await fetchBatch(
      detailUrls,
      token,
      concurrency,
      onProgress
    );
    
    // 解析详情并缓存
    const newCacheItems: Array<{ link: string; data: TpsDetailResult }> = [];
    
    for (const [url, html] of detailHtmlResults) {
      const link = linksToFetch.find(l => url.includes(l)) || url;
      const tasksForLink = linkToTasks.get(link) || [];
      
      for (const task of tasksForLink) {
        const details = parseDetailPage(html, task.searchResult);
        const filteredDetails: TpsDetailResult[] = [];
        
        for (const detail of details) {
          if (shouldIncludeResult(detail, filters)) {
            filteredDetails.push(detail);
            newCacheItems.push({ link: detail.detailLink, data: detail });
          } else {
            stats.filteredOut++;
          }
        }
        
        if (filteredDetails.length > 0) {
          results.push({ task, details: filteredDetails });
        }
      }
    }
    
    // 延后重试
    if (deferredUrls.length > 0) {
      onProgress?.(`🔄 延后重试 ${deferredUrls.length} 个详情页...`);
      const retryResults = await executeDeferredRetry(deferredUrls, token, Math.floor(concurrency / 2), onProgress);
      
      for (const [url, html] of retryResults) {
        const link = linksToFetch.find(l => url.includes(l)) || url;
        const tasksForLink = linkToTasks.get(link) || [];
        
        for (const task of tasksForLink) {
          const details = parseDetailPage(html, task.searchResult);
          const filteredDetails: TpsDetailResult[] = [];
          
          for (const detail of details) {
            if (shouldIncludeResult(detail, filters)) {
              filteredDetails.push(detail);
              newCacheItems.push({ link: detail.detailLink, data: detail });
            } else {
              stats.filteredOut++;
            }
          }
          
          if (filteredDetails.length > 0) {
            results.push({ task, details: filteredDetails });
          }
        }
      }
    }
    
    // 保存缓存
    if (setCachedDetails && newCacheItems.length > 0) {
      await setCachedDetails(newCacheItems);
    }
  }
  
  return { results, stats };
}

// ==================== 原有主搜索函数（保持向后兼容） ====================

/**
 * 完整搜索流程（原有函数，保持向后兼容）
 * 
 * 固定 10 并发，稳定可靠
 * 
 * @param name 搜索姓名
 * @param location 搜索地点（可选）
 * @param token Scrape.do API token
 * @param options 搜索选项
 */
export async function fullSearch(
  name: string,
  location: string,
  token: string,
  options: TpsSearchOptions
): Promise<{
  success: boolean;
  results: TpsDetailResult[];
  stats: {
    searchPageRequests: number;
    detailPageRequests: number;
    cacheHits: number;
    filteredOut: number;
    rateLimitedRequests: number;
    immediateRetries: number;
    deferredRetries: number;
  };
  error?: string;
}> {
  const { maxPages, filters, concurrency, onProgress, getCachedDetails, setCachedDetails } = options;
  
  const stats = {
    searchPageRequests: 0,
    detailPageRequests: 0,
    cacheHits: 0,
    filteredOut: 0,
    rateLimitedRequests: 0,
    immediateRetries: 0,
    deferredRetries: 0,
  };
  
  try {
    // 构建搜索 URL
    const searchParams = new URLSearchParams();
    searchParams.set('name', name);
    if (location) {
      searchParams.set('citystatezip', location);
    }
    
    const baseSearchUrl = `${TPS_CONFIG.TPS_BASE}/results?${searchParams.toString()}`;
    
    // 获取第一页（确定总记录数）
    onProgress?.(`📄 获取搜索结果第 1 页...`);
    const { html: firstPageHtml, status: firstPageStatus } = await fetchViaProxy(baseSearchUrl, token);
    stats.searchPageRequests++;
    
    if (!firstPageHtml) {
      return {
        success: false,
        results: [],
        stats,
        error: `获取第一页失败，状态码: ${firstPageStatus}`,
      };
    }
    
    const { results: firstPageResults, totalRecords } = parseSearchPage(firstPageHtml);
    onProgress?.(`📊 找到 ${totalRecords} 条记录`);
    
    // 计算需要获取的页数
    const totalPages = Math.min(
      maxPages,
      Math.ceil(totalRecords / TPS_CONFIG.RESULTS_PER_PAGE)
    );
    
    // 收集所有搜索结果
    let allSearchResults = [...firstPageResults];
    
    // 获取剩余搜索页（并发）
    if (totalPages > 1) {
      const remainingPageUrls: string[] = [];
      for (let page = 2; page <= totalPages; page++) {
        remainingPageUrls.push(`${baseSearchUrl}&page=${page}`);
      }
      
      onProgress?.(`📄 获取剩余 ${remainingPageUrls.length} 页搜索结果...`);
      
      const { results: pageResults, deferredUrls } = await fetchBatch(
        remainingPageUrls,
        token,
        concurrency,
        onProgress
      );
      
      stats.searchPageRequests += remainingPageUrls.length;
      
      // 解析搜索结果
      for (const [url, html] of pageResults) {
        const { results } = parseSearchPage(html);
        allSearchResults.push(...results);
      }
      
      // 延后重试
      if (deferredUrls.length > 0) {
        stats.rateLimitedRequests += deferredUrls.length;
        const retryResults = await executeDeferredRetry(deferredUrls, token, concurrency, onProgress);
        stats.deferredRetries += deferredUrls.length;
        
        for (const [url, html] of retryResults) {
          const { results } = parseSearchPage(html);
          allSearchResults.push(...results);
        }
      }
    }
    
    // 搜索页初筛（年龄过滤）
    const filteredSearchResults = allSearchResults.filter(result => {
      // 跳过已故人员
      if (result.name.toLowerCase().includes('deceased')) return false;
      
      // 年龄初筛
      if (result.age !== undefined) {
        if (filters.minAge !== undefined && result.age < filters.minAge) {
          stats.filteredOut++;
          return false;
        }
        if (filters.maxAge !== undefined && result.age > filters.maxAge) {
          stats.filteredOut++;
          return false;
        }
      }
      
      return true;
    });
    
    onProgress?.(`🔍 初筛后 ${filteredSearchResults.length} 条记录需要获取详情`);
    
    // 去重详情链接
    const uniqueDetailLinks = [...new Set(filteredSearchResults.map(r => r.detailLink))];
    
    // 检查缓存
    let cachedDetails = new Map<string, TpsDetailResult>();
    if (getCachedDetails) {
      cachedDetails = await getCachedDetails(uniqueDetailLinks);
      stats.cacheHits = cachedDetails.size;
      onProgress?.(`💾 缓存命中 ${cachedDetails.size} 条`);
    }
    
    // 需要获取的详情链接
    const linksToFetch = uniqueDetailLinks.filter(link => !cachedDetails.has(link));
    
    // 获取详情页（并发）
    const allDetailResults: TpsDetailResult[] = [];
    
    // 添加缓存结果
    for (const [link, result] of cachedDetails) {
      if (shouldIncludeResult(result, filters)) {
        allDetailResults.push(result);
      } else {
        stats.filteredOut++;
      }
    }
    
    // 获取新详情
    if (linksToFetch.length > 0) {
      onProgress?.(`📋 获取 ${linksToFetch.length} 条详情...`);
      
      const detailUrls = linksToFetch.map(link => 
        link.startsWith('http') ? link : `${TPS_CONFIG.TPS_BASE}${link}`
      );
      
      const { results: detailHtmlResults, deferredUrls } = await fetchBatch(
        detailUrls,
        token,
        concurrency,
        onProgress
      );
      
      stats.detailPageRequests += detailUrls.length;
      
      // 解析详情并缓存
      const newCacheItems: Array<{ link: string; data: TpsDetailResult }> = [];
      
      for (const [url, html] of detailHtmlResults) {
        const link = linksToFetch.find(l => url.includes(l)) || url;
        const searchResult = filteredSearchResults.find(r => url.includes(r.detailLink));
        
        if (searchResult) {
          const details = parseDetailPage(html, searchResult);
          
          for (const detail of details) {
            if (shouldIncludeResult(detail, filters)) {
              allDetailResults.push(detail);
              newCacheItems.push({ link: detail.detailLink, data: detail });
            } else {
              stats.filteredOut++;
            }
          }
        }
      }
      
      // 延后重试
      if (deferredUrls.length > 0) {
        stats.rateLimitedRequests += deferredUrls.length;
        const retryResults = await executeDeferredRetry(deferredUrls, token, concurrency, onProgress);
        stats.deferredRetries += deferredUrls.length;
        
        for (const [url, html] of retryResults) {
          const link = linksToFetch.find(l => url.includes(l)) || url;
          const searchResult = filteredSearchResults.find(r => url.includes(r.detailLink));
          
          if (searchResult) {
            const details = parseDetailPage(html, searchResult);
            
            for (const detail of details) {
              if (shouldIncludeResult(detail, filters)) {
                allDetailResults.push(detail);
                newCacheItems.push({ link: detail.detailLink, data: detail });
              } else {
                stats.filteredOut++;
              }
            }
          }
        }
      }
      
      // 保存缓存
      if (setCachedDetails && newCacheItems.length > 0) {
        await setCachedDetails(newCacheItems);
      }
    }
    
    // 电话号码去重
    const seenPhones = new Set<string>();
    const uniqueResults = allDetailResults.filter(result => {
      if (result.phone) {
        if (seenPhones.has(result.phone)) {
          return false;
        }
        seenPhones.add(result.phone);
      }
      return true;
    });
    
    onProgress?.(`✅ 完成，共 ${uniqueResults.length} 条唯一结果`);
    
    return {
      success: true,
      results: uniqueResults,
      stats,
    };
    
  } catch (error: any) {
    return {
      success: false,
      results: [],
      stats,
      error: error.message,
    };
  }
}
