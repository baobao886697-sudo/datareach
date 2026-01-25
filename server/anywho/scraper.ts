/**
 * Anywho 爬虫模块
 * 独立模块，方便后期管理和修改
 * 
 * 使用 Scrape.do API 进行网页抓取
 * 支持搜索结果获取和详情页解析（包含婚姻状况）
 */

import * as cheerio from 'cheerio';

// Anywho 配置
export const ANYWHO_CONFIG = {
  BASE_URL: "https://www.anywho.com",
  SCRAPE_API: "https://api.scrape.do/",
  TOTAL_CONCURRENCY: 10,  // 总并发数
  TASK_CONCURRENCY: 4,    // 搜索任务并发数
  MAX_PAGES: 5,           // 最大搜索页数
  BATCH_DELAY: 500,       // 批次间延迟(ms)
  REQUEST_TIMEOUT: 120000, // 请求超时(ms)
};

// 过滤条件类型 - 新的过滤条件
export interface AnywhoFilters {
  minAge?: number;           // 年龄范围 0-100，默认 50
  maxAge?: number;           // 年龄范围 0-100，默认 79
  minYear?: number;          // 号码年份 2020-2030，默认 2025
  excludeDeceased?: boolean; // 排除已故人员，默认 true
  excludeMarried?: boolean;  // 排除已婚
  excludeTMobile?: boolean;  // 排除 T-Mobile 号码
  excludeComcast?: boolean;  // 排除 Comcast 号码
  excludeLandline?: boolean; // 排除 Landline 号码
}

// 搜索结果类型
export interface AnywhoSearchResult {
  name: string;
  firstName: string;
  lastName: string;
  age: number | null;
  city: string;
  state: string;
  location: string;
  detailLink: string;
  aka?: string;
  currentAddress?: string;
  previousAddresses?: string[];
  phones?: string[];
  emails?: string[];
  relatives?: string[];
}

// 详情结果类型（包含婚姻状况）
export interface AnywhoDetailResult {
  name: string;
  firstName: string;
  lastName: string;
  age: number | null;
  city: string;
  state: string;
  location: string;
  phone: string;
  phoneType: string;
  carrier: string;
  allPhones?: string[];
  reportYear: number | null;
  isPrimary: boolean;
  propertyValue: number;
  yearBuilt: number | null;
  marriageStatus: string | null;  // Anywho 特色：婚姻状况
  marriageRecords?: string[];     // 婚姻记录列表
  familyMembers: string[];        // 家庭成员
  employment: string[];           // 就业历史
  isDeceased: boolean;
  currentAddress?: string;
  previousAddresses?: string[];
  emails?: string[];
  socialProfiles?: string[];
  zodiacSign?: string;
}

// 详情任务类型
export interface DetailTask {
  detailLink: string;
  searchName: string;
  searchLocation?: string;
  subTaskIndex: number;
}

// 州名映射
const STATE_MAP: Record<string, string> = {
  'AL': 'alabama', 'AK': 'alaska', 'AZ': 'arizona', 'AR': 'arkansas',
  'CA': 'california', 'CO': 'colorado', 'CT': 'connecticut', 'DE': 'delaware',
  'FL': 'florida', 'GA': 'georgia', 'HI': 'hawaii', 'ID': 'idaho',
  'IL': 'illinois', 'IN': 'indiana', 'IA': 'iowa', 'KS': 'kansas',
  'KY': 'kentucky', 'LA': 'louisiana', 'ME': 'maine', 'MD': 'maryland',
  'MA': 'massachusetts', 'MI': 'michigan', 'MN': 'minnesota', 'MS': 'mississippi',
  'MO': 'missouri', 'MT': 'montana', 'NE': 'nebraska', 'NV': 'nevada',
  'NH': 'new hampshire', 'NJ': 'new jersey', 'NM': 'new mexico', 'NY': 'new york',
  'NC': 'north carolina', 'ND': 'north dakota', 'OH': 'ohio', 'OK': 'oklahoma',
  'OR': 'oregon', 'PA': 'pennsylvania', 'RI': 'rhode island', 'SC': 'south carolina',
  'SD': 'south dakota', 'TN': 'tennessee', 'TX': 'texas', 'UT': 'utah',
  'VT': 'vermont', 'VA': 'virginia', 'WA': 'washington', 'WV': 'west virginia',
  'WI': 'wisconsin', 'WY': 'wyoming', 'DC': 'district of columbia',
};

