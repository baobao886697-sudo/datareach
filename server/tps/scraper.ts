import * as cheerio from 'cheerio';

// ==================== Scrape.do API ====================

/**
 * 使用 Scrape.do API 获取页面
 */
async function fetchWithScrapedo(url: string, token: string): Promise<string> {
  const encodedUrl = encodeURIComponent(url);
  const apiUrl = `https://api.scrape.do/?token=${token}&url=${encodedUrl}&super=true&geoCode=us&timeout=30000`;
  
  const response = await fetch(apiUrl, {
    method: 'GET',
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Scrape.do API 请求失败: ${response.status} ${response.statusText}`);
  }
  
  return await response.text();
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

// ==================== 搜索页解析 ====================

/**
 * 解析搜索结果页面，提取人员列表
 * 
 * 选择器说明：
 * - .card-summary: 每个搜索结果卡片
 * - .h4, .content-header: 姓名（两种可能的选择器）
 * - .content-value: 年龄
 * - a[href*="/find/person/"]: 详情页链接
 */
export function parseSearchPage(html: string): TpsSearchResult[] {
  const $ = cheerio.load(html);
  const results: TpsSearchResult[] = [];
  
  // 调试日志
  const cardCount = $('.card-summary').length;
  console.log(`[parseSearchPage] 找到 ${cardCount} 个 card-summary`);
  
  $('.card-summary').each((index, card) => {
    const $card = $(card);
    
    // 提取姓名 - 尝试多种选择器
    let name = '';
    const h4Elem = $card.find('.h4').first();
    if (h4Elem.length && h4Elem.text().trim()) {
      name = h4Elem.text().trim();
    } else {
      // 备用选择器：.content-header
      const headerElem = $card.find('.content-header').first();
      if (headerElem.length) {
        name = headerElem.text().trim();
      }
    }
    
    // 提取年龄
    const ageText = $card.find('.content-value').first().text().trim();
    const ageMatch = ageText.match(/(\d+)/);
    const age = ageMatch ? parseInt(ageMatch[1], 10) : undefined;
    
    // 提取位置
    const location = $card.find('.content-value').eq(1).text().trim() || '';
    
    // 提取详情链接
    const detailLink = $card.find('a[href*="/find/person/"]').first().attr('href') || '';
    
    // 调试日志（只打印前3个）
    if (index < 3) {
      console.log(`[parseSearchPage] [${index + 1}] 姓名: ${name}, 年龄: ${age}, 位置: ${location?.substring(0, 30)}, 链接: ${detailLink}`);
    }
    
    if (detailLink) {
      results.push({ name, age, location, detailLink });
    }
  });
  
  console.log(`[parseSearchPage] 解析出 ${results.length} 条结果`);
  return results;
}

/**
 * 搜索页年龄初筛
 * 
 * 注意：搜索页的年龄可能不准确，这里只做宽松过滤
 * 详细过滤在详情页解析后进行
 * 
 * 过滤逻辑：
 * - 如果设置了最小年龄，搜索页年龄小于 (minAge - 5) 的过滤掉
 * - 如果设置了最大年龄，搜索页年龄大于 (maxAge + 5) 的过滤掉
 * - 没有年龄信息的保留（在详情页再确认）
 */
export function preFilterByAge(results: TpsSearchResult[], filters: TpsFilters): TpsSearchResult[] {
  if (!filters.minAge && !filters.maxAge) {
    return results;
  }
  
  const beforeCount = results.length;
  const filtered = results.filter(r => {
    // 没有年龄信息的保留
    if (r.age === undefined) return true;
    
    // 宽松过滤（允许 ±5 岁误差）
    if (filters.minAge !== undefined && r.age < filters.minAge - 5) return false;
    if (filters.maxAge !== undefined && r.age > filters.maxAge + 5) return false;
    
    return true;
  });
  
  const afterCount = filtered.length;
  console.log(`[preFilterByAge] 初筛前: ${beforeCount}, 初筛后: ${afterCount}, 过滤: ${beforeCount - afterCount}`);
  
  return filtered;
}

// ==================== 详情页解析（核心修复） ====================

/**
 * 解析详情页，提取完整的人员信息
 * 
 * 【重要】TPS 详情页 HTML 结构说明：
 * 
 * 1. 电话号码容器：
 *    <div class="col-12 col-md-6 mb-3">
 *      <a class="dt-hd link-to-more olnk" data-link-to-more="phone" href="/find/phone/9044159425">
 *        <span>(904) 415-9425</span>
 *      </a>
 *      -Wireless
 *      <div class="mt-1 dt-ln">
 *        <span class="dt-sb"><b>Possible Primary Phone</b></span><br/>
 *        <span class="dt-sb">Last reported Dec 2025</span><br/>
 *        <span class="dt-sb">Powertel Jacksonville Licenses</span>
 *      </div>
 *    </div>
 * 
 * 2. 地址容器：
 *    <div class="col-12 col-md-6 mb-3">
 *      <a data-link-to-more="address" href="/find/address/...">
 *        <span>123 Main St</span>
 *      </a>
 *      <div class="mt-1 dt-ln">
 *        <span class="dt-sb">Philadelphia, PA 19138</span>
 *      </div>
 *    </div>
 */
export function parseDetailPage(html: string, searchResult: TpsSearchResult): TpsDetailResult[] {
  const $ = cheerio.load(html);
  const results: TpsDetailResult[] = [];
  
  // 获取基本信息
  const name = searchResult.name;
  const age = searchResult.age;
  
  // ==================== 解析位置 ====================
  let city = '';
  let state = '';
  
  // 方法1：从页面标题解析（格式：John Smith, Age 58 in Matthews, NC）
  const title = $('title').text();
  const titleMatch = title.match(/in\s+([^,]+),\s*([A-Z]{2})/);
  if (titleMatch) {
    city = titleMatch[1].trim();
    state = titleMatch[2].trim();
  }
  
  // 方法2：从当前地址区域解析
  if (!city || !state) {
    const currentAddressSection = $('[data-link-to-more="address"]').first().parent();
    const addressText = currentAddressSection.find('.dt-ln, .dt-sb').text();
    const addressMatch = addressText.match(/([A-Za-z\s]+),\s*([A-Z]{2})\s+(\d{5})/);
    if (addressMatch) {
      city = city || addressMatch[1].trim();
      state = state || addressMatch[2].trim();
    }
  }
  
  // ==================== 获取房产信息 ====================
  let propertyValue: number | undefined;
  let yearBuilt: number | undefined;
  
  // 从页面文本中提取房产价值
  const pageText = $('body').text();
  const propertyMatch = pageText.match(/(?:property|home)\s*value[:\s]*\$?([\d,]+)/i);
  if (propertyMatch) {
    propertyValue = parseInt(propertyMatch[1].replace(/,/g, ''), 10);
  }
  
  const yearBuiltMatch = pageText.match(/(?:year\s*built|built\s*in)[:\s]*(\d{4})/i);
  if (yearBuiltMatch) {
    yearBuilt = parseInt(yearBuiltMatch[1], 10);
  }
  
  // ==================== 解析电话号码（核心修复） ====================
  // 查找所有包含电话的 col-12 col-md-6 mb-3 容器
  $('.col-12.col-md-6.mb-3').each((_, container) => {
    const $container = $(container);
    
    // 检查是否包含电话链接
    const phoneLink = $container.find('a[data-link-to-more="phone"]');
    if (!phoneLink.length) return;
    
    // 提取电话号码（从 href 或文本）
    let phone = '';
    const href = phoneLink.attr('href') || '';
    const hrefMatch = href.match(/\/find\/phone\/(\d+)/);
    if (hrefMatch) {
      phone = hrefMatch[1];
    } else {
      // 从文本中提取
      const phoneText = phoneLink.text().replace(/\D/g, '');
      if (phoneText.length >= 10) {
        phone = phoneText;
      }
    }
    
    if (!phone || phone.length < 10) return;
    
    // 提取电话类型（Wireless/Landline/VoIP）
    let phoneType = '';
    const containerText = $container.text();
    
    if (containerText.includes('Wireless') || containerText.includes('wireless')) {
      phoneType = 'Wireless';
    } else if (containerText.includes('Landline') || containerText.includes('landline')) {
      phoneType = 'Landline';
    } else if (containerText.includes('VoIP') || containerText.includes('voip')) {
      phoneType = 'VoIP';
    }
    
    // 提取运营商（在 dt-ln 或 dt-sb 中）
    let carrier = '';
    const dtLn = $container.find('.dt-ln, .dt-sb');
    dtLn.each((_, el) => {
      const text = $(el).text().trim();
      // 运营商通常是最后一行，不包含 "reported" 或 "Primary"
      if (text && !text.includes('reported') && !text.includes('Primary') && !text.includes('Phone')) {
        // 检查是否像运营商名称（包含字母，可能有空格）
        if (/^[A-Za-z\s]+$/.test(text) && text.length > 3) {
          carrier = text;
        }
      }
    });
    
    // 提取报告年份
    let reportYear: number | undefined;
    const reportMatch = containerText.match(/(?:reported|last\s+seen)[:\s]*(?:[A-Za-z]+\s+)?(\d{4})/i);
    if (reportMatch) {
      reportYear = parseInt(reportMatch[1], 10);
    }
    
    // 判断是否为主号
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
  
  // ==================== 备用方法：正则提取 ====================
  // 如果 DOM 方法没有找到电话，使用正则从整个页面提取
  if (results.length === 0) {
    const phonePattern = /\((\d{3})\)\s*(\d{3})-(\d{4})/g;
    const phones = new Set<string>();
    let match;
    
    while ((match = phonePattern.exec(html)) !== null) {
      const phone = match[1] + match[2] + match[3];
      phones.add(phone);
    }
    
    // 提取电话类型
    let phoneType = '';
    if (html.includes('Wireless')) phoneType = 'Wireless';
    else if (html.includes('Landline')) phoneType = 'Landline';
    else if (html.includes('VoIP')) phoneType = 'VoIP';
    
    // 为每个电话创建结果
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
  
  // 如果仍然没有找到电话，返回基本信息
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
  
  console.log(`[parseDetailPage] 解析出 ${results.length} 条电话记录`);
  return results;
}

// ==================== 过滤逻辑 ====================

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
    const carrierLower = result.carrier.toLowerCase();
    if (carrierLower.includes('t-mobile') || carrierLower.includes('tmobile')) {
      return false;
    }
  }
  
  // Comcast/Spectrum 过滤
  if (filters.excludeComcast && result.carrier) {
    const carrierLower = result.carrier.toLowerCase();
    if (carrierLower.includes('comcast') || carrierLower.includes('spectrum') || carrierLower.includes('xfinity')) {
      return false;
    }
  }
  
  // 固话过滤
  if (filters.excludeLandline && result.phoneType) {
    if (result.phoneType.toLowerCase() === 'landline') {
      return false;
    }
  }
  
  return true;
}

// ==================== 分离的搜索和详情函数（统一队列模式） ====================

/**
 * searchOnly 返回结果类型
 */
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
 * 仅执行搜索，返回详情任务列表
 * 用于统一队列模式的第一阶段
 * 
 * @param name - 搜索姓名
 * @param location - 搜索地点
 * @param token - Scrape.do API Token
 * @param maxPages - 最大搜索页数
 * @param filters - 过滤条件
 * @param onProgress - 进度回调
 */
export async function searchOnly(
  name: string,
  location: string,
  token: string,
  maxPages: number,
  filters: TpsFilters,
  onProgress?: (message: string) => void
): Promise<SearchOnlyResult> {
  const baseUrl = 'https://www.truepeoplesearch.com/results';
  const allResults: TpsSearchResult[] = [];
  let searchPageRequests = 0;
  let totalFound = 0;
  let filteredOut = 0;
  
  try {
    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams();
      params.set('name', name);
      if (location) params.set('citystatezip', location);
      if (page > 1) params.set('page', page.toString());
      
      const url = `${baseUrl}?${params.toString()}`;
      onProgress?.(`搜索 ${name} @ ${location || '全国'} 第 ${page}/${maxPages} 页...`);
      
      try {
        const html = await fetchWithScrapedo(url, token);
        searchPageRequests++;
        
        const results = parseSearchPage(html);
        totalFound += results.length;
        
        if (results.length === 0) {
          onProgress?.(`第 ${page} 页无结果，停止搜索`);
          break;
        }
        
        // 年龄初筛
        const filtered = preFilterByAge(results, filters);
        filteredOut += results.length - filtered.length;
        allResults.push(...filtered);
        
        onProgress?.(`第 ${page} 页: 找到 ${results.length} 条，初筛后 ${filtered.length} 条`);
      } catch (error: any) {
        onProgress?.(`第 ${page} 页搜索失败: ${error.message || error}`);
        // 继续下一页
      }
    }
    
    // 去重
    const seenLinks = new Set<string>();
    const uniqueResults: TpsSearchResult[] = [];
    
    for (const result of allResults) {
      if (result.detailLink && !seenLinks.has(result.detailLink)) {
        seenLinks.add(result.detailLink);
        uniqueResults.push(result);
      }
    }
    
    onProgress?.(`搜索完成: ${allResults.length} 条结果，${uniqueResults.length} 个唯一详情链接`);
    
    return {
      success: true,
      searchResults: uniqueResults,
      stats: {
        searchPageRequests,
        filteredOut,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      searchResults: [],
      stats: {
        searchPageRequests,
        filteredOut,
      },
      error: error.message || String(error),
    };
  }
}

/**
 * 扩展的详情任务类型（包含子任务索引）
 */
export interface DetailTaskWithIndex {
  searchResult: TpsSearchResult;
  subTaskIndex: number;
  name: string;
  location: string;
}

/**
 * fetchDetailsInBatch 返回结果类型
 */
export interface FetchDetailsResult {
  results: Array<{ task: DetailTaskWithIndex; details: TpsDetailResult[] }>;
  stats: {
    detailPageRequests: number;
    cacheHits: number;
    filteredOut: number;
  };
}

/**
 * 批量获取详情
 * 用于统一队列模式的第二阶段
 * 
 * @param tasks - 详情任务列表
 * @param token - Scrape.do API Token
 * @param concurrency - 并发数
 * @param filters - 过滤条件
 * @param onProgress - 进度回调
 * @param getCachedDetails - 批量获取缓存函数
 * @param setCachedDetails - 批量保存缓存函数
 */
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
  
  // 去重详情链接
  const uniqueLinks = [...new Set(tasks.map(t => t.searchResult.detailLink))];
  
  // 批量获取缓存
  onProgress(`检查缓存: ${uniqueLinks.length} 个链接...`);
  const cachedMap = await getCachedDetails(uniqueLinks);
  
  // 分离缓存命中和未命中的任务
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
    
    // 验证缓存数据完整性（至少有一条有效电话记录）
    if (cachedArray && cachedArray.length > 0 && cachedArray.some(c => c.phone && c.phone.length >= 10)) {
      cacheHits++;
      // 应用过滤（对每条电话记录单独过滤）
      const filteredCached = cachedArray.filter(r => shouldIncludeResult(r, filters));
      filteredOut += cachedArray.length - filteredCached.length;
      
      if (filteredCached.length > 0) {
        for (const task of linkTasks) {
          results.push({ task, details: filteredCached });
        }
      }
    } else {
      // 需要获取
      tasksToFetch.push(linkTasks[0]);
    }
  }
  
  onProgress(`缓存命中: ${cacheHits}，待获取: ${tasksToFetch.length}`);
  
  // 并发获取未缓存的详情
  const cacheToSave: Array<{ link: string; data: TpsDetailResult }> = [];
  let completed = 0;
  
  // 并发控制
  const runWithConcurrency = async () => {
    let index = 0;
    const running: Promise<void>[] = [];
    
    const processTask = async (task: DetailTaskWithIndex) => {
      const link = task.searchResult.detailLink;
      const detailUrl = link.startsWith('http') ? link : `${baseUrl}${link}`;
      
      try {
        const html = await fetchWithScrapedo(detailUrl, token);
        detailPageRequests++;
        
        // 解析详情
        const details = parseDetailPage(html, task.searchResult);
        
        // 保存到缓存队列
        for (const detail of details) {
          if (detail.phone && detail.phone.length >= 10) {
            cacheToSave.push({ link, data: detail });
          }
        }
        
        // 应用过滤并添加结果
        const filtered = details.filter(r => shouldIncludeResult(r, filters));
        filteredOut += details.length - filtered.length;
        
        // 为所有共享该链接的任务添加结果
        const linkTasks = tasksByLink.get(link) || [task];
        for (const t of linkTasks) {
          results.push({ task: t, details: filtered });
        }
        
        completed++;
        if (completed % 10 === 0 || completed === tasksToFetch.length) {
          onProgress(`获取详情进度: ${completed}/${tasksToFetch.length}`);
        }
      } catch (error: any) {
        onProgress(`获取详情失败: ${link} - ${error.message || error}`);
        completed++;
      }
    };
    
    const startNext = () => {
      if (index < tasksToFetch.length) {
        const task = tasksToFetch[index++];
        const promise = processTask(task).then(() => {
          startNext();
        });
        running.push(promise);
      }
    };
    
    // 启动初始并发
    const initialBatch = Math.min(concurrency, tasksToFetch.length);
    for (let i = 0; i < initialBatch; i++) {
      startNext();
    }
    
    await Promise.all(running);
  };
  
  if (tasksToFetch.length > 0) {
    await runWithConcurrency();
  }
  
  // 批量保存缓存
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

// ==================== 完整搜索函数（保留向后兼容） ====================

/**
 * 执行完整搜索（搜索 + 详情获取）
 * 保留此函数以保持向后兼容
 */
export async function fullSearch(
  name: string,
  location: string,
  maxPages: number,
  filters: TpsFilters,
  fetchPage: (url: string) => Promise<string>,
  getCachedDetail: (detailLink: string) => Promise<TpsDetailResult[] | null>,
  saveCachedDetail: (detailLink: string, results: TpsDetailResult[]) => Promise<void>,
  onProgress?: (message: string) => void
): Promise<{ results: TpsDetailResult[]; pagesSearched: number; detailPagesFetched: number; cacheHits: number }> {
  // 第一阶段：搜索
  const { searchResults, pagesSearched, detailTasks } = await searchOnly(
    name, location, maxPages, filters, fetchPage, onProgress
  );
  
  // 第二阶段：获取详情
  const { results, detailPagesFetched, cacheHits } = await fetchDetailsInBatch(
    detailTasks, filters, fetchPage, getCachedDetail, saveCachedDetail, onProgress
  );
  
  return { results, pagesSearched, detailPagesFetched, cacheHits };
}
