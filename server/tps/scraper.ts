import * as cheerio from 'cheerio';

// ==================== Scrape.do API ====================

// 超时配置
const SCRAPE_TIMEOUT_MS = 5000;  // 5 秒超时
const SCRAPE_MAX_RETRIES = 1;    // 最多重试 1 次

/**
 * 使用 Scrape.do API 获取页面（带超时和重试）
 * 
 * 优化策略：
 * - 首次请求：5 秒超时
 * - 超时后自动重试一次（5 秒超时）
 * - 提升整体响应速度，避免慢请求阻塞
 */
async function fetchWithScrapedo(url: string, token: string): Promise<string> {
  const encodedUrl = encodeURIComponent(url);
  // Scrape.do 的 timeout 参数单位是毫秒
  const apiUrl = `https://api.scrape.do/?token=${token}&url=${encodedUrl}&super=true&geoCode=us&timeout=${SCRAPE_TIMEOUT_MS}`;
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= SCRAPE_MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS + 2000); // 客户端超时比 API 超时多 2 秒
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Scrape.do API 请求失败: ${response.status} ${response.statusText}`);
      }
      
      return await response.text();
    } catch (error: any) {
      lastError = error;
      
      // 如果是最后一次尝试，不再重试
      if (attempt >= SCRAPE_MAX_RETRIES) {
        break;
      }
      
      // 超时或网络错误时重试
      const isTimeout = error.name === 'AbortError' || error.message?.includes('timeout');
      const isNetworkError = error.message?.includes('fetch') || error.message?.includes('network');
      
      if (isTimeout || isNetworkError) {
        console.log(`[fetchWithScrapedo] 请求超时/失败，正在重试 (${attempt + 1}/${SCRAPE_MAX_RETRIES})...`);
        continue;
      }
      
      // 其他错误直接抛出
      throw error;
    }
  }
  
  throw lastError || new Error('请求失败');
}

// ==================== 配置常量 ====================

export const TPS_CONFIG = {
  TASK_CONCURRENCY: 4,      // 同时执行的搜索任务数
  SCRAPEDO_CONCURRENCY: 10, // 每个任务的 Scrape.do 并发数
  TOTAL_CONCURRENCY: 40,    // 总并发数 (4 * 10)
  MAX_SAFE_PAGES: 25,       // 最大搜索页数
  SEARCH_COST: 0.3,         // 搜索页成本
  DETAIL_COST: 0.3,         // 详情页成本
};

// ==================== 类型定义 ====================

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
  detailLink?: string;
}

export interface TpsFilters {
  minAge?: number;
  maxAge?: number;
  minYear?: number;
  minPropertyValue?: number;
  excludeTMobile?: boolean;
  excludeComcast?: boolean;
  excludeLandline?: boolean;
}

export interface DetailTask {
  detailLink: string;
  searchName: string;
  searchLocation: string;
  searchResult: TpsSearchResult;
}

// ==================== 辅助函数 (新增) ====================

/**
 * 构建搜索 URL
 */
function buildSearchUrl(name: string, location: string, page: number): string {
  const baseUrl = 'https://www.truepeoplesearch.com/results';
  const params = new URLSearchParams();
  params.set('name', name);
  if (location) params.set('citystatezip', location);
  if (page > 1) params.set('page', page.toString());
  return `${baseUrl}?${params.toString()}`;
}

/**
 * 详情链接去重
 */
function deduplicateByDetailLink(results: TpsSearchResult[]): TpsSearchResult[] {
  const seenLinks = new Set<string>();
  const uniqueResults: TpsSearchResult[] = [];
  for (const result of results) {
    if (result.detailLink && !seenLinks.has(result.detailLink)) {
      seenLinks.add(result.detailLink);
      uniqueResults.push(result);
    }
  }
  return uniqueResults;
}

// ==================== 搜索页解析 (重构) ====================

/**
 * 解析搜索结果页面，提取人员列表和元数据
 */
function parseSearchPageWithTotal(html: string): {
  results: TpsSearchResult[];
  totalRecords: number;
  hasNextPage: boolean;
} {
  const $ = cheerio.load(html);
  
  // 1. 解析总记录数
  let totalRecords = 0;
  const recordText = $('.record-count .col-7, .record-count .col').first().text();
  const totalMatch = recordText.match(/(\d+)\s*records?\s*found/i);
  if (totalMatch) {
    totalRecords = parseInt(totalMatch[1], 10);
  }

  // 2. 解析结果列表
  const results = parseSearchPage(html);

  // 3. 检查是否有下一页
  const hasNextPage = $('#btnNextPage').length > 0;

  return { results, totalRecords, hasNextPage };
}

/**
 * 解析搜索结果页面，仅提取人员列表
 */
export function parseSearchPage(html: string): TpsSearchResult[] {
  const $ = cheerio.load(html);
  const results: TpsSearchResult[] = [];
  
  $('.card-summary').each((index, card) => {
    const $card = $(card);
    let name = '';
    const h4Elem = $card.find('.h4').first();
    if (h4Elem.length && h4Elem.text().trim()) {
      name = h4Elem.text().trim();
    } else {
      const headerElem = $card.find('.content-header').first();
      if (headerElem.length) {
        name = headerElem.text().trim();
      }
    }
    
    const ageText = $card.find('.content-value').first().text().trim();
    const ageMatch = ageText.match(/(\d+)/);
    const age = ageMatch ? parseInt(ageMatch[1], 10) : undefined;
    
    const location = $card.find('.content-value').eq(1).text().trim() || '';
    const detailLink = $card.find('a[href*="/find/person/"]').first().attr('href') || '';
    
    if (detailLink) {
      results.push({ name, age, location, detailLink });
    }
  });
  
  return results;
}

/**
 * 搜索页年龄初筛
 */
export function preFilterByAge(results: TpsSearchResult[], filters: TpsFilters): TpsSearchResult[] {
  if (!filters.minAge && !filters.maxAge) {
    return results;
  }
  
  return results.filter(r => {
    if (r.age === undefined) return true;
    if (filters.minAge !== undefined && r.age < filters.minAge - 5) return false;
    if (filters.maxAge !== undefined && r.age > filters.maxAge + 5) return false;
    return true;
  });
}

// ==================== 详情页解析 (保持不变) ====================

export function parseDetailPage(html: string, searchResult: TpsSearchResult): TpsDetailResult[] {
  const $ = cheerio.load(html);
  const results: TpsDetailResult[] = [];
  const name = searchResult.name;
  const age = searchResult.age;
  let city = '';
  let state = '';
  const title = $('title').text();
  const titleMatch = title.match(/in\s+([^,]+),\s*([A-Z]{2})/);
  if (titleMatch) {
    city = titleMatch[1].trim();
    state = titleMatch[2].trim();
  }
  if (!city || !state) {
    const currentAddressSection = $('[data-link-to-more="address"]').first().parent();
    const addressText = currentAddressSection.find('.dt-ln, .dt-sb').text();
    const addressMatch = addressText.match(/([A-Za-z\s]+),\s*([A-Z]{2})\s+(\d{5})/);
    if (addressMatch) {
      city = city || addressMatch[1].trim();
      state = state || addressMatch[2].trim();
    }
  }
  let propertyValue: number | undefined;
  let yearBuilt: number | undefined;
  const pageText = $('body').text();
  const propertyMatch = pageText.match(/(?:property|home)\s*value[:\s]*\$?([\d,]+)/i);
  if (propertyMatch) {
    propertyValue = parseInt(propertyMatch[1].replace(/,/g, ''), 10);
  }
  const yearBuiltMatch = pageText.match(/(?:year\s*built|built\s*in)[:\s]*(\d{4})/i);
  if (yearBuiltMatch) {
    yearBuilt = parseInt(yearBuiltMatch[1], 10);
  }
  $('.col-12.col-md-6.mb-3').each((_, container) => {
    const $container = $(container);
    const phoneLink = $container.find('a[data-link-to-more="phone"]');
    if (!phoneLink.length) return;
    let phone = '';
    const href = phoneLink.attr('href') || '';
    const hrefMatch = href.match(/\/find\/phone\/(\d+)/);
    if (hrefMatch) {
      phone = hrefMatch[1];
    } else {
      const phoneText = phoneLink.text().replace(/\D/g, '');
      if (phoneText.length >= 10) {
        phone = phoneText;
      }
    }
    if (!phone || phone.length < 10) return;
    let phoneType = '';
    const containerText = $container.text();
    if (containerText.includes('Wireless') || containerText.includes('wireless')) {
      phoneType = 'Wireless';
    } else if (containerText.includes('Landline') || containerText.includes('landline')) {
      phoneType = 'Landline';
    } else if (containerText.includes('VoIP') || containerText.includes('voip')) {
      phoneType = 'VoIP';
    }
    let carrier = '';
    const dtLn = $container.find('.dt-ln, .dt-sb');
    dtLn.each((_, el) => {
      const text = $(el).text().trim();
      if (text && !text.includes('reported') && !text.includes('Primary') && !text.includes('Phone')) {
        if (/^[A-Za-z\s]+$/.test(text) && text.length > 3) {
          carrier = text;
        }
      }
    });
    let reportYear: number | undefined;
    const reportMatch = containerText.match(/(?:reported|last\s+seen)[:\s]*(?:[A-Za-z]+\s+)?(\d{4})/i);
    if (reportMatch) {
      reportYear = parseInt(reportMatch[1], 10);
    }
    const isPrimary = containerText.toLowerCase().includes('primary');
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
  if (results.length === 0) {
    const phonePattern = /\((\d{3})\)\s*(\d{3})-(\d{4})/g;
    const phones = new Set<string>();
    let match;
    while ((match = phonePattern.exec(html)) !== null) {
      const phone = match[1] + match[2] + match[3];
      phones.add(phone);
    }
    let phoneType = '';
    if (html.includes('Wireless')) phoneType = 'Wireless';
    else if (html.includes('Landline')) phoneType = 'Landline';
    else if (html.includes('VoIP')) phoneType = 'VoIP';
    phones.forEach(phone => {
      results.push({
        name,
        age,
        city,
        state,
        location: city && state ? `${city}, ${state}` : (city || state || ''),
        phone,
        phoneType,
        propertyValue,
        yearBuilt,
        detailLink: searchResult.detailLink,
      });
    });
  }
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

// ==================== 过滤逻辑 (保持不变) ====================

export function shouldIncludeResult(result: TpsDetailResult, filters: TpsFilters): boolean {
  if (result.age !== undefined) {
    if (filters.minAge !== undefined && result.age < filters.minAge) return false;
    if (filters.maxAge !== undefined && result.age > filters.maxAge) return false;
  }
  if (filters.minYear !== undefined && result.reportYear !== undefined) {
    if (result.reportYear < filters.minYear) return false;
  }
  if (filters.minPropertyValue !== undefined && filters.minPropertyValue > 0) {
    if (!result.propertyValue || result.propertyValue < filters.minPropertyValue) return false;
  }
  if (filters.excludeTMobile && result.carrier) {
    const carrierLower = result.carrier.toLowerCase();
    if (carrierLower.includes('t-mobile') || carrierLower.includes('tmobile')) {
      return false;
    }
  }
  if (filters.excludeComcast && result.carrier) {
    const carrierLower = result.carrier.toLowerCase();
    if (carrierLower.includes('comcast') || carrierLower.includes('spectrum') || carrierLower.includes('xfinity')) {
      return false;
    }
  }
  if (filters.excludeLandline && result.phoneType) {
    if (result.phoneType.toLowerCase() === 'landline') {
      return false;
    }
  }
  return true;
}

// ==================== 搜索函数 (核心优化) ====================

export interface SearchOnlyResult {
  success: boolean;
  searchResults: TpsSearchResult[];
  stats: {
    searchPageRequests: number;
    filteredOut: number;
  };
  error?: string;
}

/**
 * [OPTIMIZED] 仅执行搜索，并发获取所有页面
 */
export async function searchOnly(
  name: string,
  location: string,
  token: string,
  maxPages: number,
  filters: TpsFilters,
  onProgress?: (message: string) => void
): Promise<SearchOnlyResult> {
  let searchPageRequests = 0;
  let filteredOut = 0;

  try {
    // 阶段一: 获取第一页，解析总记录数
    const firstPageUrl = buildSearchUrl(name, location, 1);
    onProgress?.(`获取第一页...`);
    
    const firstPageHtml = await fetchWithScrapedo(firstPageUrl, token);
    searchPageRequests++;
    
    const { results: firstResults, totalRecords, hasNextPage } = parseSearchPageWithTotal(firstPageHtml);
    
    if (firstResults.length === 0) {
      onProgress?.(`第一页无结果，搜索结束`);
      return { success: true, searchResults: [], stats: { searchPageRequests, filteredOut } };
    }

    // 计算总页数
    const totalPages = Math.min(
      Math.ceil(totalRecords / 10), // 每页10条结果
      maxPages
    );
    onProgress?.(`找到 ${totalRecords} 条记录，预估总页数: ${totalPages}`);

    // 阶段二: 并发获取剩余搜索页
    const allResults = [...preFilterByAge(firstResults, filters)];
    filteredOut += firstResults.length - allResults.length;

    if (totalPages > 1 && hasNextPage) {
      const remainingUrls: string[] = [];
      for (let page = 2; page <= totalPages; page++) {
        remainingUrls.push(buildSearchUrl(name, location, page));
      }
      
      onProgress?.(`并发获取剩余 ${remainingUrls.length} 页...`);
      
      // 并发获取所有剩余页
      const pagePromises = remainingUrls.map(url => 
        fetchWithScrapedo(url, token).catch(err => {
          onProgress?.(`页面获取失败: ${err.message}`);
          return null; // 错误时返回 null
        })
      );
      
      const pageHtmls = await Promise.all(pagePromises);
      searchPageRequests += remainingUrls.length;
      
      for (const html of pageHtmls) {
        if (html) {
          const pageResults = parseSearchPage(html);
          const filtered = preFilterByAge(pageResults, filters);
          filteredOut += pageResults.length - filtered.length;
          allResults.push(...filtered);
        }
      }
    }

    // 阶段三: 去重
    const uniqueResults = deduplicateByDetailLink(allResults);
    onProgress?.(`搜索完成: 共 ${uniqueResults.length} 条唯一结果 (过滤掉 ${allResults.length - uniqueResults.length} 条重复)`);

    return {
      success: true,
      searchResults: uniqueResults,
      stats: { searchPageRequests, filteredOut },
    };

  } catch (error: any) {
    onProgress?.(`搜索任务失败: ${error.message}`);
    return {
      success: false,
      searchResults: [],
      stats: { searchPageRequests, filteredOut },
      error: error.message || String(error),
    };
  }
}

// ==================== 详情获取函数 (保持不变) ====================

export interface DetailTaskWithIndex {
  searchResult: TpsSearchResult;
  subTaskIndex: number;
  name: string;
  location: string;
}

export interface FetchDetailsResult {
  results: Array<{ task: DetailTaskWithIndex; details: TpsDetailResult[] }>;
  stats: {
    detailPageRequests: number;
    cacheHits: number;
    filteredOut: number;
  };
}

export async function fetchDetailsInBatch(
  tasks: DetailTaskWithIndex[],
  token: string,
  concurrency: number,
  filters: TpsFilters,
  onProgress: (message: string) => void,
  getCachedDetails: (links: string[]) => Promise<Map<string, TpsDetailResult[]>>,
  setCachedDetails: (items: Array<{ link: string; data: TpsDetailResult }>) => Promise<void>
): Promise<FetchDetailsResult> {
  const results: Array<{ task: DetailTaskWithIndex; details: TpsDetailResult[] }> = [];
  let detailPageRequests = 0;
  let cacheHits = 0;
  let filteredOut = 0;
  
  const baseUrl = 'https://www.truepeoplesearch.com';
  const uniqueLinks = [...new Set(tasks.map(t => t.searchResult.detailLink))];
  
  onProgress(`检查缓存: ${uniqueLinks.length} 个链接...`);
  const cachedMap = await getCachedDetails(uniqueLinks);
  
  const tasksToFetch: DetailTaskWithIndex[] = [];
  const tasksByLink = new Map<string, DetailTaskWithIndex[]>();
  
  for (const task of tasks) {
    const link = task.searchResult.detailLink;
    if (!tasksByLink.has(link)) {
      tasksByLink.set(link, []);
    }
    tasksByLink.get(link)!.push(task);
  }
  
  for (const [link, linkTasks] of tasksByLink) {
    const cachedArray = cachedMap.get(link);
    if (cachedArray && cachedArray.length > 0 && cachedArray.some(c => c.phone && c.phone.length >= 10)) {
      cacheHits++;
      const filteredCached = cachedArray.filter(r => shouldIncludeResult(r, filters));
      filteredOut += cachedArray.length - filteredCached.length;
      if (filteredCached.length > 0) {
        for (const task of linkTasks) {
          results.push({ task, details: filteredCached });
        }
      }
    } else {
      tasksToFetch.push(linkTasks[0]);
    }
  }
  
  onProgress(`缓存命中: ${cacheHits}，待获取: ${tasksToFetch.length}`);
  
  const cacheToSave: Array<{ link: string; data: TpsDetailResult }> = [];
  let completed = 0;
  
  const runWithConcurrency = async () => {
    const queue = [...tasksToFetch];
    const processNext = async () => {
      if (queue.length === 0) return;
      const task = queue.shift()!;
      const link = task.searchResult.detailLink;
      const detailUrl = link.startsWith('http') ? link : `${baseUrl}${link}`;
      
      try {
        const html = await fetchWithScrapedo(detailUrl, token);
        detailPageRequests++;
        const details = parseDetailPage(html, task.searchResult);
        for (const detail of details) {
          if (detail.phone && detail.phone.length >= 10) {
            cacheToSave.push({ link, data: detail });
          }
        }
        const filtered = details.filter(r => shouldIncludeResult(r, filters));
        filteredOut += details.length - filtered.length;
        const linkTasks = tasksByLink.get(link) || [task];
        for (const t of linkTasks) {
          results.push({ task: t, details: filtered });
        }
      } catch (error: any) {
        onProgress(`获取详情失败: ${link} - ${error.message || error}`);
      } finally {
        completed++;
        if (completed % 10 === 0 || completed === tasksToFetch.length) {
          onProgress(`获取详情进度: ${completed}/${tasksToFetch.length}`);
        }
      }
    };

    const promises = Array(concurrency).fill(Promise.resolve()).map(async () => {
        while(tasksToFetch.length > 0) {
            await processNext();
        }
    });

    await Promise.all(promises);
  };

  if (tasksToFetch.length > 0) {
    // A more robust concurrency implementation
    const concurrencyPool = new Set<Promise<any>>();
    for (const task of tasksToFetch) {
        if (concurrencyPool.size >= concurrency) {
            await Promise.race(concurrencyPool);
        }

        const promise = (async () => {
            const link = task.searchResult.detailLink;
            const detailUrl = link.startsWith('http') ? link : `${baseUrl}${link}`;
            try {
                const html = await fetchWithScrapedo(detailUrl, token);
                detailPageRequests++;
                const details = parseDetailPage(html, task.searchResult);
                for (const detail of details) {
                    if (detail.phone && detail.phone.length >= 10) {
                        cacheToSave.push({ link, data: detail });
                    }
                }
                const filtered = details.filter(r => shouldIncludeResult(r, filters));
                filteredOut += details.length - filtered.length;
                const linkTasks = tasksByLink.get(link) || [task];
                for (const t of linkTasks) {
                    results.push({ task: t, details: filtered });
                }
            } catch (error: any) {
                onProgress(`获取详情失败: ${link} - ${error.message || error}`);
            } finally {
                completed++;
                if (completed % 10 === 0 || completed === tasksToFetch.length) {
                    onProgress(`获取详情进度: ${completed}/${tasksToFetch.length}`);
                }
                concurrencyPool.delete(promise);
            }
        })();
        concurrencyPool.add(promise);
    }
    await Promise.all(Array.from(concurrencyPool));
  }
  
  if (cacheToSave.length > 0) {
    onProgress(`保存缓存: ${cacheToSave.length} 条...`);
    await setCachedDetails(cacheToSave);
  }
  
  onProgress(`详情获取完成: ${results.length} 条结果，缓存命中 ${cacheHits}，新获取 ${detailPageRequests}`);
  
  return {
    results,
    stats: {
      detailPageRequests,
      cacheHits,
      filteredOut,
    },
  };
}