// 州名反向映射（全名到缩写）
const STATE_ABBR_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_MAP).map(([abbr, name]) => [name, abbr])
);

/**
 * 使用 Scrape.do API 抓取网页
 * 
 * 重要参数说明（来自 Scrape.do 文档）：
 * - render: 启用无头浏览器渲染 JavaScript（Anywho 是 Next.js 应用，必须启用）
 * - super: 使用住宅/移动代理网络，提高成功率
 * - waitUntil: 控制页面加载完成时机
 * - customWait: 页面加载后额外等待时间
 * - waitSelector: 等待特定 CSS 选择器出现
 */
async function scrapeUrl(
  url: string,
  token: string,
  options: {
    render?: boolean;
    useSuper?: boolean;
    customWait?: number;
    waitSelector?: string;
    geoCode?: string;
  } = {}
): Promise<string | null> {
  const { 
    render = true,           // 默认启用 JavaScript 渲染（Anywho 是 Next.js 应用）
    useSuper = true,         // 默认使用住宅代理
    customWait = 3000,       // 默认等待 3 秒
    waitSelector,            // 可选：等待特定元素
    geoCode = 'us' 
  } = options;
  
  const params = new URLSearchParams({
    token,
    url,
    geoCode,
  });
  
  // 使用住宅代理（提高成功率）
  if (useSuper) {
    params.append('super', 'true');
  }
  
  // 启用 JavaScript 渲染（Anywho 是 Next.js 应用，必须启用）
  if (render) {
    params.append('render', 'true');
    params.append('waitUntil', 'networkidle2');
    params.append('customWait', customWait.toString());
    
    // 等待特定元素加载（确保数据完全加载）
    if (waitSelector) {
      params.append('waitSelector', waitSelector);
    }
  }
  
  const apiUrl = `${ANYWHO_CONFIG.SCRAPE_API}?${params.toString()}`;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ANYWHO_CONFIG.REQUEST_TIMEOUT);
    
    const response = await fetch(apiUrl, {
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.error(`[Anywho] 抓取失败: ${response.status} ${response.statusText}`);
      return null;
    }
    
    return await response.text();
  } catch (error) {
    console.error(`[Anywho] 抓取错误:`, error);
    return null;
  }
}

/**
 * 解析州名
 */
function parseStateName(location: string): string | null {
  const parts = location.split(/[,\s]+/);
  for (const part of parts) {
    const upper = part.toUpperCase().trim();
    if (STATE_MAP[upper]) {
      return STATE_MAP[upper];
    }
  }
  
  const lowerLocation = location.toLowerCase();
  for (const [abbr, fullName] of Object.entries(STATE_MAP)) {
    if (lowerLocation.includes(fullName)) {
      return fullName;
    }
  }
  
  return null;
}

/**
 * 解析城市名
 */
function parseCityName(location: string): string | null {
  // 尝试解析 "City, State" 格式
  const parts = location.split(',');
  if (parts.length >= 1) {
    const city = parts[0].trim();
    if (city && city.length > 0) {
      return city.toLowerCase().replace(/\s+/g, '+');
    }
  }
  return null;
}

/**
 * 构建搜索 URL
 * Anywho URL 格式: /people/{name}/{state}/{city}
 * 例如: /people/john+smith/new+york/new+york
 */
function buildSearchUrl(name: string, location?: string, page: number = 1): string {
  const encodedName = name.trim().toLowerCase().replace(/\s+/g, '+');
  
  let locationPath = '';
  if (location) {
    // 检查是否是邮编（纯数字）
    const isZipcode = /^\d{5}(-\d{4})?$/.test(location.trim());
    
    if (isZipcode) {
      // 邮编搜索：直接使用邮编作为地点
      // Anywho 支持邮编搜索，但格式可能不同
      locationPath = `/${location.trim()}`;
    } else {
      // 解析州名
      const stateName = parseStateName(location);
      // 解析城市名
      const cityName = parseCityName(location);
      
      if (stateName) {
        locationPath = `/${stateName.toLowerCase().replace(/\s+/g, '+')}`;
        // 如果有城市，添加城市路径
        if (cityName) {
          locationPath += `/${cityName}`;
        }
      } else if (cityName) {
        // 只有城市，没有州
        // 尝试直接使用城市名
        locationPath = `/${cityName}`;
      }
    }
  }
  
  let url = `${ANYWHO_CONFIG.BASE_URL}/people/${encodedName}${locationPath}`;
  
  if (page > 1) {
    url += `?page=${page}`;
  }
  
  return url;
}

