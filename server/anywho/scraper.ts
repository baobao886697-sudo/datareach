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
import { globalHttpSemaphore } from '../tps/httpSemaphore';

/**
 * Scrape.do API 积分耗尽错误 - HTTP 401/403
 * 此错误不可重试，应立即停止所有请求
 */
export class ScrapeApiCreditsError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number = 401) {
    super(message);
    this.name = 'ScrapeApiCreditsError';
    this.statusCode = statusCode;
  }
}

// Anywho 配置
export const ANYWHO_CONFIG = {
  BASE_URL: "https://www.anywho.com",
  SCRAPE_API: "https://api.scrape.do/",
  TOTAL_CONCURRENCY: 10,  // 总并发数
  TASK_CONCURRENCY: 4,    // 搜索任务并发数
  MAX_PAGES: 4,           // 最大搜索页数（保守优化）
  BATCH_DELAY: 100,       // 批次间延迟(ms)（4线程+20并发高性能模式）
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
  'WI': 'wisconsin', 'WY': 'wyoming', 'DC': 'district of columbia',
};

// 州名反向映射（全名到缩写）
const STATE_ABBR_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_MAP).map(([abbr, name]) => [name, abbr])
);

/**
 * 使用 Scrape.do API 抓取网页
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
    render = true,
    useSuper = true,
    customWait = 3000,
    waitSelector,
    geoCode = 'us' 
  } = options;
  
  const params = new URLSearchParams({
    token,
    url,
    geoCode,
    output: 'markdown',  // 返回 Markdown 格式，便于解析
  });
  
  if (useSuper) {
    params.append('super', 'true');
  }
  
  if (render) {
    params.append('render', 'true');
    params.append('waitUntil', 'networkidle2');
    params.append('customWait', customWait.toString());
    
    if (waitSelector) {
      params.append('waitSelector', waitSelector);
    }
  }
  
  const apiUrl = `${ANYWHO_CONFIG.SCRAPE_API}?${params.toString()}`;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ANYWHO_CONFIG.REQUEST_TIMEOUT);
    
    // ⭐ 全局HTTP并发信号量保护
    await globalHttpSemaphore.acquire();
    let response: Response;
    try {
      response = await fetch(apiUrl, {
        signal: controller.signal,
      });
    } finally {
      globalHttpSemaphore.release();
    }
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      // 401/403: API 积分耗尽或认证失败，抛出特殊错误
      if (response.status === 401 || response.status === 403) {
        throw new ScrapeApiCreditsError(
          `Scrape.do API 积分已耗尽或认证失败: HTTP ${response.status} ${response.statusText}`,
          response.status
        );
      }
      console.error(`[Anywho] 抓取失败: ${response.status} ${response.statusText}`);
      return null;
    }
    
    return await response.text();
  } catch (error: any) {
    // API 积分耗尽错误向上传播，不吞掉
    if (error instanceof ScrapeApiCreditsError) {
      throw error;
    }
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
 */
// Anywho 年龄段类型
export type AnywhoAgeRange = '31-60' | '61-80';

/**
 * 根据用户设置的年龄范围，确定需要搜索的 Anywho 年龄段
 * Anywho 只有 4 个固定年龄段: 0-30, 31-60, 61-80, 80+
 */
export function determineAgeRanges(minAge: number, maxAge: number): AnywhoAgeRange[] {
  const ranges: AnywhoAgeRange[] = [];
  
  // 如果用户范围与 31-60 有交集
  if (minAge <= 60 && maxAge >= 31) {
    ranges.push('31-60');
  }
  
  // 如果用户范围与 61-80 有交集
  if (minAge <= 80 && maxAge >= 61) {
    ranges.push('61-80');
  }
  
  // 默认至少搜索一个年龄段
  if (ranges.length === 0) {
    if (maxAge <= 30) {
      ranges.push('31-60');
    } else {
      ranges.push('61-80');
    }
  }
  
  return ranges;
}

