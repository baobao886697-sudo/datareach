/**
 * Anywho 爬虫模块
 * 独立模块，方便后期管理和修改
 * 
 * 使用 Scrape.do API 进行网页抓取
 * 
 * 重要更新 (2026-01-26):
 * - 直接从搜索结果页提取完整数据，避免访问详情页被 CAPTCHA 阻止
 * - 搜索结果页包含：姓名、年龄、地址、电话、邮箱、亲属等信息
 * - 大幅减少 API 请求数量和费用
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

// 搜索结果类型 - 增强版，包含完整数据
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
  phoneCount?: number;
  addressCount?: number;
  emailCount?: number;
  socialCount?: number;
  relativeCount?: number;
}

// 详情结果类型（包含婚姻状况）- 从搜索结果页提取
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
  marriageStatus: string | null;
  marriageRecords?: string[];
  familyMembers: string[];
  employment: string[];
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
  'WI': 'wisconsin', 'WY': 'wyoming', 'DC': 'district of columbia'
};

// 州缩写映射（反向）
const STATE_ABBR_MAP: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC'
};

// Anywho 年龄段类型
export type AnywhoAgeRange = '0-30' | '31-60' | '61-80' | '80+';

/**
 * 根据用户年龄范围确定需要搜索的 Anywho 年龄段
 */
export function determineAgeRanges(minAge: number, maxAge: number): AnywhoAgeRange[] {
  const ranges: AnywhoAgeRange[] = [];
  
  // Anywho 的 4 个固定年龄段: 0-30, 31-60, 61-80, 80+
  if (minAge <= 30 && maxAge >= 0) {
    ranges.push('0-30');
  }
  if (minAge <= 60 && maxAge >= 31) {
    ranges.push('31-60');
  }
  if (minAge <= 80 && maxAge >= 61) {
    ranges.push('61-80');
  }
  if (maxAge > 80) {
    ranges.push('80+');
  }
  
  // 如果没有匹配的范围，默认搜索 31-60 和 61-80
  if (ranges.length === 0) {
    ranges.push('31-60', '61-80');
  }
  
  return ranges;
}

// 格式化名字（首字母大写）
function formatName(name: string): string {
  return name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * 构建搜索 URL
 * @param name 搜索姓名
 * @param location 可选的位置（城市, 州）
 * @param page 页码
 * @param ageRange 可选的年龄段过滤
 */
export function buildSearchUrl(name: string, location?: string, page: number = 1, ageRange?: AnywhoAgeRange): string {
  // 格式化名字：空格替换为 +
  const formattedName = name.trim().toLowerCase().replace(/\s+/g, '+');
  
  let url = `${ANYWHO_CONFIG.BASE_URL}/people/${formattedName}`;
  
  // 如果有位置信息，添加到 URL
  if (location) {
    const parts = location.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      const city = parts[0].toLowerCase().replace(/\s+/g, '+');
      const stateInput = parts[1].trim().toUpperCase();
      const stateName = STATE_MAP[stateInput] || stateInput.toLowerCase();
      url = `${ANYWHO_CONFIG.BASE_URL}/people/${formattedName}/${stateName}/${city}`;
    } else if (parts.length === 1) {
      // 只有州
      const stateInput = parts[0].trim().toUpperCase();
      const stateName = STATE_MAP[stateInput] || stateInput.toLowerCase();
      url = `${ANYWHO_CONFIG.BASE_URL}/people/${formattedName}/${stateName}`;
    }
  }
  
  // 构建查询参数
  const params: string[] = [];
  
  // 添加年龄段过滤参数
  if (ageRange) {
    params.push(`age_range=${encodeURIComponent(ageRange)}`);
  }
  
  // 添加页码（如果不是第一页）
  if (page > 1) {
    params.push(`page=${page}`);
  }
  
  // 拼接查询参数
  if (params.length > 0) {
    url += '?' + params.join('&');
  }
  
  return url;
}

/**
 * 使用 Scrape.do API 抓取页面
 */
export async function fetchWithScrapeApi(url: string, apiKey: string): Promise<string> {
  const scrapeUrl = new URL(ANYWHO_CONFIG.SCRAPE_API);
  scrapeUrl.searchParams.set('token', apiKey);
  scrapeUrl.searchParams.set('url', url);
  scrapeUrl.searchParams.set('render', 'true');
  scrapeUrl.searchParams.set('wait', '3000');
  
  const response = await fetch(scrapeUrl.toString(), {
    method: 'GET',
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(ANYWHO_CONFIG.REQUEST_TIMEOUT),
  });
  
  if (!response.ok) {
    throw new Error(`Scrape.do API error: ${response.status} ${response.statusText}`);
  }
  
  return await response.text();
}