/**
 * 验证详情链接是否有效
 */
function isValidDetailLink(link: string): boolean {
  // 有效链接格式: /people/john+smith/california/berkeley/a898616287051198497024455438080713
  const pattern = /^\/people\/[a-z+]+\/[a-z]+\/[a-z+]+\/[a-z0-9]+$/i;
  return pattern.test(link) && !link.includes('\\') && !link.includes('"') && !link.includes('<');
}

/**
 * 解析搜索结果页面
 */
export function parseSearchResults(html: string): AnywhoSearchResult[] {
  const results: AnywhoSearchResult[] = [];
  const $ = cheerio.load(html);
  
  // 方法1: 使用更精确的正则表达式提取详情链接
  // 格式: /people/john+smith/california/berkeley/a898616287051198497024455438080713
  const detailLinkPattern = /\/people\/([a-z+]+)\/([a-z]+)\/([a-z+]+)\/([a-z0-9]+)(?=["'\s>])/gi;
  const links = new Set<string>();
  
  let match;
  while ((match = detailLinkPattern.exec(html)) !== null) {
    const fullLink = match[0];
    // 验证链接有效性
    if (isValidDetailLink(fullLink)) {
      links.add(fullLink);
    }
  }
  
  // 方法2: 从 <a> 标签中提取
  $('a[href*="/people/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && isValidDetailLink(href)) {
      links.add(href);
    }
  });
  
  // 处理找到的链接
  for (const link of links) {
    const parts = link.split('/');
    
    // /people/john+smith/california/berkeley/a898616287051198497024455438080713
    if (parts.length >= 6) {
      const namePart = parts[2].replace(/\+/g, ' ');
      const state = parts[3];
      const city = parts[4];
      const uniqueId = parts[5];
      
      // 验证 uniqueId 是否为有效的 ID（纯字母数字）
      if (!/^[a-z0-9]+$/i.test(uniqueId)) {
        continue;
      }
      
      // 验证州名是否有效
      if (!Object.values(STATE_MAP).includes(state.toLowerCase())) {
        continue;
      }
      
      // 解析名字
      const nameParts = namePart.split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      
      // 格式化名字
      const formatName = (s: string) => s.split(' ').map(w => 
        w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      ).join(' ');
      
      results.push({
        name: formatName(namePart),
        firstName: formatName(firstName),
        lastName: formatName(lastName),
        age: null,  // 年龄需要从详情页获取
        city: formatName(city.replace(/\+/g, ' ')),
        state: formatName(state),
        location: `${formatName(city.replace(/\+/g, ' '))}, ${STATE_ABBR_MAP[state.toLowerCase()] || state.toUpperCase()}`,
        detailLink: link.startsWith('http') ? link : `${ANYWHO_CONFIG.BASE_URL}${link}`,
      });
    }
  }
  
  // 去重（基于 detailLink）
  const uniqueResults = results.filter((result, index, self) =>
    index === self.findIndex(r => r.detailLink === result.detailLink)
  );
  
  return uniqueResults;
}

/**
 * 解析详情页面
 */
