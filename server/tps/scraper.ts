import * as cheerio from 'cheerio';

// ==================== Scrape.do API (v8.0 简化版) ====================
//
// v8.0 重构:
// - 移除 ElasticGlobalSemaphore 和 ActiveUserTracker
// - 移除 REQUEST_COOLDOWN_MS (请求冷却)
// - 并发控制权完全交给新的"分批+延迟"执行器 (smartPoolExecutor.ts)
// - fetchWithScrapedo 退化为纯HTTP客户端，仅保留重试逻辑

import { fetchWithScrapeClient, ScrapeRateLimitError, ScrapeServerError, ScrapeApiCreditsError } from './scrapeClient';

// 超时配置
const SCRAPE_TIMEOUT_MS = 20000;  // 20 秒超时
const SCRAPE_MAX_RETRIES = 1;    // 超时/网络错误最多重试 1 次

/**
 * 使用 Scrape.do API 获取页面 (v8.0 简化版)
 * 
 * 不再包含任何并发控制逻辑，并发由外部调用方管理。
 * 仅保留 HTTP 层面的错误重试:
 * - 502 错误: 指数退避重试 (2s → 4s → 6s)，最多 3 次
 * - 429 错误: 即时重试 2 次（间隔 1s），仍失败则抛出 ScrapeRateLimitError
 * - 超时/网络错误: 保持原有重试逻辑
 */
export async function fetchWithScrapedo(url: string, token: string): Promise<string> {
  return await fetchWithScrapeClient(url, token, {
    timeoutMs: SCRAPE_TIMEOUT_MS,
    maxRetries: SCRAPE_MAX_RETRIES,
    retryDelayMs: 0,
    enableLogging: true,
    // 502 容错: 指数退避 2s → 4s → 6s
    maxRetries502: 3,
    retryBaseDelay502Ms: 2000,
    // 429 即时重试: 2 次，间隔 1s
    maxRetries429: 2,
    retryDelay429Ms: 1000,
  });
}

// ==================== 配置常量 ====================