/**
 * 将 HTML 转换为 Markdown 格式（用于解析）
 */
function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(html);
  
  // 移除脚本和样式
  $('script, style, noscript').remove();
  
  let markdown = '';
  
  // 提取搜索结果卡片
  // Anywho 的搜索结果通常在特定的容器中
  const resultCards = $('[data-testid="person-card"], .person-card, .search-result, [class*="PersonCard"], [class*="person-result"]');
  
  if (resultCards.length > 0) {
    resultCards.each((_, card) => {
      const $card = $(card);
      markdown += extractCardInfo($, $card) + '\n\n---\n\n';
    });
  } else {
    // 如果找不到特定的卡片，尝试提取整个页面的文本
    markdown = $('body').text().replace(/\s+/g, ' ').trim();
  }
  
  return markdown;
}

/**
 * 从卡片中提取信息
 */
function extractCardInfo($: cheerio.CheerioAPI, $card: cheerio.Cheerio<cheerio.Element>): string {
  let info = '';
  
  // 提取姓名和年龄
  const nameEl = $card.find('h2, h3, [class*="name"], [class*="Name"]').first();
  const name = nameEl.text().trim();
  if (name) {
    info += `Name: ${name}\n`;
  }
  
  // 提取年龄
  const ageMatch = $card.text().match(/Age\s*(\d+)/i);
  if (ageMatch) {
    info += `Age: ${ageMatch[1]}\n`;
  }
  
  // 提取地址
  const addressEl = $card.find('[class*="address"], [class*="Address"], [class*="location"], [class*="Location"]');
  if (addressEl.length > 0) {
    info += `Address: ${addressEl.text().trim()}\n`;
  }
  
  // 提取电话
  const phoneMatch = $card.text().match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g);
  if (phoneMatch) {
    info += `Phones: ${phoneMatch.join(', ')}\n`;
  }
  
  // 提取详情链接
  const detailLink = $card.find('a[href*="/people/"]').attr('href');
  if (detailLink) {
    info += `DetailLink: ${detailLink}\n`;
  }
  
  return info;
}

/**
 * 解析搜索结果页面 - 更新版本，匹配实际的 Markdown 格式
 * 
 * 实际格式示例:
 * John Smith, Age 43
 * View Details
 * AKA:  
 * John A Smith  
 * LIVES IN:
 * 304 Brook Ave, Suffolk, VA  
 * PHONE NUMBER(S):
 * (806) 730-3241  •  (806) 400-5974
 * EMAILS:
 * j*****@yahoo.com
 * MAY BE RELATED TO:
 * James Smith  •  Leslie Hardin
 * Phone Numbers (3)
 * Addresses (1)
 * Email Addresses (1)
 * Social Profiles (0)
 * Relatives (0)
 */