export function parseDetailPage(html: string): AnywhoDetailResult | null {
  try {
    const $ = cheerio.load(html);
    const text = $.text();
    
    // 1. 提取姓名（从 title 标签）
    const title = $('title').text();
    let name = '';
    let city = '';
    let state = '';
    
    // 格式: "John W Smith Jr., Berkeley, CA 94702 | Anywho"
    const titleMatch = title.match(/^([^,]+),\s*([^,]+),\s*([A-Z]{2})/);
    if (titleMatch) {
      name = titleMatch[1].trim();
      city = titleMatch[2].trim();
      state = titleMatch[3].trim();
    }
    
    // 2. 提取年龄
    let age: number | null = null;
    // 尝试多种模式
    const agePatterns = [
      /,\s*(\d{2,3})\s*(?:Aka|AKA|$)/,
      /Age\s*(\d{2,3})/i,
      /(\d{2,3})\s*years?\s*old/i,
    ];
    
    for (const pattern of agePatterns) {
      const ageMatch = text.match(pattern);
      if (ageMatch) {
        const parsedAge = parseInt(ageMatch[1], 10);
        if (parsedAge > 0 && parsedAge < 150) {
          age = parsedAge;
          break;
        }
      }
    }
    
    // 3. 提取婚姻状态
    let marriageStatus: string | null = null;
    const marriagePatterns = [
      /(?:is|appears to be)\s+(single|married|divorced|widowed)/i,
      /marital\s+status[:\s]*(single|married|divorced|widowed)/i,
      /relationship\s+status[:\s]*(single|married|divorced|widowed)/i,
    ];
    
    for (const pattern of marriagePatterns) {
      const match = text.match(pattern);
      if (match) {
        marriageStatus = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
        break;
      }
    }
    
    // 4. 提取婚姻记录
    const marriageRecords: string[] = [];
    const marriageRecordPattern = /was\s+married\s+on\s+(\d{2}\/\d{4})\s+in\s+([A-Za-z\s]+?)(?:\.|Marriage|$)/gi;
    let marriageMatch;
    while ((marriageMatch = marriageRecordPattern.exec(text)) !== null) {
      const record = `${marriageMatch[1]} in ${marriageMatch[2].trim()}`;
      if (!marriageRecords.includes(record) && marriageRecords.length < 20) {
        marriageRecords.push(record);
      }
    }
    
    // 5. 提取电话号码
    const phones: string[] = [];
    const phonePattern = /(\d{3}[-.]?\d{3}[-.]?\d{4})/g;
    let phoneMatch;
    while ((phoneMatch = phonePattern.exec(text)) !== null) {
      const phone = phoneMatch[1].replace(/[-.]/, '');
      // 验证电话号码格式
      if (/^\d{10}$/.test(phone.replace(/\D/g, '')) && !phones.includes(phone)) {
        phones.push(phone);
      }
    }
    
    // 6. 提取地址
    let currentAddress = '';
    const addressPatterns = [
      /CURRENT ADDRESS[:\s]*([^P\n]+?)(?:PREVIOUS|CONTACT|$)/i,
      /Lives in[:\s]*([^.]+)/i,
    ];
    
    for (const pattern of addressPatterns) {
      const match = text.match(pattern);
      if (match) {
        currentAddress = match[1].trim().substring(0, 200);
        break;
      }
    }
    
    // 7. 提取邮箱
    const emails: string[] = [];
    const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    let emailMatch;
    while ((emailMatch = emailPattern.exec(text)) !== null) {
      const email = emailMatch[1].toLowerCase();
      if (!emails.includes(email) && !email.includes('anywho') && !email.includes('example')) {
        emails.push(email);
      }
    }
    
    // 8. 提取亲属
    const familyMembers: string[] = [];
    const relativesPatterns = [
      /MAY BE RELATED TO[:\s]*([^V]+?)(?:View|Phone|Address|$)/i,
      /POSSIBLE RELATIVES[:\s]*([^V]+?)(?:View|Phone|Address|$)/i,
      /Related to[:\s]*([^.]+)/i,
    ];
    
    for (const pattern of relativesPatterns) {
      const match = text.match(pattern);
      if (match) {
        const names = match[1].match(/[A-Z][a-z]+\s+(?:[A-Z]\.?\s+)?[A-Z][a-z]+/g);
        if (names) {
          for (const n of names) {
            if (!familyMembers.includes(n) && familyMembers.length < 10) {
              familyMembers.push(n);
            }
          }
        }
        break;
      }
    }
    
    // 9. 检查是否已故
    // 注意：Anywho 页面模板中包含 "Death Records" 链接，需要更精确的检测
    // 只有当页面明确显示死亡日期时才认为已故
    // 格式例如："may have passed away on 07/2006"
    const deathDatePattern = /may have passed away on \d{2}\/\d{4}/i;
    const isDeceased = deathDatePattern.test(text);
    
    // 10. 提取星座
    let zodiacSign: string | undefined;
    const zodiacMatch = text.match(/(?:zodiac|star sign|sun sign)[:\s]*(aries|taurus|gemini|cancer|leo|virgo|libra|scorpio|sagittarius|capricorn|aquarius|pisces)/i);
    if (zodiacMatch) {
      zodiacSign = zodiacMatch[1].charAt(0).toUpperCase() + zodiacMatch[1].slice(1).toLowerCase();
    }
    
    // 11. 提取运营商
    let carrier = '';
    const carrierMatch = text.match(/(AT&T|Verizon|T-Mobile|Sprint|TPX Communications|US Cellular|Cricket|Metro)/i);
    if (carrierMatch) {
      carrier = carrierMatch[0];
    }
    
    // 12. 提取电话类型
    let phoneType = 'Unknown';
    if (/mobile|cell|wireless/i.test(text)) {
      phoneType = 'Mobile';
    } else if (/landline|home|residential/i.test(text)) {
      phoneType = 'Landline';
    } else if (/voip/i.test(text)) {
      phoneType = 'VoIP';
    }
    
    // 解析名字
    const nameParts = name.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    
    return {
      name,
      firstName,
      lastName,
      age,
      city,
      state,
      location: `${city}, ${state}`,
      phone: phones[0] || '',
      phoneType,
      carrier,
      reportYear: new Date().getFullYear(),
      isPrimary: true,
      propertyValue: 0,
      yearBuilt: null,
      marriageStatus,
      marriageRecords: marriageRecords.slice(0, 10),
      familyMembers,
      employment: [],
      isDeceased,
      currentAddress,
      emails: emails.slice(0, 5),
      zodiacSign,
    };
  } catch (error) {
    console.error('[Anywho] 解析详情页失败:', error);
    return null;
  }
}