function buildSearchUrl(name: string, location?: string, page: number = 1, ageRange?: AnywhoAgeRange): string {
  const encodedName = name.trim().toLowerCase().replace(/\s+/g, '+');
  
  let locationPath = '';
  if (location) {
    const isZipcode = /^\d{5}(-\d{4})?$/.test(location.trim());
    
    if (isZipcode) {
      locationPath = `/${location.trim()}`;
    } else {
      const stateName = parseStateName(location);
      const cityName = parseCityName(location);
      
      if (stateName) {
        locationPath = `/${stateName.toLowerCase().replace(/\s+/g, '+')}`;
        if (cityName) {
          locationPath += `/${cityName}`;
        }
      } else if (cityName) {
        locationPath = `/${cityName}`;
      }
    }
  }
  
  let url = `${ANYWHO_CONFIG.BASE_URL}/people/${encodedName}${locationPath}`;
  
  // 构建查询参数
  const params: string[] = [];
  
  if (page > 1) {
    params.push(`page=${page}`);
  }
  
  if (ageRange) {
    params.push(`age_range=${ageRange}`);
  }
  
  if (params.length > 0) {
    url += `?${params.join('&')}`;
  }
  
  return url;
}

/**
 * 验证详情链接是否有效
 */
function isValidDetailLink(link: string): boolean {
  const pattern = /^\/people\/[a-z+]+\/[a-z]+\/[a-z+]+\/[a-z0-9]+$/i;
  return pattern.test(link) && !link.includes('\\') && !link.includes('"') && !link.includes('<');
}

/**
 * 格式化名字（首字母大写）
 */