export const TPS_CONFIG = {
  TASK_CONCURRENCY: 4,      // 同时执行的搜索任务数
  SCRAPEDO_CONCURRENCY: 10, // 每个任务的 Scrape.do 并发数（保留用于搜索阶段参考）
  TOTAL_CONCURRENCY: 20,    // 总并发数（保留用于参考）
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
  isDeceased?: boolean;  // 是否已故
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
  company?: string;      // 公司
  jobTitle?: string;     // 职位
  email?: string;        // 邮箱地址（多个用逗号分隔）
  primaryEmail?: string;  // 主邮箱（第一个邮箱，通常是最相关的）
  spouse?: string;       // 配偶姓名（无配偶则为空）
  detailLink?: string;
  fromCache?: boolean;  // 标记是否来自缓存
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
 * 
 * 优化说明：
 * - 检测已故人员标记 (Deceased)
 * - 使用 DOM + 正则 组合方法提取年龄
 */
export function parseSearchPage(html: string): TpsSearchResult[] {
  const $ = cheerio.load(html);
  const results: TpsSearchResult[] = [];
  
  $('.card-summary').each((index, card) => {
    const $card = $(card);
    
    // 获取卡片文本用于检测已故
    const cardText = $card.text();
    
    // 检查是否已故 - 标记但不跳过，由后续过滤函数处理
    const isDeceased = cardText.includes('Deceased');
    
    // 提取姓名
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
    
    // 提取年龄 - 使用 DOM + 正则 组合方法
    let age: number | undefined = undefined;
    
    // 方法1: DOM 方法 - 查找 "Age " 后面的 content-value
    const contentValues = $card.find('.content-value');
    contentValues.each((j, el) => {
      const $el = $(el);
      const prevText = $el.prev().text().trim();
      if (prevText.includes('Age')) {
        const ageText = $el.text().trim();
        const parsed = parseInt(ageText, 10);
        if (!isNaN(parsed) && parsed > 0 && parsed < 150) {
          age = parsed;
          return false; // break
        }
      }
    });
    
    // 方法2: 正则方法 - 从卡片文本中提取
    if (age === undefined) {
      const ageMatch = cardText.match(/Age\s*(\d+)/);
      if (ageMatch) {
        const parsed = parseInt(ageMatch[1], 10);
        if (parsed > 0 && parsed < 150) {
          age = parsed;
        }
      }
    }
    
    // 提取地址
    let location = '';
    const addressElem = $card.find('.content-value').filter((_, el) => {
      const prev = $(el).prev().text().trim();
      return prev.includes('Lives in') || prev.includes('Address');
    }).first();
    if (addressElem.length) {
      location = addressElem.text().trim();
    }
    
    // 提取详情链接
    const detailLink = $card.attr('data-detail-link') || '';
    
    if (name && detailLink) {
      results.push({
        name,
        age,
        location,
        detailLink,
        isDeceased,
      });
    }
  });
  
  return results;
}

// 默认年龄范围（与前端 TpsSearch.tsx 保持一致）
const DEFAULT_MIN_AGE = 50;
const DEFAULT_MAX_AGE = 79;

/**
 * 搜索页精确过滤
 * 
 * 优化说明：
 * - 默认排除已故人员 (Deceased) - 固定启用
 * - 使用精确匹配，不留 ±5 岁缓冲，节省 API 积分
 * - 用户未设置年龄范围时，使用默认值 50-79 岁
 * - 没有年龄信息的结果会被保留（无法判断）
 * 
 * @returns 返回过滤后的结果和统计信息
 */
export interface PreFilterResult {
  filtered: TpsSearchResult[];
  stats: {
    skippedDeceased: number;  // 跳过的已故人员数量
    skippedAgeRange: number;  // 跳过的年龄不符合数量
  };
}

export function preFilterByAge(results: TpsSearchResult[], filters: TpsFilters): PreFilterResult {
  // 使用用户设置的年龄范围，如果未设置则使用默认值
  const minAge = filters.minAge ?? DEFAULT_MIN_AGE;
  const maxAge = filters.maxAge ?? DEFAULT_MAX_AGE;
  
  let skippedDeceased = 0;
  let skippedAgeRange = 0;
  
  const filtered = results.filter(r => {
    // 排除已故人员 - 固定启用
    if (r.isDeceased) {
      skippedDeceased++;
      return false;
    }
    
    // 没有年龄信息的保留（无法判断）
    if (r.age === undefined) return true;
    
    // 精确匹配年龄范围
    if (r.age < minAge || r.age > maxAge) {
      skippedAgeRange++;
      return false;
    }
    
    return true;
  });
  
  return {
    filtered,
    stats: {
      skippedDeceased,
      skippedAgeRange
    }
  };
}

// 保留旧版本的简单过滤函数，以保持向后兼容
export function preFilterByAgeSimple(results: TpsSearchResult[], filters: TpsFilters): TpsSearchResult[] {
  const { filtered } = preFilterByAge(results, filters);
  return filtered;
}

// ==================== 详情页解析 (保持不变) ====================

export function parseDetailPage(html: string, searchResult: TpsSearchResult): TpsDetailResult[] {
  const $ = cheerio.load(html);
  const results: TpsDetailResult[] = [];
  const name = searchResult.name;
  
  // 优先使用搜索结果中的年龄，如果没有则尝试从详情页解析
  let age = searchResult.age;
  if (age === undefined) {
    // 尝试从详情页标题解析年龄，格式通常是 "Name, Age XX"
    const title = $('title').text();
    const titleAgeMatch = title.match(/,\s*Age\s*(\d+)/i);
    if (titleAgeMatch) {
      age = parseInt(titleAgeMatch[1], 10);
    }
    
    // 如果标题中没有，尝试从页面内容解析
    if (age === undefined) {
      const pageText = $('body').text();
      // 匹配 "Age: XX" 或 "XX years old" 格式
      const agePatterns = [
        /\bAge[:\s]*(\d{1,3})\b/i,
        /\b(\d{1,3})\s*years?\s*old\b/i,
        /\bborn\s+(?:in\s+)?\d{4}.*?\((\d{1,3})\)/i,
      ];
      for (const pattern of agePatterns) {
        const match = pageText.match(pattern);
        if (match) {
          const parsedAge = parseInt(match[1], 10);
          // 合理年龄范围检查 (18-120)
          if (parsedAge >= 18 && parsedAge <= 120) {
            age = parsedAge;
            break;
          }
        }
      }
    }
  }
  
  // 提取城市和州
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
  // 房产信息 - 使用云端寻踪Pro的正确方法
  // TPS页面在地址链接的父容器的.dt-sb元素中显示房产价值
  let propertyValue: number | undefined;
  let yearBuilt: number | undefined;
  
  const addressLink = $('a[data-link-to-more="address"]').first();
  if (addressLink.length) {
    const addressContainer = addressLink.parent();
    // 查找所有.dt-sb元素，房产信息可能在其中任何一个
    addressContainer.find('.dt-sb').each((_, el) => {
      const text = $(el).text();
      
      // 匹配 $xxx,xxx 格式的价格
      if (!propertyValue) {
        const priceMatch = text.match(/\$([0-9,]+)/);
        if (priceMatch) {
          propertyValue = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        }
      }
      
      // 匹配 Built 年份
      if (!yearBuilt) {
        const builtMatch = text.match(/Built\s*(\d{4})/i);
        if (builtMatch) {
          yearBuilt = parseInt(builtMatch[1], 10);
        }
      }
    });
  }
  
  // 备用方法：如果上面没找到，尝试在整个页面搜索
  if (!propertyValue) {
    const pageText = $('body').text();
    // 尝试匹配独立的价格格式 (在地址附近)
    const priceMatches = pageText.match(/\$([0-9]{1,3}(?:,[0-9]{3})+)(?!\d)/g);
    if (priceMatches && priceMatches.length > 0) {
      // 取第一个合理的房产价格（通常在$50,000-$10,000,000之间）
      for (const match of priceMatches) {
        const value = parseInt(match.replace(/[$,]/g, ''), 10);
        if (value >= 50000 && value <= 10000000) {
          propertyValue = value;
          break;
        }
      }
    }
  }
  // 提取公司和职位信息 (Education and Employment 区块)
  // HTML结构: <div class="col-6 mb-2">Company<br /><b>公司名</b></div>
  let company: string | undefined;
  let jobTitle: string | undefined;
  
  // 查找包含 Company 和 Job Title 的 col-6 元素
  $('.col-6.mb-2').each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    const boldText = $el.find('b').text().trim();
    
    if (text.startsWith('Company') && boldText && !company) {
      company = boldText;
    }
    if (text.startsWith('Job Title') && boldText && !jobTitle) {
      jobTitle = boldText;
    }
  });
  
  // 提取邮箱地址 (Email Addresses 区块)
  // 邮箱以纯文本形式显示在 div 中，使用正则表达式提取
  // TruePeopleSearch 按相关性排序邮箱，第一个邮箱通常是最相关/最新的
  let email: string | undefined;
  let primaryEmail: string | undefined;
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const allEmails = html.match(emailRegex) || [];
  // 过滤掉网站相关邮箱
  const personalEmails = allEmails.filter(e => 
    !e.toLowerCase().includes('truepeoplesearch') && 
    !e.toLowerCase().includes('example') &&
    !e.toLowerCase().includes('scrape')
  );
  if (personalEmails.length > 0) {
    // 去重并保持原始顺序（第一个是最相关的）
    const uniqueEmails = Array.from(new Set(personalEmails));
    // 主邮箱是第一个邮箱
    primaryEmail = uniqueEmails[0];
    // 所有邮箱用逗号分隔
    email = uniqueEmails.join(', ');
  }
  
  // 提取配偶信息 (Possible Relatives 区块)
  // HTML结构: <span class="dt-sb"><b>Possible Spouse</b></span>
  let spouse: string | undefined;
  
  // 方法1: 查找包含 "Possible Spouse" 的元素
  $('a[data-link-to-more="relative"]').each((_, el) => {
    const $el = $(el);
    const parentContainer = $el.parent();
    const containerText = parentContainer.text();
    
    // 检查是否标记为 Possible Spouse
    if (containerText.includes('Possible Spouse') && !spouse) {
      spouse = $el.find('span').text().trim() || $el.text().trim();
    }
  });
  
  // 方法2: 备用方法 - 直接搜索 "Possible Spouse" 文本
  if (!spouse) {
    const spouseMatch = html.match(/data-link-to-more="relative"[^>]*>[\s\S]*?<span>([^<]+)<\/span>[\s\S]*?<b>Possible Spouse<\/b>/);
    if (spouseMatch) {
      spouse = spouseMatch[1].trim();
    }
  }
  
  // 优化：提取所有电话号码，然后按 reportYear 排序取最新的
  // 这样确保即使 TPS 更新数据，也能自动获取最新年份的号码
  const allPhones: TpsDetailResult[] = [];
  
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
    } else if (containerText.toLowerCase().includes('voip')) {
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
    allPhones.push({
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
      company,
      jobTitle,
      email,
      primaryEmail,
      spouse,
      detailLink: searchResult.detailLink,
    });
  });
  
  // 按 reportYear 降序排序，取最新年份的号码
  // 如果没有 reportYear，则优先取标记为 Primary 的号码
  if (allPhones.length > 0) {
    allPhones.sort((a, b) => {
      // 优先按 reportYear 降序排序（最新的在前）
      const yearA = a.reportYear || 0;
      const yearB = b.reportYear || 0;
      if (yearB !== yearA) return yearB - yearA;
      // 如果年份相同，优先取 Primary 号码
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      return 0;
    });
    // 只取最新的一个号码
    results.push(allPhones[0]);
  }
  // 备用方法：如果主方法未找到电话，使用正则匹配（也只取第一个）
  if (results.length === 0) {
    const phonePattern = /\((\d{3})\)\s*(\d{3})-(\d{4})/g;
    const match = phonePattern.exec(html); // 只取第一个匹配
    if (match) {
      const phone = match[1] + match[2] + match[3];
      let phoneType = '';
      if (html.includes('Wireless')) phoneType = 'Wireless';
      else if (html.includes('Landline')) phoneType = 'Landline';
      else if (html.toLowerCase().includes('voip')) phoneType = 'VoIP';
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
        company,
        jobTitle,
        email,
        spouse,
        detailLink: searchResult.detailLink,
      });
    }
  }
  if (results.length === 0) {
    results.push({
      name,
      age,
      city,
      state,
      location: city && state ? `${city}, ${state}` : (city || state || ''),
      company,
      jobTitle,
      email,
      primaryEmail,
      spouse,
      detailLink: searchResult.detailLink,
    });
  }
  return results;
}