/**
 * 仅搜索（不获取详情）
 */
export async function searchOnly(
  name: string,
  location: string | undefined,
  maxPages: number,
  token: string,
  onProgress?: (page: number, results: AnywhoSearchResult[]) => void
): Promise<{
  results: AnywhoSearchResult[];
  pagesSearched: number;
}> {
  console.log(`[Anywho] 开始搜索: ${name}, 地点: ${location || '全国'}, 最大页数: ${maxPages}`);
  
  const allResults: AnywhoSearchResult[] = [];
  let pagesSearched = 0;
  
  for (let page = 1; page <= Math.min(maxPages, ANYWHO_CONFIG.MAX_PAGES); page++) {
    const searchUrl = buildSearchUrl(name, location, page);
    console.log(`[Anywho] 抓取第 ${page} 页: ${searchUrl}`);
    
    // 使用 Scrape.do API 抓取（启用 JavaScript 渲染，Anywho 是 Next.js 应用）
    const html = await scrapeUrl(searchUrl, token, { 
      render: true,
      useSuper: true,
      customWait: 3000,
      waitSelector: 'a[href*="/people/"]'  // 等待搜索结果链接加载
    });
    
    if (!html) {
      console.error(`[Anywho] 第 ${page} 页抓取失败`);
      break;
    }
    
    // 解析搜索结果
    const pageResults = parseSearchResults(html);
    console.log(`[Anywho] 第 ${page} 页找到 ${pageResults.length} 个有效结果`);
    
    if (pageResults.length === 0) {
      // 没有更多结果
      break;
    }
    
    allResults.push(...pageResults);
    pagesSearched = page;
    
    if (onProgress) {
      onProgress(page, pageResults);
    }
    
    // 添加延迟避免请求过快
    if (page < maxPages) {
      await new Promise(resolve => setTimeout(resolve, ANYWHO_CONFIG.BATCH_DELAY));
    }
  }
  
  // 去重
  const uniqueResults = allResults.filter((result, index, self) =>
    index === self.findIndex(r => r.detailLink === result.detailLink)
  );
  
  console.log(`[Anywho] 搜索完成: 共 ${uniqueResults.length} 个唯一结果, 搜索了 ${pagesSearched} 页`);
  
  return {
    results: uniqueResults,
    pagesSearched,
  };
}

/**
 * 批量获取详情
 */