export function parseSearchResults(html: string): AnywhoSearchResult[] {
  const results: AnywhoSearchResult[] = [];
  
  // 新的正则表达式，匹配实际的 Markdown 格式
  // 格式: "Name, Age XX" 或 "Name, Age XX♂/♀"
  const personPattern = /^([A-Z][a-zA-Z\s.]+),\s*Age\s*(\d+)\s*[♂♀]?\s*$/gm;
  
  const lines = html.split('\n');
  let currentPerson: {
    name: string;
    age: number;
    startIndex: number;
  } | null = null;
  
  const personBlocks: Array<{
    name: string;
    age: number;
    content: string;
  }> = [];
  
  let currentContent = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // 检查是否是新的人员开始
    const personMatch = line.match(/^([A-Z][a-zA-Z\s.]+),\s*Age\s*(\d+)\s*[♂♀]?\s*$/);
    
    if (personMatch) {
      // 保存前一个人员的信息
      if (currentPerson) {
        personBlocks.push({
          name: currentPerson.name,
          age: currentPerson.age,
          content: currentContent.trim(),
        });
      }
      
      // 开始新的人员
      currentPerson = {
        name: personMatch[1].trim(),
        age: parseInt(personMatch[2], 10),
        startIndex: i,
      };
      currentContent = line + '\n';
    } else if (currentPerson) {
      // 检查是否到达下一个人员或统计信息部分
      if (line.startsWith('John Smith Summary') || 
          line.startsWith('John Smith in Numbers') ||
          line.match(/^\d+$/) ||  // 页码
          line.match(/^[A-Z]$/)) {  // 字母索引
        // 保存当前人员
        personBlocks.push({
          name: currentPerson.name,
          age: currentPerson.age,
          content: currentContent.trim(),
        });
        currentPerson = null;
        currentContent = '';
      } else {
        currentContent += line + '\n';
      }
    }
  }
  
  // 保存最后一个人员
  if (currentPerson) {
    personBlocks.push({
      name: currentPerson.name,
      age: currentPerson.age,
      content: currentContent.trim(),
    });
  }
  
  console.log(`[Anywho] 找到 ${personBlocks.length} 个人员块`);
  
  // 解析每个人员块
  for (const block of personBlocks) {
    const content = block.content;
    
    // 提取详情链接 - 从 "View Details" 行之后或内容中查找
    let detailLink = '';
    const linkMatch = content.match(/\/people\/([a-z+\-]+)\/([a-z]+)\/([a-z+\-]+)\/([a-z0-9]+)/i);
    if (linkMatch) {
      detailLink = `${ANYWHO_CONFIG.BASE_URL}${linkMatch[0]}`;
    }
    
    // 提取 AKA（别名）
    let aka: string | undefined;
    const akaMatch = content.match(/AKA:\s*\n([^\n]+)/i);
    if (akaMatch) {
      aka = akaMatch[1].trim().replace(/\s*•\s*/g, ', ').replace(/\s+/g, ' ');
    }
    
    // 提取当前地址
    let currentAddress: string | undefined;
    let city = '';
    let state = '';
    const livesInMatch = content.match(/LIVES IN:\s*\n([^\n]+)/i);
    if (livesInMatch) {
      currentAddress = livesInMatch[1].trim();
      // 从地址中提取城市和州
      const addressParts = currentAddress.match(/,\s*([A-Za-z\s]+),\s*([A-Z]{2})\s*$/);
      if (addressParts) {
        city = addressParts[1].trim();
        state = addressParts[2].trim();
      } else {
        // 尝试另一种格式
        const simpleParts = currentAddress.match(/([A-Za-z\s]+),\s*([A-Z]{2})\s*$/);
        if (simpleParts) {
          city = simpleParts[1].trim();
          state = simpleParts[2].trim();
        }
      }
    }
    
    // 如果没有从地址提取到城市和州，尝试从详情链接提取
    if (!city && linkMatch) {
      const stateName = linkMatch[2];
      const cityName = linkMatch[3].replace(/[+\-]/g, ' ');
      city = formatName(cityName);
      state = STATE_ABBR_MAP[stateName.toLowerCase()] || stateName.toUpperCase();
    }
    
    // 提取历史地址
    const previousAddresses: string[] = [];
    const usedToLiveMatch = content.match(/USED TO LIVE IN:\s*\n([\s\S]*?)(?=PHONE|EMAILS|MAY BE|Phone Numbers|$)/i);
    if (usedToLiveMatch) {
      const addressText = usedToLiveMatch[1];
      const addresses = addressText.split(/\s*•\s*|\n/).map(a => a.trim()).filter(a => a && !a.includes('more') && a.length > 5);
      previousAddresses.push(...addresses.slice(0, 5));
    }
    
    // 提取电话号码
    const phones: string[] = [];
    const phoneBlockMatch = content.match(/PHONE NUMBER\(S\):\s*\n([\s\S]*?)(?=EMAILS|MAY BE|Phone Numbers|$)/i);
    if (phoneBlockMatch) {
      const phoneText = phoneBlockMatch[1];
      const phonePattern = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
      let pm;
      while ((pm = phonePattern.exec(phoneText)) !== null) {
        const phone = pm[0].replace(/\D/g, '');
        if (phone.length === 10 && !phones.includes(phone)) {
          phones.push(phone);
        }
      }
    }
    
    // 提取邮箱
    const emails: string[] = [];
    const emailBlockMatch = content.match(/EMAILS?:\s*\n([\s\S]*?)(?=MAY BE|Phone Numbers|$)/i);
    if (emailBlockMatch) {
      const emailText = emailBlockMatch[1];
      const emailPattern = /[a-zA-Z0-9*._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      let em;
      while ((em = emailPattern.exec(emailText)) !== null) {
        const email = em[0].toLowerCase();
        if (!emails.includes(email) && !email.includes('anywho')) {
          emails.push(email);
        }
      }
    }
    
    // 提取亲属
    const relatives: string[] = [];
    const relativesBlockMatch = content.match(/MAY BE RELATED TO:\s*\n([\s\S]*?)(?=Phone Numbers|$)/i);
    if (relativesBlockMatch) {
      const relText = relativesBlockMatch[1];
      const relNames = relText.split(/\s*•\s*|\n/).map(n => n.trim()).filter(n => n && !n.includes('more') && n.match(/^[A-Z][a-z]+ [A-Z][a-z]+$/));
      relatives.push(...relNames);
    }
    
    // 提取统计数量
    let phoneCount = 0, addressCount = 0, emailCount = 0, socialCount = 0, relativeCount = 0;
    
    const phoneCountMatch = content.match(/Phone Numbers?\s*\((\d+)\)/i);
    if (phoneCountMatch) phoneCount = parseInt(phoneCountMatch[1], 10);
    
    const addressCountMatch = content.match(/Addresses?\s*\((\d+)\)/i);
    if (addressCountMatch) addressCount = parseInt(addressCountMatch[1], 10);
    
    const emailCountMatch = content.match(/Email Addresses?\s*\((\d+)\)/i);
    if (emailCountMatch) emailCount = parseInt(emailCountMatch[1], 10);
    
    const socialCountMatch = content.match(/Social Profiles?\s*\((\d+)\)/i);
    if (socialCountMatch) socialCount = parseInt(socialCountMatch[1], 10);
    
    const relativeCountMatch = content.match(/Relatives?\s*\((\d+)\)/i);
    if (relativeCountMatch) relativeCount = parseInt(relativeCountMatch[1], 10);
    
    // 解析名字
    const nameParts = block.name.split(' ').filter(p => p.length > 0);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    
    // 如果没有城市和州信息，跳过这条记录
    if (!city && !state && !currentAddress) {
      console.log(`[Anywho] 跳过无地址信息的记录: ${block.name}`);
      continue;
    }
    
    // 构建位置字符串
    const location = state ? `${city}, ${state}` : city;
    
    // 检查是否已存在（去重）
    const existingIndex = results.findIndex(r => 
      r.name === block.name && 
      r.age === block.age && 
      r.location === location
    );
    
    if (existingIndex === -1) {
      results.push({
        name: block.name,
        firstName: formatName(firstName),
        lastName: formatName(lastName),
        age: (block.age > 0 && block.age < 150) ? block.age : null,
        city: city || 'Unknown',
        state: state || 'Unknown',
        location: location || 'Unknown',
        detailLink: detailLink || '',
        aka,
        currentAddress,
        previousAddresses,
        phones,
        emails,
        relatives,
        phoneCount,
        addressCount,
        emailCount,
        socialCount,
        relativeCount,
      });
    }
  }
  
  console.log(`[Anywho] 解析到 ${results.length} 条有效结果`);
  
  return results;
}