// ==================== 过滤逻辑 ====================

/**
 * 详情页结果精确过滤
 * 
 * 优化说明：
 * - 用户未设置年龄范围时，使用默认值 30-70 岁
 * - 与搜索页过滤逻辑保持一致
 */
export function shouldIncludeResult(result: TpsDetailResult, filters: TpsFilters): boolean {
  // 已故人员检查 - 与云端寻踪Pro保持一致
  if ((result as any).isDeceased) {
    return false;
  }
  
  // 数据完整性验证：必须有电话号码
  if (!result.phone || result.phone.length < 10) {
    return false;
  }
  
  // 数据完整性验证：必须有年龄
  if (result.age === undefined || result.age === null) {
    return false;
  }
  
  // 使用用户设置的年龄范围，如果未设置则使用默认值
  const minAge = filters.minAge ?? DEFAULT_MIN_AGE;
  const maxAge = filters.maxAge ?? DEFAULT_MAX_AGE;
  
  // 年龄范围验证
  if (result.age < minAge) return false;
  if (result.age > maxAge) return false;
  
  // 注：已移除minYear过滤，因为现在按 reportYear 排序取最新年份的号码
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
    skippedDeceased?: number;  // 跳过的已故人员数量
  };
  error?: string;
  /** Scrape.do API 积分耗尽标志 */
  apiCreditsExhausted?: boolean;
}