export async function fetchDetailsInBatch(
  tasks: DetailTask[],
  token: string,
  filters: AnywhoFilters,
  onDetailFetched?: (task: DetailTask, detail: AnywhoDetailResult | null) => void,
  onProgress?: (completed: number, total: number) => void
): Promise<{
  results: Array<{
    task: DetailTask;
    detail: AnywhoDetailResult | null;
  }>;
  requestCount: number;
}> {
  console.log(`[Anywho] 开始批量获取详情: ${tasks.length} 个任务`);
  
  const results: Array<{
    task: DetailTask;
    detail: AnywhoDetailResult | null;
  }> = [];
  
  let requestCount = 0;
  
  // 分批处理，控制并发
  const batchSize = ANYWHO_CONFIG.TASK_CONCURRENCY;
  
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);
    
    // 并发处理当前批次
    const batchPromises = batch.map(async (task) => {
      requestCount++;
      
      // 构建完整 URL
      const detailUrl = task.detailLink.startsWith('http') 
        ? task.detailLink 
        : `${ANYWHO_CONFIG.BASE_URL}${task.detailLink}`;
      
      console.log(`[Anywho] 获取详情: ${detailUrl}`);
      
      // 抓取详情页（启用 JavaScript 渲染，Anywho 是 Next.js 应用）
      const html = await scrapeUrl(detailUrl, token, { 
        render: true,
        useSuper: true,
        customWait: 3000
      });
      
      if (!html) {
        console.error(`[Anywho] 详情页抓取失败: ${detailUrl}`);
        return { task, detail: null };
      }
      
      // 解析详情
      const detail = parseDetailPage(html);
      
      if (!detail) {
        return { task, detail: null };
      }
      
      // 应用过滤条件
      if (filters.minAge && detail.age && detail.age < filters.minAge) {
        return { task, detail: null };
      }
      if (filters.maxAge && detail.age && detail.age > filters.maxAge) {
        return { task, detail: null };
      }
      
      return { task, detail };
    });
    
    // 等待当前批次完成
    const batchResults = await Promise.all(batchPromises);
    
    // 处理结果
    for (const result of batchResults) {
      results.push(result);
      
      if (onDetailFetched) {
        onDetailFetched(result.task, result.detail);
      }
    }
    
    // 更新进度
    if (onProgress) {
      onProgress(results.length, tasks.length);
    }
    
    // 批次间延迟
    if (i + batchSize < tasks.length) {
      await new Promise(resolve => setTimeout(resolve, ANYWHO_CONFIG.BATCH_DELAY));
    }
  }
  
  console.log(`[Anywho] 详情获取完成: ${results.filter(r => r.detail !== null).length}/${tasks.length} 成功`);
  
  return {
    results,
    requestCount,
  };
}

/**
 * 完整搜索流程（搜索 + 获取详情）
 */
export async function fullSearch(
  name: string,
  location: string | undefined,
  maxPages: number,
  token: string,
  filters: AnywhoFilters = {},
  onSearchProgress?: (page: number, results: AnywhoSearchResult[]) => void,
  onDetailProgress?: (completed: number, total: number) => void
): Promise<{
  searchResults: AnywhoSearchResult[];
  detailResults: AnywhoDetailResult[];
  pagesSearched: number;
  requestCount: number;
}> {
  // 第一步：搜索
  const { results: searchResults, pagesSearched } = await searchOnly(
    name,
    location,
    maxPages,
    token,
    onSearchProgress
  );
  
  if (searchResults.length === 0) {
    return {
      searchResults: [],
      detailResults: [],
      pagesSearched,
      requestCount: pagesSearched,
    };
  }
  
  // 第二步：获取详情
  const tasks: DetailTask[] = searchResults.map((result, index) => ({
    detailLink: result.detailLink,
    searchName: result.name,
    searchLocation: result.location,
    subTaskIndex: index,
  }));
  
  const { results: detailResults, requestCount } = await fetchDetailsInBatch(
    tasks,
    token,
    filters,
    undefined,
    onDetailProgress
  );
  
  return {
    searchResults,
    detailResults: detailResults
      .filter(r => r.detail !== null)
      .map(r => r.detail as AnywhoDetailResult),
    pagesSearched,
    requestCount: pagesSearched + requestCount,
  };
}