/**
 * 将搜索结果转换为详情结果
 * 直接使用搜索结果页的数据，无需访问详情页
 */
export function convertSearchResultToDetail(searchResult: AnywhoSearchResult): AnywhoDetailResult {
  return {
    name: searchResult.name,
    firstName: searchResult.firstName,
    lastName: searchResult.lastName,
    age: searchResult.age,
    city: searchResult.city,
    state: searchResult.state,
    location: searchResult.location,
    phone: searchResult.phones?.[0] || '',
    phoneType: 'Unknown',
    carrier: '',
    allPhones: searchResult.phones,
    reportYear: new Date().getFullYear(),
    isPrimary: true,
    propertyValue: 0,
    yearBuilt: null,
    marriageStatus: null,
    marriageRecords: [],
    familyMembers: searchResult.relatives || [],
    employment: [],
    isDeceased: false,
    currentAddress: searchResult.currentAddress,
    previousAddresses: searchResult.previousAddresses,
    emails: searchResult.emails,
    socialProfiles: [],
    zodiacSign: undefined,
  };
}

/**
 * 检查是否有下一页
 */
export function hasNextPage(html: string, currentPage: number): boolean {
  // 检查是否有下一页链接
  const nextPagePattern = new RegExp(`page=${currentPage + 1}|Page ${currentPage + 1}`, 'i');
  return nextPagePattern.test(html);
}

/**
 * 仅搜索模式 - 支持双年龄搜索
 * 同时搜索多个年龄段以获取完整数据
 * 
 * @param name 搜索姓名
 * @param location 搜索地点
 * @param maxPages 每个年龄段的最大页数
 * @param apiKey Scrape.do API Key
 * @param ageRanges 需要搜索的年龄段数组
 * @param onLog 日志回调函数
 */