/**
 * [OPTIMIZED] 仅执行搜索，并发获取所有页面
 * 
 * v8.0: 移除 userId 参数（不再需要全局信号量）
 * 搜索阶段的并发由 router.ts 中的 SEARCH_CONCURRENCY 控制
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
    onProgress?.(`找到 ${totalRecords} 条记录, 共 ${totalPages} 页`);

    // 阶段二: 并发获取剩余搜索页
    const firstFilterResult = preFilterByAge(firstResults, filters);
    const allResults = [...firstFilterResult.filtered];
    filteredOut += firstResults.length - firstFilterResult.filtered.length;
    let totalSkippedDeceased = firstFilterResult.stats.skippedDeceased;

    if (totalPages > 1 && hasNextPage) {
      const remainingUrls: string[] = [];
      for (let page = 2; page <= totalPages; page++) {
        remainingUrls.push(buildSearchUrl(name, location, page));
      }
      
      onProgress?.(`并发获取剩余 ${remainingUrls.length} 页...`);
      
      // 并发获取所有剩余页，收集需要延后重试的页面
      const retryUrls: string[] = [];  // 429/502 延后重试队列
      
      let searchApiCreditsExhausted = false;
      
      const pagePromises = remainingUrls.map(url => 
        fetchWithScrapedo(url, token).catch(err => {
          // 检测 API 积分耗尽错误
          if (err instanceof ScrapeApiCreditsError) {
            searchApiCreditsExhausted = true;
            // 只输出一次提示，不刷屏
            return null;
          }
          // 检测 429/502 错误，加入延后重试队列
          if (err instanceof ScrapeRateLimitError || err instanceof ScrapeServerError) {
            retryUrls.push(url);
            onProgress?.(`⚓ 页面获取失败 (${err instanceof ScrapeRateLimitError ? '429限流' : '502服务器错误'})，已排入队尾稍后重试...`);
          } else {
            const safeErrMsg = (err.message || '').includes('Scrape.do') ? '服务繁忙' : err.message;
            onProgress?.(`页面获取失败: ${safeErrMsg}`);
          }
          return null; // 错误时返回 null
        })
      );
      
      const pageHtmls = await Promise.all(pagePromises);
      searchPageRequests += remainingUrls.length;
      
      for (const html of pageHtmls) {
        if (html) {
          const pageResults = parseSearchPage(html);
          const filterResult = preFilterByAge(pageResults, filters);
          filteredOut += pageResults.length - filterResult.filtered.length;
          totalSkippedDeceased += filterResult.stats.skippedDeceased;
          allResults.push(...filterResult.filtered);
        }
      }
      
      // 检查 API 积分耗尽
      if (searchApiCreditsExhausted) {
        onProgress?.(`🚫 当前使用人数过多，服务繁忙，请联系客服处理`);
        onProgress?.(`💡 已获取的结果已保存，如需继续请联系客服`);
        
        // 返回已获取的结果，并标记 API 积分耗尽
        const uniqueResults = deduplicateByDetailLink(allResults);
        return {
          success: true,
          searchResults: uniqueResults,
          stats: { searchPageRequests, filteredOut, skippedDeceased: totalSkippedDeceased },
          apiCreditsExhausted: true,
        };
      }
      
      // ==================== 搜索阶段延后重试 ====================
      // 借鉴 EXE 版 2+2 延后重试机制：主批次完成后统一重试失败的页面
      if (retryUrls.length > 0) {
        onProgress?.(`🔄 开始延后重试 ${retryUrls.length} 个失败页面...`);
        
        // 等待 2 秒后开始重试，给服务器恢复时间
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const retryPromises = retryUrls.map(url =>
          fetchWithScrapedo(url, token).catch(err => {
            onProgress?.(`❌ 延后重试仍失败: ${err.message}`);
            return null;
          })
        );
        
        const retryHtmls = await Promise.all(retryPromises);
        searchPageRequests += retryUrls.length;
        
        let retrySuccess = 0;
        for (const html of retryHtmls) {
          if (html) {
            retrySuccess++;
            const pageResults = parseSearchPage(html);
            const filterResult = preFilterByAge(pageResults, filters);
            filteredOut += pageResults.length - filterResult.filtered.length;
            totalSkippedDeceased += filterResult.stats.skippedDeceased;
            allResults.push(...filterResult.filtered);
          }
        }
        
        onProgress?.(`🔄 延后重试完成: ${retrySuccess}/${retryUrls.length} 成功`);
      }
    }

    // 阶段三: 去重
    const uniqueResults = deduplicateByDetailLink(allResults);
    // 搜索完成日志已在 router.ts 中输出，这里不再重复

    return {
      success: true,
      searchResults: uniqueResults,
      stats: { searchPageRequests, filteredOut, skippedDeceased: totalSkippedDeceased },
    };

  } catch (error: any) {
    // 检查是否是 API 积分耗尽错误（第一页就失败的情况）
    if (error instanceof ScrapeApiCreditsError) {
      onProgress?.(`🚫 当前使用人数过多，服务繁忙，请联系客服处理`);
      onProgress?.(`💡 已获取的结果已保存，如需继续请联系客服`);
      return {
        success: false,
        searchResults: [],
        stats: { searchPageRequests, filteredOut },
        error: '服务繁忙，请稍后重试',
        apiCreditsExhausted: true,
      };
    }
    
    onProgress?.(`搜索任务失败: ${error.message}`);
    return {
      success: false,
      searchResults: [],
      stats: { searchPageRequests, filteredOut },
      error: error.message || String(error),
    };
  }
}

// ==================== 详情获取类型定义 ====================

export interface DetailTaskWithIndex {
  searchResult: TpsSearchResult;
  subTaskIndex: number;
  name: string;
  location: string;
}