function formatName(s: string): string {
  return s.split(' ').map(w => 
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');
}

/**
 * 解析搜索结果页面 - 增强版
 * 直接从搜索结果页提取完整数据，避免访问详情页被 CAPTCHA 阻止
 * 
 * Markdown 格式示例:
 * ## John Smith
 * 
 * , Age 86
 * 
 * [View Details](/people/john+smith/california/quail+valley/a78844514134)
 * 
 * ### AKA:
 * 
 * John B Smith
 * 
 * ### Lives in:
 * 
 * 24098 Canyon Lake Dr N, Canyon Lake, CA
 * 
 * ### Phone number(s):
 * 
 * (909) 244-5036
 * 
 * ### Emails:
 * 
 * c*****@hotmail.com
 * 
 * ### May be related to:
 * 
 * [Margaret Smith](/people/margaret+smith)
 * 
 * * Phone Numbers (1)
 * * Addresses (3)
 */
export function parseSearchResults(html: string): AnywhoSearchResult[] {
  const results: AnywhoSearchResult[] = [];
  
// 首先找到所有人员块的起始位置
  // 格式: ## Name\n\n, Age XX\n\n[View Details]
  const personStartPattern = /## ([A-Z][a-zA-Z\s.]+)\n\n,\s*Age\s*(\d+)\n\n\[View Details\]\(([^\)]+)\)/g;
  
  const personStarts: Array<{
    index: number;
    name: string;
    age: number;
    link: string;
  }> = [];
  
  let match;
  while ((match = personStartPattern.exec(html)) !== null) {
    personStarts.push({
      index: match.index,
      name: match[1].trim(),
      age: parseInt(match[2], 10),
      link: match[3],
    });
  }
  
  console.log(`[Anywho] 找到 ${personStarts.length} 个人员起始位置`);
  
  // 提取每个人员的完整块内容
  for (let i = 0; i < personStarts.length; i++) {
    const person = personStarts[i];
    const nextPerson = personStarts[i + 1];
    
    // 计算块的结束位置
    const blockEnd = nextPerson ? nextPerson.index : html.length;
    const blockContent = html.substring(person.index, blockEnd);
    
    // 验证详情链接格式
    const linkMatch = person.link.match(/\/people\/([a-z+]+)\/([a-z]+)\/([a-z+]+)\/([a-z0-9]+)/i);
    if (!linkMatch) continue;
    
    const stateName = linkMatch[2];
    const cityName = linkMatch[3].replace(/\+/g, ' ');
    
    // 验证州名是否有效
    if (!Object.values(STATE_MAP).includes(stateName.toLowerCase())) {
      continue;
    }
    
    // 提取 AKA（别名）
    let aka: string | undefined;
    const akaMatch = blockContent.match(/### AKA:\n\n([^\n#]+)/i);
    if (akaMatch) {
      aka = akaMatch[1].trim();
    }
    
    // 提取当前地址
    let currentAddress: string | undefined;
    const livesInMatch = blockContent.match(/### Lives in:\n\n([^\n#\[]+)/i);
    if (livesInMatch) {
      currentAddress = livesInMatch[1].trim();
    }
    
    // 提取历史地址
    const previousAddresses: string[] = [];
    const usedToLiveMatch = blockContent.match(/### Used to live in:\n\n([\s\S]*?)(?=###|\*|$)/i);
    if (usedToLiveMatch) {
      const addressText = usedToLiveMatch[1];
      const addresses = addressText.split(/[•\n]/).map(a => a.trim()).filter(a => a && !a.includes('more') && !a.startsWith('[') && !a.startsWith('\\'));
      previousAddresses.push(...addresses.slice(0, 5));
    }
    
    // 提取电话号码
    const phones: string[] = [];
    const phoneBlockMatch = blockContent.match(/### Phone number\(s\):\n\n([\s\S]*?)(?=###|\*|$)/i);
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
    const emailBlockMatch = blockContent.match(/### Emails?:\n\n([\s\S]*?)(?=###|\*|$)/i);
    if (emailBlockMatch) {
      const emailText = emailBlockMatch[1];
      // 邮箱可能被部分隐藏，如 c\*\*\*\*\*@hotmail.com
      const emailPattern = /[a-zA-Z0-9*._%-\\]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      let em;
      while ((em = emailPattern.exec(emailText)) !== null) {
        const email = em[0].toLowerCase().replace(/\\/g, '');
        if (!emails.includes(email) && !email.includes('anywho')) {
          emails.push(email);
        }
      }
    }
    
    // 提取亲属
    const relatives: string[] = [];
    const relativesBlockMatch = blockContent.match(/### May be related to:\n\n([\s\S]*?)(?=###|\*|$)/i);
    if (relativesBlockMatch) {
      const relText = relativesBlockMatch[1];
      const relPattern = /\[([A-Z][a-z]+ [A-Z][a-z]+)\]/g;
      let rm;
      while ((rm = relPattern.exec(relText)) !== null) {
        if (!relatives.includes(rm[1])) {
          relatives.push(rm[1]);
        }
      }
    }
    
    // 提取统计数量
    let phoneCount = 0, addressCount = 0, emailCount = 0, socialCount = 0, relativeCount = 0;
    
    const phoneCountMatch = blockContent.match(/\*\s*Phone Numbers?\s*\((\d+)\)/i);
    if (phoneCountMatch) phoneCount = parseInt(phoneCountMatch[1], 10);
    
    const addressCountMatch = blockContent.match(/\*\s*Addresses?\s*\((\d+)\)/i);
    if (addressCountMatch) addressCount = parseInt(addressCountMatch[1], 10);
    
    const emailCountMatch = blockContent.match(/\*\s*Email Addresses?\s*\((\d+)\)/i);
    if (emailCountMatch) emailCount = parseInt(emailCountMatch[1], 10);
    
    const socialCountMatch = blockContent.match(/\*\s*Social Profiles?\s*\((\d+)\)/i);
    if (socialCountMatch) socialCount = parseInt(socialCountMatch[1], 10);
    
    const relativeCountMatch = blockContent.match(/\*\s*Relatives?\s*\((\d+)\)/i);
    if (relativeCountMatch) relativeCount = parseInt(relativeCountMatch[1], 10);
    
    // 解析名字
    const nameParts = person.name.split(' ').filter(p => p.length > 0);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    
    // 格式化城市和州
    const city = formatName(cityName);
    const state = formatName(stateName);
    const stateAbbr = STATE_ABBR_MAP[stateName.toLowerCase()] || stateName.toUpperCase();
    
    // 检查是否已存在（去重）
    // 处理 link 格式：可能是相对路径 /people/... 或完整 URL http://www.anywho.com/people/...
    let fullDetailLink: string;
    if (person.link.startsWith('http://') || person.link.startsWith('https://')) {
      // 如果是完整 URL，统一使用 https
      fullDetailLink = person.link.replace('http://', 'https://');
    } else {
      // 如果是相对路径，拼接 BASE_URL
      fullDetailLink = `${ANYWHO_CONFIG.BASE_URL}${person.link}`;
    }
    const existingIndex = results.findIndex(r => r.detailLink === fullDetailLink);
    
    if (existingIndex === -1) {
      results.push({
        name: person.name,
        firstName: formatName(firstName),
        lastName: formatName(lastName),
        age: (person.age > 0 && person.age < 150) ? person.age : null,
        city,
        state,
        location: `${city}, ${stateAbbr}`,
        detailLink: fullDetailLink,
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
  };
}

/**
 * 解析详情页面 - 增强版
 * 从详情页提取完整信息：运营商、电话类型、婚姻状况等
 * 
 * 详情页格式示例：
 * - 电话: "757-944-8735\nPortsmouth, VA•T-Mobile"
 * - 婚姻: "Our records currently show that John is single."
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
    
    const titleMatch = title.match(/^([^,]+),\s*([^,]+),\s*([A-Z]{2})/);
    if (titleMatch) {
      name = titleMatch[1].trim();
      city = titleMatch[2].trim();
      state = titleMatch[3].trim();
    }
    
    // 2. 提取年龄
    let age: number | null = null;
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
    
    // 3. 提取婚姻状态 - 增强版
    let marriageStatus: string | null = null;
    const marriagePatterns = [
      /records\s+(?:currently\s+)?show\s+that\s+\w+\s+is\s+(single|married|divorced|widowed)/i,
      /(?:is|appears to be)\s+(single|married|divorced|widowed)/i,
      /marital\s+status[:\s]*(single|married|divorced|widowed)/i,
    ];
    
    for (const pattern of marriagePatterns) {
      const match = text.match(pattern);
      if (match) {
        marriageStatus = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
        break;
      }
    }
    
    // 4. 提取电话号码和运营商信息 - 增强版（含归属地）
    // 实际格式: "706-773-2626\nWest Point, GA\n•\nT-Mobile"
    const phoneInfoList: Array<{phone: string; carrier: string; phoneType: string; location: string; locationState: string}> = [];
    
    // 匹配电话号码、归属地和运营商信息
    // 实际格式: 706-773-2626\nWest Point, GA\n•\nT-Mobile (归属地和运营商之间有换行符和•)
    const phoneFullPattern = /(\d{3}[-.]?\d{3}[-.]?\d{4})[\s\n]+([A-Za-z\s]+),\s*([A-Z]{2})[\s\n]*•[\s\n]*(T-Mobile|Verizon\s*(?:Wireless)?|AT&T(?:\s*Southeast)?|Sprint|Cricket|Metro|US Cellular|Comcast|Xfinity|Spectrum|CenturyLink|Frontier|Windstream|TPX Communications|Bandwidth|Level 3|Lumen)/gi;
    let pfMatch;
    while ((pfMatch = phoneFullPattern.exec(text)) !== null) {
      const phone = pfMatch[1].replace(/[-.]/, '').replace(/\D/g, '');
      const locationCity = pfMatch[2].trim();
      const locationState = pfMatch[3].trim();
      const carrier = pfMatch[4].trim().replace(/\s*Southeast$/i, ''); // 移除 "Southeast" 后缀
      const location = `${locationCity}, ${locationState}`;
      
      // 根据运营商推断电话类型
      let phoneType = 'Unknown';
      const mobileCarriers = ['T-Mobile', 'Verizon', 'Verizon Wireless', 'AT&T', 'Sprint', 'Cricket', 'Metro', 'US Cellular'];
      const landlineCarriers = ['Comcast', 'Xfinity', 'Spectrum', 'CenturyLink', 'Frontier', 'Windstream'];
      const voipCarriers = ['Bandwidth', 'Level 3', 'Lumen', 'TPX Communications'];
      
      if (mobileCarriers.some(c => carrier.toLowerCase().includes(c.toLowerCase()))) {
        phoneType = 'Mobile';
      } else if (landlineCarriers.some(c => carrier.toLowerCase().includes(c.toLowerCase()))) {
        phoneType = 'Landline';
      } else if (voipCarriers.some(c => carrier.toLowerCase().includes(c.toLowerCase()))) {
        phoneType = 'VoIP';
      }
      
      if (phone.length === 10 && !phoneInfoList.some(p => p.phone === phone)) {
        phoneInfoList.push({ phone, carrier, phoneType, location, locationState });
      }
    }
    
    // 如果没有匹配到完整格式，尝试旧的匹配方式（只匹配运营商）
    if (phoneInfoList.length === 0) {
      const phoneCarrierPattern = /(\d{3}[-.]?\d{3}[-.]?\d{4})[\s\n]*[^\d]*?•\s*(T-Mobile|Verizon\s*(?:Wireless)?|AT&T|Sprint|Cricket|Metro|US Cellular|Comcast|Xfinity|Spectrum|CenturyLink|Frontier|Windstream|TPX Communications|Bandwidth|Level 3|Lumen)/gi;
      let pcMatch;
      while ((pcMatch = phoneCarrierPattern.exec(text)) !== null) {
        const phone = pcMatch[1].replace(/[-.]/, '').replace(/\D/g, '');
        const carrier = pcMatch[2].trim();
        
        let phoneType = 'Unknown';
        const mobileCarriers = ['T-Mobile', 'Verizon', 'Verizon Wireless', 'AT&T', 'Sprint', 'Cricket', 'Metro', 'US Cellular'];
        const landlineCarriers = ['Comcast', 'Xfinity', 'Spectrum', 'CenturyLink', 'Frontier', 'Windstream'];
        const voipCarriers = ['Bandwidth', 'Level 3', 'Lumen', 'TPX Communications'];
        
        if (mobileCarriers.some(c => carrier.toLowerCase().includes(c.toLowerCase()))) {
          phoneType = 'Mobile';
        } else if (landlineCarriers.some(c => carrier.toLowerCase().includes(c.toLowerCase()))) {
          phoneType = 'Landline';
        } else if (voipCarriers.some(c => carrier.toLowerCase().includes(c.toLowerCase()))) {
          phoneType = 'VoIP';
        }
        
        if (phone.length === 10 && !phoneInfoList.some(p => p.phone === phone)) {
          phoneInfoList.push({ phone, carrier, phoneType, location: '', locationState: '' });
        }
      }
    }
    
    // 如果还是没有匹配到，尝试普通电话提取
    if (phoneInfoList.length === 0) {
      const phonePattern = /(\d{3}[-.]?\d{3}[-.]?\d{4})/g;
      let phoneMatch;
      while ((phoneMatch = phonePattern.exec(text)) !== null) {
        const phone = phoneMatch[1].replace(/[-.]/, '').replace(/\D/g, '');
        if (phone.length === 10 && !phoneInfoList.some(p => p.phone === phone)) {
          phoneInfoList.push({ phone, carrier: '', phoneType: 'Unknown', location: '', locationState: '' });
        }
      }
    }
    
    // 5. 提取地址
    let currentAddress = '';
    const addressPatterns = [
      /CURRENT ADDRESS[:\s]*([^P\n]+?)(?:PREVIOUS|CONTACT|$)/i,
      /Lives in[:\s]*([^.\n]+)/i,
      /currently lives at\s+([^.\n]+)/i,
    ];
    
    for (const pattern of addressPatterns) {
      const match = text.match(pattern);
      if (match) {
        currentAddress = match[1].trim().substring(0, 200);
        break;
      }
    }
    
    // 6. 提取邮箱（包括部分隐藏的邮箱）
    const emails: string[] = [];
    const emailPattern = /([a-zA-Z0-9*._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    let emailMatch;
    while ((emailMatch = emailPattern.exec(text)) !== null) {
      const email = emailMatch[1].toLowerCase().replace(/\*/g, '*');
      if (!emails.includes(email) && !email.includes('anywho')) {
        emails.push(email);
      }
    }
    
    // 7. 提取亲属
    const familyMembers: string[] = [];
    const relativesPatterns = [
      /MAY BE RELATED TO[:\s]*([^V]+?)(?:View|Phone|Address|$)/i,
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
    
    // 8. 检查是否已故
    const deathDatePattern = /may have passed away on \d{2}\/\d{4}/i;
    const isDeceased = deathDatePattern.test(text);
    
    // 9. 智能选择主号码（优先 Mobile + 地址匹配）
    // 选择策略:
    // 1. 优先: Mobile 类型 + 与当前地址同州的号码
    // 2. 次选: 任意 Mobile 类型号码
    // 3. 备选: 与当前地址同州的任意号码
    // 4. 最后: 第一个号码
    let primaryPhone = { phone: '', carrier: '', phoneType: 'Unknown', location: '', locationState: '' };
    
    if (phoneInfoList.length > 0) {
      // 尝试找到 Mobile + 同州的号码
      const mobileAndSameState = phoneInfoList.find(p => 
        p.phoneType === 'Mobile' && p.locationState === state
      );
      
      if (mobileAndSameState) {
        primaryPhone = mobileAndSameState;
      } else {
        // 尝试找到任意 Mobile 类型
        const anyMobile = phoneInfoList.find(p => p.phoneType === 'Mobile');
        
        if (anyMobile) {
          primaryPhone = anyMobile;
        } else {
          // 尝试找到同州的任意号码
          const sameState = phoneInfoList.find(p => p.locationState === state);
          
          if (sameState) {
            primaryPhone = sameState;
          } else {
            // 使用第一个号码
            primaryPhone = phoneInfoList[0];
          }
        }
      }
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
      phone: primaryPhone.phone,
      phoneType: primaryPhone.phoneType,
      carrier: primaryPhone.carrier,
      allPhones: phoneInfoList.map(p => p.phone),
      reportYear: new Date().getFullYear(),
      isPrimary: true,
      propertyValue: 0,
      yearBuilt: null,
      marriageStatus,
      marriageRecords: [],
      familyMembers,
      employment: [],
      isDeceased,
      currentAddress,
      emails: emails.slice(0, 5),
    };
  } catch (error) {
    console.error('[Anywho] 解析详情页失败:', error);
    return null;
  }
}

/**
 * 仅搜索（不获取详情）- 增强版
 * 直接从搜索结果页提取完整数据
 */
export async function searchOnly(
  name: string,
  location: string | undefined,
  maxPages: number,
  token: string,
  ageRanges: AnywhoAgeRange[] = ['31-60', '61-80'],
  onProgress?: (page: number, results: AnywhoSearchResult[]) => void
): Promise<{
  results: AnywhoSearchResult[];
  pagesSearched: number;
  ageRangesSearched: number;
  /** Scrape.do API 积分耗尽标志 */
  apiCreditsExhausted?: boolean;
}> {
  console.log(`[Anywho] 开始双年龄搜索: ${name}, 地点: ${location || '全国'}, 最大页数: ${maxPages}, 年龄段: ${ageRanges.join(', ')}`);
  
  const allResults: AnywhoSearchResult[] = [];
  let totalPagesSearched = 0;
  let ageRangesSearched = 0;
  
  // 遍历每个年龄段
  for (const ageRange of ageRanges) {
    console.log(`[Anywho] 开始搜索年龄段: ${ageRange}`);
    ageRangesSearched++;
    
    for (let page = 1; page <= Math.min(maxPages, ANYWHO_CONFIG.MAX_PAGES); page++) {
      const searchUrl = buildSearchUrl(name, location, page, ageRange);
      console.log(`[Anywho] 抓取 [${ageRange}] 第 ${page} 页: ${searchUrl}`);
      
      let html: string | null = null;
      try {
        html = await scrapeUrl(searchUrl, token, { 
          render: true,
          useSuper: true,
          customWait: 3000,
          waitSelector: 'a[href*="/people/"]'
        });
      } catch (error: any) {
        if (error instanceof ScrapeApiCreditsError) {
          console.error(`[Anywho] Scrape.do API 积分已耗尽，停止搜索`);
          totalPagesSearched++;
          // 返回已获取的结果，并标记 API 积分耗尽
          const uniqueResults = allResults.filter((result, index, self) =>
            index === self.findIndex(r => r.detailLink === result.detailLink)
          );
          return {
            results: uniqueResults,
            pagesSearched: totalPagesSearched,
            ageRangesSearched,
            apiCreditsExhausted: true,
          };
        }
        // 其他错误当作普通失败处理
        html = null;
      }
      
      // API 已调用，计入请求数
      totalPagesSearched++;
      
      if (!html) {
        console.error(`[Anywho] [${ageRange}] 第 ${page} 页抓取失败`);
        break;
      }
      
      const pageResults = parseSearchResults(html);
      console.log(`[Anywho] [${ageRange}] 第 ${page} 页找到 ${pageResults.length} 个有效结果`);
      
      if (pageResults.length === 0) {
        console.log(`[Anywho] [${ageRange}] 第 ${page} 页无结果，停止该年龄段搜索`);
        break;
      }
      
      allResults.push(...pageResults);
      
      if (onProgress) {
        onProgress(page, pageResults);
      }
      
      if (page < maxPages) {
        await new Promise(resolve => setTimeout(resolve, ANYWHO_CONFIG.BATCH_DELAY));
      }
    }
    
    console.log(`[Anywho] 年龄段 ${ageRange} 搜索完成，累计 ${allResults.length} 条结果`);
  }
  
  // 去重
  const uniqueResults = allResults.filter((result, index, self) =>
    index === self.findIndex(r => r.detailLink === result.detailLink)
  );
  
  console.log(`[Anywho] 双年龄搜索完成: 共 ${uniqueResults.length} 个唯一结果, 搜索了 ${totalPagesSearched} 页, ${ageRangesSearched} 个年龄段`);
  
  return {
    results: uniqueResults,
    pagesSearched: totalPagesSearched,
    ageRangesSearched,
  };
}

/**
 * 批量获取详情 - 新版本
 * 直接使用搜索结果数据，不再访问详情页
 */
export async function fetchDetailsInBatch(
  tasks: DetailTask[],
  token: string,
  filters: AnywhoFilters,
  searchResults: AnywhoSearchResult[],
  onDetailFetched?: (task: DetailTask, detail: AnywhoDetailResult | null) => void,
  onProgress?: (completed: number, total: number) => void
): Promise<{
  results: Array<{
    task: DetailTask;
    detail: AnywhoDetailResult | null;
  }>;
  requestCount: number;
}> {
  console.log(`[Anywho] 开始处理详情: ${tasks.length} 个任务 (使用搜索结果数据)`);
  
  const searchResultMap = new Map<string, AnywhoSearchResult>();
  for (const result of searchResults) {
    searchResultMap.set(result.detailLink, result);
  }
  
  const results: Array<{
    task: DetailTask;
    detail: AnywhoDetailResult | null;
  }> = [];
  
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const searchResult = searchResultMap.get(task.detailLink);
    
    if (searchResult) {
      const detail = convertSearchResultToDetail(searchResult);
      
      let passFilter = true;
      
      if (filters.minAge && detail.age && detail.age < filters.minAge) {
        passFilter = false;
      }
      if (filters.maxAge && detail.age && detail.age > filters.maxAge) {
        passFilter = false;
      }
      
      results.push({ task, detail: passFilter ? detail : null });
      
      if (onDetailFetched) {
        onDetailFetched(task, passFilter ? detail : null);
      }
    } else {
      results.push({ task, detail: null });
      
      if (onDetailFetched) {
        onDetailFetched(task, null);
      }
    }
    
    if (onProgress) {
      onProgress(i + 1, tasks.length);
    }
  }
  
  console.log(`[Anywho] 详情处理完成: ${results.filter(r => r.detail !== null).length}/${tasks.length} 成功`);
  
  return {
    results,
    requestCount: 0,
  };
}

/**
 * 从详情页获取完整信息（运营商、电话类型、婚姻状况）
 * 混合模式：搜索页基本信息 + 详情页完整信息
 */
export async function fetchDetailFromPage(
  detailLink: string,
  token: string,
  searchResult: AnywhoSearchResult,
  onLog?: (message: string) => void
): Promise<{
  detail: AnywhoDetailResult | null;
  success: boolean;
}> {
  // 内部日志，不向用户显示
  const internalLog = (msg: string) => {
    console.log(msg);
  };
  
  try {
    const fullUrl = detailLink.startsWith('http') 
      ? detailLink 
      : `${ANYWHO_CONFIG.BASE_URL}${detailLink}`;
    
    internalLog(`[Anywho] 抓取详情页: ${fullUrl}`);
    
    const html = await scrapeUrl(fullUrl, token, {
      render: true,
      useSuper: true,
      customWait: 3000,
    });
    
    if (!html) {
      internalLog(`[Anywho] 详情页抓取失败`);
      // 如果详情页抓取失败，返回搜索结果转换的基本信息
      return {
        detail: convertSearchResultToDetail(searchResult),
        success: false,
      };
    }
    
    // 解析详情页
    const detailFromPage = parseDetailPage(html);
    
    if (!detailFromPage) {
      internalLog(`[Anywho] 详情页解析失败`);
      return {
        detail: convertSearchResultToDetail(searchResult),
        success: false,
      };
    }
    
    // 合并搜索结果和详情页的信息
    // 优先使用详情页的信息，但保留搜索结果中的某些字段
    const mergedDetail: AnywhoDetailResult = {
      ...convertSearchResultToDetail(searchResult),
      // 从详情页覆盖的字段
      carrier: detailFromPage.carrier || '',
      phoneType: detailFromPage.phoneType || 'Unknown',
      marriageStatus: detailFromPage.marriageStatus,
      isDeceased: detailFromPage.isDeceased,
      allPhones: detailFromPage.allPhones || [searchResult.phones?.[0] || ''],
    };
    
    internalLog(`[Anywho] 详情页解析成功: 运营商=${mergedDetail.carrier}, 类型=${mergedDetail.phoneType}, 婚姻=${mergedDetail.marriageStatus}`);
    
    return {
      detail: mergedDetail,
      success: true,
    };
  } catch (error: any) {
    // API 积分耗尽错误向上传播，不吞掉
    if (error instanceof ScrapeApiCreditsError) {
      throw error;
    }
    console.error(`[Anywho] 获取详情页失败:`, error);
    return {
      detail: convertSearchResultToDetail(searchResult),
      success: false,
    };
  }
}

/**
 * 批量获取详情页信息 - 混合模式
 * 对筛选后的搜索结果批量访问详情页，获取完整信息
 */
export async function fetchDetailsFromPages(
  searchResults: AnywhoSearchResult[],
  token: string,
  concurrency: number = 3,
  onProgress?: (completed: number, total: number, current: AnywhoDetailResult | null) => void,
  onLog?: (message: string) => void
): Promise<{
  details: AnywhoDetailResult[];
  requestCount: number;
  successCount: number;
}> {
  // 内部日志，不向用户显示
  const internalLog = (msg: string) => {
    console.log(msg);
  };
  
  internalLog(`[Anywho] 开始批量获取详情页: ${searchResults.length} 个结果, 并发数: ${concurrency}`);
  
  const details: AnywhoDetailResult[] = [];
  let requestCount = 0;
  let successCount = 0;
  
  // 分批处理，控制并发
  for (let i = 0; i < searchResults.length; i += concurrency) {
    const batch = searchResults.slice(i, i + concurrency);
    
    const batchPromises = batch.map(async (result) => {
      requestCount++;
      const { detail, success } = await fetchDetailFromPage(
        result.detailLink,
        token,
        result,
        onLog
      );
      
      if (success) {
        successCount++;
      }
      
      return detail;
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    for (const detail of batchResults) {
      if (detail) {
        details.push(detail);
        if (onProgress) {
          onProgress(details.length, searchResults.length, detail);
        }
      }
    }
    
    // 批次间延迟，避免请求过快
    if (i + concurrency < searchResults.length) {
      await new Promise(resolve => setTimeout(resolve, ANYWHO_CONFIG.BATCH_DELAY));
    }
  }
  
  internalLog(`[Anywho] 详情页获取完成: ${successCount}/${requestCount} 成功`);
  
  return {
    details,
    requestCount,
    successCount,
  };
}

/**
 * 完整搜索流程（搜索 + 转换详情）- 新版本
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
  // 根据过滤条件确定需要搜索的年龄段
  const minAge = filters.minAge || 50;
  const maxAge = filters.maxAge || 79;
  const ageRanges = determineAgeRanges(minAge, maxAge);
  
  const { results: searchResults, pagesSearched, ageRangesSearched } = await searchOnly(
    name,
    location,
    maxPages,
    token,
    ageRanges,
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
  
  const detailResults: AnywhoDetailResult[] = [];
  
  for (let i = 0; i < searchResults.length; i++) {
    const searchResult = searchResults[i];
    const detail = convertSearchResultToDetail(searchResult);
    
    let passFilter = true;
    
    if (filters.minAge && detail.age && detail.age < filters.minAge) {
      passFilter = false;
    }
    if (filters.maxAge && detail.age && detail.age > filters.maxAge) {
      passFilter = false;
    }
    
    if (passFilter) {
      detailResults.push(detail);
    }
    
    if (onDetailProgress) {
      onDetailProgress(i + 1, searchResults.length);
    }
  }
  
  return {
    searchResults,
    detailResults,
    pagesSearched,
    requestCount: pagesSearched,
  };
}