export async function searchOnly(
  name: string,
  location: string | undefined,
  maxPages: number,
  apiKey: string,
  ageRanges: AnywhoAgeRange[] = ['31-60', '61-80'],
  onLog?: (message: string) => void
): Promise<{
  results: AnywhoSearchResult[];
  pagesSearched: number;
  ageRangesSearched: AnywhoAgeRange[];
}> {
  const log = onLog || console.log;
  const allResults: AnywhoSearchResult[] = [];
  let pagesSearched = 0;
  
  log(`[Anywho] 开始双年龄搜索: ${name}, 地点: ${location || '全国'}, 年龄段: ${ageRanges.join(', ')}, 每段最大页数: ${maxPages}`);
  
  // 对每个年龄段进行搜索
  for (const ageRange of ageRanges) {
    log(`[Anywho] 开始搜索年龄段: ${ageRange}`);
    
    let page = 1;
    let hasMore = true;
    
    while (hasMore && page <= maxPages) {
      const url = buildSearchUrl(name, location, page, ageRange);
      log(`[Anywho] 抓取 [${ageRange}] 第 ${page} 页: ${url}`);
      
      try {
        const html = await fetchWithScrapeApi(url, apiKey);
        pagesSearched++;
        
        const pageResults = parseSearchResults(html);
        log(`[Anywho] [${ageRange}] 第 ${page} 页找到 ${pageResults.length} 条结果`);
        
        if (pageResults.length === 0) {
          log(`[Anywho] [${ageRange}] 第 ${page} 页无结果，停止搜索此年龄段`);
          hasMore = false;
        } else {
          // 合并结果，去重
          for (const result of pageResults) {
            const exists = allResults.some(r => 
              r.name === result.name && 
              r.age === result.age && 
              r.location === result.location
            );
            if (!exists) {
              allResults.push(result);
            }
          }
          
          // 检查是否有下一页
          hasMore = hasNextPage(html, page);
          page++;
        }
      } catch (error) {
        log(`[Anywho] [${ageRange}] 第 ${page} 页抓取失败: ${error}`);
        hasMore = false;
      }
      
      // 添加延迟避免请求过快
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, ANYWHO_CONFIG.BATCH_DELAY));
      }
    }
    
    log(`[Anywho] 年龄段 ${ageRange} 搜索完成，累计 ${allResults.length} 条结果`);
  }
  
  log(`[Anywho] 双年龄搜索完成: 共 ${allResults.length} 条结果, ${pagesSearched} 页`);
  
  return {
    results: allResults,
    pagesSearched,
    ageRangesSearched: ageRanges,
  };
}

/**
 * 完整搜索模式（搜索 + 详情）
 * 注意：由于 CAPTCHA 问题，详情页访问可能失败
 * 建议使用 searchOnly 模式
 */
export async function fullSearch(
  name: string,
  location: string | undefined,
  maxPages: number,
  apiKey: string,
  ageRanges: AnywhoAgeRange[] = ['31-60', '61-80'],
  onLog?: (message: string) => void
): Promise<{
  results: AnywhoDetailResult[];
  pagesSearched: number;
  ageRangesSearched: AnywhoAgeRange[];
}> {
  const log = onLog || console.log;
  
  // 先执行搜索
  const searchResult = await searchOnly(name, location, maxPages, apiKey, ageRanges, onLog);
  
  // 将搜索结果转换为详情结果
  const detailResults = searchResult.results.map(convertSearchResultToDetail);
  
  log(`[Anywho] 完整搜索完成: ${detailResults.length} 条详情结果`);
  
  return {
    results: detailResults,
    pagesSearched: searchResult.pagesSearched,
    ageRangesSearched: searchResult.ageRangesSearched,
  };
}

/**
 * 搜索并获取详情（带详情页访问）
 * 注意：由于 CAPTCHA 问题，此方法可能不稳定
 */
export async function searchAndFetchDetails(
  name: string,
  location: string | undefined,
  maxPages: number,
  apiKey: string,
  maxDetails: number = 50,
  ageRanges: AnywhoAgeRange[] = ['31-60', '61-80'],
  onLog?: (message: string) => void
): Promise<{
  results: AnywhoDetailResult[];
  pagesSearched: number;
  ageRangesSearched: AnywhoAgeRange[];
}> {
  // 由于 CAPTCHA 问题，直接使用 fullSearch
  return fullSearch(name, location, maxPages, apiKey, ageRanges, onLog);
}
