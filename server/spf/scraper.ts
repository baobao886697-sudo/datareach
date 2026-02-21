/**
 * SearchPeopleFree (SPF) 网页抓取模块
 * 
 * v2.0 - 参考 TPS 优化版本
 * 
 * 数据亮点：
 * - 电子邮件信息
 * - 电话类型标注 (座机/手机)
 * - 婚姻状态和配偶信息
 * - 就业状态
 * - 教育信息
 * - 数据确认日期
 * - 地理坐标
 * 
 * 优化特性：
 * - 两阶段并发执行：先并发获取所有分页，再并发获取所有详情
 * - 详情页缓存机制：避免重复获取相同详情
 * - 预扣费机制：按最大消耗预扣，完成后退还
 * - 无 maxResults 限制：获取所有可用数据
 * 
 * 重要说明：
 * 根据 Scrape.do 技术支持建议，SearchPeopleFree 使用 super=true + geoCode=us
 * 搜索页面和详情页面都可以成功访问
 */

import * as cheerio from 'cheerio';
import { globalHttpSemaphore } from '../tps/httpSemaphore';

// ==================== 全局并发限制 ====================

// 导入运行时配置模块
import { getSpfRuntimeConfig, SpfRuntimeConfig } from './runtimeConfig';
import { SCRAPEDO_CONFIG } from './config';

// ==================== 全局并发控制 ====================
// v3.0 - 移除全局信号量，改用分批+延迟模式控制并发（与 TPS v8.0 一致）
// 保留导出函数以避免编译错误（如果有外部引用）
export function getGlobalConcurrencyStatus() {
  return { current: 0, max: 0, waiting: 0 };
}

export function updateGlobalConcurrency(newMax: number): void {
  // 已废弃，并发现由分批模式控制
}

// ==================== Scrape.do API ====================

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

// 默认配置值（可通过数据库配置覆盖）
const DEFAULT_SCRAPE_TIMEOUT_MS = SCRAPEDO_CONFIG.TIMEOUT_MS;   // 60 秒超时
const DEFAULT_SCRAPE_MAX_RETRIES = SCRAPEDO_CONFIG.MAX_RETRIES; // 最多重试 3 次

/**
 * 使用 Scrape.do API 获取页面（带超时和重试）
 * 
 * 关键参数说明 (根据 Scrape.do 技术支持建议):
 * - super=true: 使用住宅代理，提高成功率
 * - geoCode=us: 使用美国 IP
 * - 不使用 render=true: SearchPeopleFree 不支持渲染模式
 * 
 * v2.0 - 支持动态配置
 * - 超时和重试参数可通过数据库配置覆盖
 * - 默认使用 SCRAPEDO_CONFIG 中的值
 */
async function fetchWithScrapedo(
  url: string, 
  token: string,
  configOverride?: { timeoutMs?: number; maxRetries?: number }
): Promise<string> {
  // 使用配置覆盖或默认值
  const timeoutMs = configOverride?.timeoutMs || DEFAULT_SCRAPE_TIMEOUT_MS;
  const maxRetries = configOverride?.maxRetries || DEFAULT_SCRAPE_MAX_RETRIES;
  
  const encodedUrl = encodeURIComponent(url);
  // 注意：不使用 timeout 和 disableRetry 参数，让 scrape.do 使用默认配置（之前成功的配置）
  const apiUrl = `https://api.scrape.do/?token=${token}&url=${encodedUrl}&super=true&geoCode=us`;
  
  let lastError: Error | null = null;
  
  // v3.0 - 移除全局信号量，并发由分批模式控制
  {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        
        // ⭐ 全局HTTP并发信号量保护
        // 注意：setTimeout必须在acquire()之后启动，避免在排队等待期间就超时
        await globalHttpSemaphore.acquire();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs + 15000); // 客户端超时比 API 超时多 15 秒
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
        
        // 检查是否是可重试的服务器错误 (502, 503, 504)
        if (!response.ok) {
          // 401/403: API 积分耗尽或认证失败，不可重试
          if (response.status === 401 || response.status === 403) {
            throw new ScrapeApiCreditsError(
              `Scrape.do API 积分已耗尽或认证失败: HTTP ${response.status} ${response.statusText}`,
              response.status
            );
          }
          
          const isRetryableError = [502, 503, 504].includes(response.status);
          if (isRetryableError && attempt < maxRetries) {
            console.log(`[SPF fetchWithScrapedo] 服务器错误 ${response.status}，正在重试 (${attempt + 1}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
            continue;
          }
          throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
        }
        
        const text = await response.text();
        
        // 检查响应是否是 JSON 错误（scrape.do 有时返回 200 但内容是 JSON 错误）
        if (text.startsWith('{') && text.includes('"StatusCode"')) {
          try {
            const jsonError = JSON.parse(text);
            const statusCode = jsonError.StatusCode || 0;
            const isRetryableError = [502, 503, 504].includes(statusCode);
            
            if (isRetryableError && attempt < maxRetries) {
              console.log(`[SPF fetchWithScrapedo] API 返回 JSON 错误 (StatusCode: ${statusCode})，正在重试 (${attempt + 1}/${maxRetries})...`);
              await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
              continue;
            }
            
            const errorMsg = Array.isArray(jsonError.Message) ? jsonError.Message.join(', ') : (jsonError.Message || 'Unknown error');
            throw new Error(`API 返回错误: StatusCode ${statusCode} - ${errorMsg}`);
          } catch (parseError: any) {
            // 如果不是有效的 JSON 或已经是我们的错误，重新抛出
            if (parseError.message?.includes('API 返回错误')) {
              throw parseError;
            }
          }
        }
        
        // 检查响应是否是有效的 HTML
        const trimmedText = text.trim();
        if (!trimmedText.startsWith('<') && !trimmedText.startsWith('<!DOCTYPE')) {
          if (attempt < maxRetries) {
            console.log(`[SPF fetchWithScrapedo] 响应不是有效的 HTML，正在重试 (${attempt + 1}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
            continue;
          }
          throw new Error('API 返回的不是有效的 HTML');
        }
        
        return text;
      } catch (error: any) {
        lastError = error;
        
        // API 积分耗尽错误不重试，直接抛出
        if (error instanceof ScrapeApiCreditsError) {
          throw error;
        }
        
        if (attempt >= maxRetries) {
          break;
        }
        
        const isTimeout = error.name === 'AbortError' || error.message?.includes('timeout');
        const isNetworkError = error.message?.includes('fetch') || error.message?.includes('network');
        const isServerError = error.message?.includes('502') || error.message?.includes('503') || error.message?.includes('504');
        
        if (isTimeout || isNetworkError || isServerError) {
          console.log(`[SPF fetchWithScrapedo] 请求失败 (${error.message})，正在重试 (${attempt + 1}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError || new Error('请求失败');
  }
}

// ==================== 配置常量 ====================

// 从统一配置文件导入（基于 Scrape.do 官方最佳实践）
// 注意：SCRAPEDO_CONFIG 已在文件顶部导入
import { SPF_CONFIG, THREAD_POOL_CONFIG, SPF_SEARCH_CONFIG, isThreadPoolEnabled } from './config';

// 重新导出配置供其他模块使用
export { SPF_CONFIG, THREAD_POOL_CONFIG, SPF_SEARCH_CONFIG, SCRAPEDO_CONFIG, isThreadPoolEnabled };

// ==================== 类型定义 ====================

export interface SpfSearchResult {
  name: string;
  age?: number;
  location: string;
  detailLink: string;
  isDeceased?: boolean;
}

export interface SpfDetailResult {
  name: string;
  firstName?: string;
  lastName?: string;
  age?: number;
  birthYear?: string;
  city?: string;
  state?: string;
  location?: string;
  phone?: string;
  phoneType?: string;
  carrier?: string;
  allPhones?: Array<{ number: string; type: string; year?: number; date?: string }>;
  phoneYear?: number;
  reportYear?: number;
  isPrimary?: boolean;
  email?: string;
  allEmails?: string[];
  maritalStatus?: string;
  spouseName?: string;
  spouseLink?: string;
  employment?: string;
  education?: string;
  confirmedDate?: string;
  latitude?: number;
  longitude?: number;
  familyMembers?: string[];
  associates?: string[];
  businesses?: string[];
  propertyValue?: number;
  yearBuilt?: number;
  isDeceased?: boolean;
  detailLink?: string;
  fromCache?: boolean;
  addresses?: string[];
  currentAddress?: string;
  alsoKnownAs?: string[];
  // 详情页特有字段
  addressCount?: number;
  phoneCount?: number;
  emailCount?: number;
  akaCount?: number;
  familyCount?: number;
  associateCount?: number;
  businessCount?: number;
  // 搜索信息
  searchName?: string;
  searchLocation?: string;
}

export interface SpfFilters {
  minAge?: number;
  maxAge?: number;
  minYear?: number;
  minPropertyValue?: number;
  excludeTMobile?: boolean;
  excludeComcast?: boolean;
  excludeLandline?: boolean;
  excludeWireless?: boolean;
}

export interface DetailTask {
  detailLink: string;
  searchName: string;
  searchLocation: string;
  searchResult: SpfDetailResult;
  subTaskIndex: number;
}

// ==================== 辅助函数 ====================

/**
 * 构建搜索 URL
 * 
 * 使用查询参数格式（类似 TPS），支持所有地点输入格式：
 * - 城市 (如 "Phoenix")
 * - 州 (如 "Texas")
 * - 城市+州 (如 "Phoenix, AZ")
 * 
 * 测试验证：
 * - 路径格式 /find/john-smith/texas 会返回 502 错误
 * - 查询参数格式 /results?name=john+smith&citystatezip=texas 成功
 */
function buildSearchUrl(name: string, location: string): string {
  const baseUrl = 'https://www.searchpeoplefree.com/results';
  const params = new URLSearchParams();
  
  // 姓名参数
  params.set('name', name.trim());
  
  // 地点参数（可选）
  if (location && location.trim()) {
    params.set('citystatezip', location.trim());
  }
  
  return `${baseUrl}?${params.toString()}`;
}

/**
 * 详情链接去重
 */
function deduplicateByDetailLink(results: SpfDetailResult[]): SpfDetailResult[] {
  const seenLinks = new Set<string>();
  const uniqueResults: SpfDetailResult[] = [];
  for (const result of results) {
    if (result.detailLink && !seenLinks.has(result.detailLink)) {
      seenLinks.add(result.detailLink);
      uniqueResults.push(result);
    }
  }
  return uniqueResults;
}

/**
 * 解析年龄和出生年份
 */
function parseAgeAndBirthYear(text: string): { age?: number; birthYear?: string } {
  const result: { age?: number; birthYear?: string } = {};
  
  const ageMatch = text.match(/(?:Age\s*)?(\d+)/i);
  if (ageMatch) {
    result.age = parseInt(ageMatch[1], 10);
  }
  
  const birthYearMatch = text.match(/\(([^)]+)\)/);
  if (birthYearMatch) {
    result.birthYear = birthYearMatch[1].trim();
  }
  
  return result;
}

/**
 * 格式化电话号码为标准格式
 */
function formatPhoneNumber(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits;
  }
  return digits;
}

/**
 * 解析电话类型
 */
function parsePhoneType(typeText: string): string {
  const typeLower = typeText.toLowerCase();
  if (typeLower.includes('wireless') || typeLower.includes('mobile') || typeLower.includes('cell')) {
    return 'Wireless';
  } else if (typeLower.includes('landline') || typeLower.includes('home') || typeLower.includes('land')) {
    return 'Landline';
  } else if (typeLower.includes('voip')) {
    return 'VoIP';
  }
  return 'Unknown';
}

/**
 * 解码 Cloudflare 邮箱保护
 */
function decodeCloudflareEmail(encoded: string): string {
  if (!encoded) return '';
  
  try {
    const r = parseInt(encoded.substr(0, 2), 16);
    let email = '';
    for (let n = 2; encoded.length - n; n += 2) {
      const charCode = parseInt(encoded.substr(n, 2), 16) ^ r;
      email += String.fromCharCode(charCode);
    }
    return email;
  } catch (e) {
    return '';
  }
}

/**
 * 应用过滤器检查详情是否符合条件
 */
function applyFilters(detail: SpfDetailResult, filters: SpfFilters): boolean {
  if (filters.minAge && detail.age && detail.age < filters.minAge) {
    return false;
  }
  
  if (filters.maxAge && detail.age && detail.age > filters.maxAge) {
    return false;
  }
  
  if (filters.excludeLandline && detail.phoneType === 'Landline') {
    return false;
  }
  
  if (filters.excludeWireless && detail.phoneType === 'Wireless') {
    return false;
  }
  
  // 运营商过滤 - 检查 carrier 字段是否包含指定运营商
  if (filters.excludeTMobile && detail.carrier) {
    const carrierLower = detail.carrier.toLowerCase();
    if (carrierLower.includes('t-mobile') || carrierLower.includes('tmobile')) {
      return false;
    }
  }
  
  if (filters.excludeComcast && detail.carrier) {
    const carrierLower = detail.carrier.toLowerCase();
    if (carrierLower.includes('comcast') || carrierLower.includes('xfinity')) {
      return false;
    }
  }
  
  return true;
}

// ==================== 搜索页面解析 ====================

/**
 * 从搜索页面提取完整的详细信息
 * 
 * 基于实际 HTML 结构重写：
 * - 姓名：h2 > a（第一个文本节点）
 * - 位置：h2 > a > span（第一个 span，如 "in Brook Park, OH"）
 * - 年龄：h3 > span（数字）
 * - 出生年份：h3 > span > i.text-muted（如 "(1976 or 1975)"）
 * - 地址：ul.inline.current.row > li > address > a 或 ul.inline.current.row > li > a
 * - 电话：ul.inline.current.row > li > h4 > a 或 ul.inline.current.row > li > a
 * - 电话类型：i.text-highlight（如 "- Wireless"）
 * - 详情链接：h2 > a[href]
 */
export function parseSearchPageFull(html: string): SpfDetailResult[] {
  const $ = cheerio.load(html);
  const results: SpfDetailResult[] = [];
  
  // 遍历每个搜索结果
  $('li.toc.l-i.mb-5').each((_, liEl) => {
    const li = $(liEl);
    const article = li.find('article').first();
    
    if (!article.length) return;
    
    const result: SpfDetailResult = {
      name: '',
      allPhones: [],
      allEmails: [],
      familyMembers: [],
      associates: [],
      businesses: [],
      addresses: [],
      alsoKnownAs: [],
    };
    
    // 1. 提取姓名和详情链接
    // 结构: <h2 class="h2"><a href="...">John Smith<span>in Brook Park, OH</span></a></h2>
    const nameLink = article.find('h2 > a').first();
    if (nameLink.length) {
      // 获取详情链接
      result.detailLink = nameLink.attr('href') || '';
      
      // 获取姓名（排除 span 内的文本）
      const nameClone = nameLink.clone();
      nameClone.find('span').remove();
      result.name = nameClone.text().trim();
      
      // 分离名和姓
      const nameParts = result.name.split(' ').filter(p => p);
      if (nameParts.length >= 2) {
        result.firstName = nameParts[0];
        result.lastName = nameParts[nameParts.length - 1];
      }
      
      // 获取位置（从 span 中提取）
      const locationSpan = nameLink.find('span').first();
      if (locationSpan.length) {
        const locationText = locationSpan.text().trim();
        // 格式: "in Brook Park, OH"
        const locationMatch = locationText.match(/in\s+(.+)/i);
        if (locationMatch) {
          result.location = locationMatch[1].trim();
          
          // 解析城市和州
          const parts = result.location.split(',').map(p => p.trim());
          if (parts.length >= 2) {
            result.city = parts[0];
            result.state = parts[1];
          }
        }
      }
    }
    
    // 2. 提取年龄和出生年份
    // 结构: <h3 class="mb-3">Age <span>50<i class="text-muted">(1976 or 1975)</i></span></h3>
    const ageH3 = article.find('h3').first();
    if (ageH3.length && ageH3.text().includes('Age')) {
      const ageSpan = ageH3.find('span').first();
      if (ageSpan.length) {
        // 获取年龄数字
        const ageClone = ageSpan.clone();
        ageClone.find('i').remove();
        const ageText = ageClone.text().trim();
        const ageNum = parseInt(ageText, 10);
        if (!isNaN(ageNum)) {
          result.age = ageNum;
        }
        
        // 获取出生年份
        const birthYearEl = ageSpan.find('i.text-muted').first();
        if (birthYearEl.length) {
          const birthYearText = birthYearEl.text().trim();
          // 格式: "(1976 or 1975)"
          const yearMatch = birthYearText.match(/\((\d{4})/);
          if (yearMatch) {
            result.birthYear = yearMatch[1];
          }
        }
      }
    }
    
    // 3. 提取地址和电话（从 ul.inline.current.row 中）
    article.find('ul.inline.current.row, ul.inline.row').each((_, ulEl) => {
      const ul = $(ulEl);
      const prevText = ul.prev('i.text-muted').text().toLowerCase();
      
      // 判断是地址列表还是电话列表
      if (prevText.includes('address') || prevText.includes('home address')) {
        // 这是地址列表
        ul.find('li').each((_, liEl) => {
          const liItem = $(liEl);
          const addressEl = liItem.find('address a, a').first();
          if (addressEl.length) {
            const address = addressEl.text().trim();
            if (address && result.addresses && !result.addresses.includes(address)) {
              result.addresses.push(address);
              
              // 第一个地址作为当前地址
              if (!result.currentAddress) {
                result.currentAddress = address;
                
                // 解析城市和州（如果还没有）
                if (!result.city || !result.state) {
                  const parts = address.split(',').map(p => p.trim());
                  if (parts.length >= 3) {
                    result.city = parts[parts.length - 2];
                    const stateZip = parts[parts.length - 1];
                    const stateMatch = stateZip.match(/^([A-Z]{2})/);
                    if (stateMatch) {
                      result.state = stateMatch[1];
                    }
                  }
                }
              }
            }
          }
        });
      } else if (prevText.includes('phone') || prevText.includes('telephone')) {
        // 这是电话列表
        ul.find('li').each((_, liEl) => {
          const liItem = $(liEl);
          const phoneLink = liItem.find('h4 a, a').first();
          if (phoneLink.length) {
            const phoneText = phoneLink.text().trim();
            const phoneNumber = formatPhoneNumber(phoneText);
            
            if (phoneNumber) {
              // 获取电话类型
              const typeEl = liItem.find('i.text-highlight').first();
              let phoneType = 'Unknown';
              if (typeEl.length) {
                const typeText = typeEl.text().toLowerCase();
                // 格式: "- Wireless" 或 "- LandLine"
                if (typeText.includes('wireless') || typeText.includes('mobile') || typeText.includes('cell')) {
                  phoneType = 'Wireless';
                } else if (typeText.includes('landline') || typeText.includes('land')) {
                  phoneType = 'Landline';
                } else if (typeText.includes('voip')) {
                  phoneType = 'VoIP';
                }
              }
              
              // 检查是否是当前号码
              const isCurrent = liItem.find('i.text-highlight').text().toLowerCase().includes('current');
              
              if (result.allPhones && !result.allPhones.some(p => p.number === phoneNumber)) {
                result.allPhones.push({
                  number: phoneNumber,
                  type: phoneType,
                  year: isCurrent ? new Date().getFullYear() : undefined,
                });
              }
            }
          }
        });
      } else if (prevText.includes('spouse') || prevText.includes('family') || prevText.includes('mother') || prevText.includes('father') || prevText.includes('sister') || prevText.includes('brother')) {
        // 这是家庭成员列表
        ul.find('li a').each((_, aEl) => {
          const member = $(aEl).text().trim();
          if (member && result.familyMembers && !result.familyMembers.includes(member)) {
            result.familyMembers.push(member);
          }
        });
      }
    });
    
    // 设置主电话
    if (result.allPhones && result.allPhones.length > 0) {
      const primaryPhone = result.allPhones[0];
      result.phone = primaryPhone.number;
      result.phoneType = primaryPhone.type;
      result.phoneYear = primaryPhone.year;
    }
    
    // 设置位置（如果还没有）
    if (!result.location && result.city && result.state) {
      result.location = `${result.city}, ${result.state}`;
    }
    
    // 检查是否已故
    const isDeceased = li.text().toLowerCase().includes('deceased');
    result.isDeceased = isDeceased;
    
    // 只添加有姓名的结果
    if (result.name) {
      results.push(result);
    }
  });
  
  return results;
}

/**
 * 提取下一页 URL
 */
function extractNextPageUrl(html: string): string | null {
  const $ = cheerio.load(html);
  
  // 查找 "Next Page" 链接
  const nextLink = $('a:contains("Next Page"), a:contains("Next"), a.next-page, a[rel="next"]').first();
  if (nextLink.length) {
    const href = nextLink.attr('href');
    if (href) {
      return href.startsWith('http') ? href : `https://www.searchpeoplefree.com${href}`;
    }
  }
  
  // 查找分页链接
  const paginationLinks = $('nav.pagination a, div.pagination a, ul.pagination a');
  let maxPage = 0;
  let nextPageUrl: string | null = null;
  
  paginationLinks.each((_, el) => {
    const href = $(el).attr('href') || '';
    const pageMatch = href.match(/p-(\d+)/);
    if (pageMatch) {
      const pageNum = parseInt(pageMatch[1], 10);
      if (pageNum > maxPage) {
        maxPage = pageNum;
        nextPageUrl = href.startsWith('http') ? href : `https://www.searchpeoplefree.com${href}`;
      }
    }
  });
  
  return nextPageUrl;
}

// ==================== 详情页面解析 ====================

/**
 * 解析详情页面 - 修复版 v2.0
 * 
 * 修复内容：
 * 1. 姓名选择器：h1.highlight-letter 或 h1 (格式: "John Smith living in Brook Park, OH")
 * 2. 年龄选择器：从 article.current-bg 内的文本中提取
 * 3. 配偶选择器：从 article.current-bg 或 article.family-bg 中提取
 * 4. 电话选择器：article.phone-bg 内的 a 标签
 * 5. 邮箱选择器：article.email-bg 内的 [data-cfemail] 属性
 */
export function parseDetailPage(html: string, detailLink: string): SpfDetailResult | null {
  try {
    const $ = cheerio.load(html);
    
    const result: SpfDetailResult = {
      name: '',
      allPhones: [],
      allEmails: [],
      familyMembers: [],
      associates: [],
      businesses: [],
      addresses: [],
      alsoKnownAs: [],
      detailLink,
    };
    
    // 1. 提取姓名 - 从 h1.highlight-letter 或 h1
    // 格式: "John Smith living in Brook Park, OH"
    const h1El = $('h1.highlight-letter, h1').first();
    if (h1El.length) {
      const h1Text = h1El.text().trim();
      
      if (h1Text.includes(' living in ')) {
        const parts = h1Text.split(' living in ');
        result.name = parts[0].trim();
        result.location = parts[1].trim();
        
        // 解析城市和州
        if (result.location.includes(',')) {
          const lastCommaIndex = result.location.lastIndexOf(',');
          result.city = result.location.substring(0, lastCommaIndex).trim();
          result.state = result.location.substring(lastCommaIndex + 1).trim();
        }
      } else {
        result.name = h1Text;
      }
      
      // 分离名和姓
      const nameParts = result.name.split(' ');
      if (nameParts.length >= 2) {
        result.firstName = nameParts[0];
        result.lastName = nameParts[nameParts.length - 1];
      }
    }
    
    // 2. 提取年龄和配偶 - 从 article.current-bg 内的文本
    const currentBg = $('article.current-bg').first();
    if (currentBg.length) {
      const currentText = currentBg.text();
      
      // 提取年龄 - 格式: "Age 50" 或 "Age\n50"
      const ageMatch = currentText.match(/Age\s*(\d+)/);
      if (ageMatch) {
        result.age = parseInt(ageMatch[1], 10);
      }
      
      // 提取出生年份 - 格式: "(1976 or 1975)"
      const birthMatch = currentText.match(/\((\d{4})\s+or\s+\d{4}\)/);
      if (birthMatch) {
        result.birthYear = birthMatch[1];
      }
      
      // 提取配偶 - 格式: "Married to Jennifer A Smith"
      const spouseMatch = currentText.match(/Married to\s*([A-Za-z\s]+?)(?:\s*\(|$|\n|Spouse)/);
      if (spouseMatch) {
        result.maritalStatus = 'Married';
        result.spouseName = spouseMatch[1].trim();
      }
      
      // 提取地址
      currentBg.find('ol.inline li').each((_, liEl) => {
        const addr = $(liEl).text().trim();
        if (addr && result.addresses && !result.addresses.includes(addr)) {
          result.addresses.push(addr);
        }
      });
      
      result.addressCount = result.addresses?.length || 0;
    }
    
    // 3. 提取电话号码 - 从 article.phone-bg
    const phoneBg = $('article.phone-bg').first();
    if (phoneBg.length) {
      // 查找所有电话链接
      phoneBg.find('a').each((_, aEl) => {
        const phoneText = $(aEl).text().trim();
        // 格式: "(216) 333-5885"
        const phoneMatch = phoneText.match(/\((\d{3})\)\s*(\d{3})-(\d{4})/);
        if (phoneMatch) {
          const phoneNumber = '1' + phoneMatch[1] + phoneMatch[2] + phoneMatch[3];
          
          // 获取电话类型和年份 - 从父级 li 元素
          const parentLi = $(aEl).closest('li');
          let phoneType = 'Unknown';
          let phoneYear: number | undefined;
          
          if (parentLi.length) {
            const liText = parentLi.text();
            
            // 解析电话类型
            if (liText.includes('Wireless') || liText.includes('Mobile') || liText.includes('Cell')) {
              phoneType = 'Wireless';
            } else if (liText.includes('Landline') || liText.includes('Land')) {
              phoneType = 'Landline';
            } else if (liText.includes('VoIP')) {
              phoneType = 'VoIP';
            }
            
            // 解析年份
            const yearMatch = liText.match(/(20\d{2})/);
            if (yearMatch) {
              phoneYear = parseInt(yearMatch[1], 10);
            }
          }
          
          if (result.allPhones && !result.allPhones.some(p => p.number === phoneNumber)) {
            result.allPhones.push({
              number: phoneNumber,
              type: phoneType,
              year: phoneYear,
            });
          }
        }
      });
      
      // 设置主电话
      if (result.allPhones && result.allPhones.length > 0) {
        const primaryPhone = result.allPhones[0];
        result.phone = primaryPhone.number;
        result.phoneType = primaryPhone.type;
        result.phoneYear = primaryPhone.year;
      }
      
      result.phoneCount = result.allPhones?.length || 0;
    }
    
    // 4. 提取邮箱 - 从 article.email-bg
    const emailBg = $('article.email-bg').first();
    if (emailBg.length) {
      // 查找 Cloudflare 保护的邮箱
      emailBg.find('[data-cfemail]').each((_, cfEl) => {
        const encoded = $(cfEl).attr('data-cfemail');
        if (encoded) {
          const email = decodeCloudflareEmail(encoded);
          if (email && email.includes('@') && result.allEmails && !result.allEmails.includes(email)) {
            result.allEmails.push(email);
          }
        }
      });
      
      // 也尝试直接获取邮箱文本
      emailBg.find('a').each((_, aEl) => {
        const emailText = $(aEl).text().trim();
        if (emailText && emailText.includes('@') && result.allEmails && !result.allEmails.includes(emailText)) {
          result.allEmails.push(emailText);
        }
      });
      
      if (result.allEmails && result.allEmails.length > 0) {
        result.email = result.allEmails[0];
      }
      
      result.emailCount = result.allEmails?.length || 0;
    }
    
    // 5. 提取家庭成员 - 从 article.family-bg
    const familyBg = $('article.family-bg').first();
    if (familyBg.length) {
      familyBg.find('a').each((_, aEl) => {
        const member = $(aEl).text().trim();
        if (member && result.familyMembers && !result.familyMembers.includes(member)) {
          result.familyMembers.push(member);
        }
      });
      result.familyCount = result.familyMembers?.length || 0;
      
      // 如果没有从 current-bg 找到配偶，尝试从 family-bg 找
      if (!result.spouseName && result.familyMembers && result.familyMembers.length > 0) {
        const familyText = familyBg.text();
        if (familyText.includes('Spouse') || familyText.includes('partner')) {
          result.spouseName = result.familyMembers[0];
          result.maritalStatus = 'Married';
        }
      }
    }
    
    // 6. 提取关联人员 - 从 article.associate-bg
    const associateBg = $('article.associate-bg').first();
    if (associateBg.length) {
      associateBg.find('a').each((_, aEl) => {
        const associate = $(aEl).text().trim();
        if (associate && result.associates && !result.associates.includes(associate)) {
          result.associates.push(associate);
        }
      });
      result.associateCount = result.associates?.length || 0;
    }
    
    // 7. 提取企业关联 - 从 article.business-bg
    const businessBg = $('article.business-bg').first();
    if (businessBg.length) {
      businessBg.find('li').each((_, liEl) => {
        const business = $(liEl).text().trim();
        if (business && result.businesses && !result.businesses.includes(business)) {
          result.businesses.push(business);
        }
      });
      result.businessCount = result.businesses?.length || 0;
    }
    
    // 8. 提取 AKA (Also Known As) - 从 article.alias-bg
    const aliasBg = $('article.alias-bg').first();
    if (aliasBg.length) {
      aliasBg.find('li').each((_, liEl) => {
        const aka = $(liEl).text().trim();
        if (aka && result.alsoKnownAs && !result.alsoKnownAs.includes(aka)) {
          result.alsoKnownAs.push(aka);
        }
      });
      result.akaCount = result.alsoKnownAs?.length || 0;
    }
    
    // 9. 提取就业信息 - 从 article.employment-bg
    const employmentBg = $('article.employment-bg').first();
    if (employmentBg.length) {
      const employmentText = employmentBg.text().trim();
      if (employmentText && !employmentText.includes('not associated')) {
        result.employment = employmentText.replace(/Employment/i, '').trim();
      }
    }
    
    // 10. 提取教育信息 - 从 article.education-bg
    const educationBg = $('article.education-bg').first();
    if (educationBg.length) {
      const educationText = educationBg.text().trim();
      if (educationText && !educationText.includes('not associated')) {
        result.education = educationText.replace(/Education/i, '').trim();
      }
    }
    
    // 11. 提取地址信息 - 从 article.address-bg
    const addressBg = $('article.address-bg').first();
    if (addressBg.length) {
      addressBg.find('li').each((_, liEl) => {
        const addr = $(liEl).text().trim();
        if (addr && result.addresses && !result.addresses.includes(addr)) {
          result.addresses.push(addr);
        }
      });
      
      // 更新地址计数
      result.addressCount = result.addresses?.length || 0;
    }
    
    // 12. 检查是否已故
    result.isDeceased = html.toLowerCase().includes('deceased');
    
    // 13. 如果还没有位置信息，尝试从地址中提取
    if (!result.location && result.addresses && result.addresses.length > 0) {
      const firstAddr = result.addresses[0];
      const parts = firstAddr.split(',').map(p => p.trim());
      if (parts.length >= 2) {
        result.city = parts[parts.length - 2];
        const stateZip = parts[parts.length - 1];
        const stateMatch = stateZip.match(/^([A-Z]{2})/);
        if (stateMatch) {
          result.state = stateMatch[1];
        }
        result.location = `${result.city}, ${result.state}`;
      }
    }
    
    return result;
    
  } catch (error) {
    console.error('[SPF parseDetailPage] 解析详情页面时出错:', error);
    return null;
  }
}

// ==================== 阶段一：搜索页面获取 ====================

/**
 * 搜索结果接口
 */
export interface SearchOnlyResult {
  success: boolean;
  searchResults: SpfDetailResult[];
  error?: string;
  /** Scrape.do API 积分耗尽标志 */
  apiCreditsExhausted?: boolean;
  stats: {
    searchPageRequests: number;
    filteredOut: number;
    skippedDeceased: number;
  };
}

/**
 * 仅执行搜索（不获取详情）
 * 
 * 获取所有分页的搜索结果，用于后续统一获取详情
 */
export async function searchOnly(
  name: string,
  location: string,
  token: string,
  maxPages: number,
  filters: SpfFilters,
  onProgress: (message: string) => void
): Promise<SearchOnlyResult> {
  let searchPageRequests = 0;
  let filteredOut = 0;
  let skippedDeceased = 0;
  const searchResults: SpfDetailResult[] = [];
  
  try {
    // 1. 构建搜索 URL
    const searchUrl = buildSearchUrl(name, location);
    
    // 2. 获取第一页
    const searchHtml = await fetchWithScrapedo(searchUrl, token);
    searchPageRequests++;
    
    // 检查是否是错误响应
    if (searchHtml.includes('"ErrorCode"') || searchHtml.includes('"StatusCode":4') || searchHtml.includes('"StatusCode":5')) {
      return {
        success: false,
        searchResults: [],
        error: 'API 返回错误',
        stats: { searchPageRequests, filteredOut, skippedDeceased },
      };
    }
    
    // 3. 检测是否直接返回详情页
    const isDetailPage = (searchHtml.includes('current-bg') || searchHtml.includes('personDetails')) && 
                         !searchHtml.includes('li class="toc l-i mb-5"');
    
    if (isDetailPage) {
      // 检测到直接返回详情页，静默处理
      const detailResult = parseDetailPage(searchHtml, searchUrl);
      if (detailResult) {
        // 检查是否已故
        if (detailResult.isDeceased) {
          skippedDeceased++;
          return {
            success: true,
            searchResults: [],
            stats: { searchPageRequests, filteredOut, skippedDeceased },
          };
        }
        
        // 应用过滤器
        if (applyFilters(detailResult, filters)) {
          searchResults.push(detailResult);
        } else {
          filteredOut++;
        }
      }
      return {
        success: true,
        searchResults,
        stats: { searchPageRequests, filteredOut, skippedDeceased },
      };
    }
    
    // 4. 分页获取所有搜索结果
    let currentPageHtml = searchHtml;
    let currentPageNum = 1;
    
    while (currentPageNum <= maxPages) {
      // 解析当前页的搜索结果
      const pageResults = parseSearchPageFull(currentPageHtml);
      // 静默处理分页结果
      
      if (pageResults.length === 0) {
        // 无结果，停止分页
        break;
      }
      
      // 过滤结果
      for (const result of pageResults) {
        // 跳过已故
        if (result.isDeceased) {
          skippedDeceased++;
          continue;
        }
        
        // 应用过滤器
        if (applyFilters(result, filters)) {
          searchResults.push(result);
        } else {
          filteredOut++;
        }
      }
      
      // 检查是否有下一页
      const nextPageUrl = extractNextPageUrl(currentPageHtml);
      if (!nextPageUrl) {
        // 已到达最后一页
        break;
      }
      
      // 获取下一页
      try {
        currentPageHtml = await fetchWithScrapedo(nextPageUrl, token);
        searchPageRequests++;
        currentPageNum++;
        
        // 检查是否是错误响应
        if (currentPageHtml.includes('"ErrorCode"') || currentPageHtml.includes('"StatusCode":4')) {
          onProgress(`第 ${currentPageNum} 页获取失败（API错误），停止分页`);
          break;
        }
        
        // 请求间延迟
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (pageError: any) {
        // API 积分耗尽错误向上传播，由外层 catch 统一处理
        if (pageError instanceof ScrapeApiCreditsError) {
          throw pageError;
        }
        onProgress(`获取第 ${currentPageNum + 1} 页失败，停止分页`);
        break;
      }
    }
    
    if (currentPageNum >= maxPages) {
      onProgress(`已达到最大分页限制 (${maxPages} 页)`);
    }
    
    return {
      success: true,
      searchResults,
      stats: { searchPageRequests, filteredOut, skippedDeceased },
    };
    
  } catch (error: any) {
    // 检查是否是 API 积分耗尽错误
    if (error instanceof ScrapeApiCreditsError) {
      onProgress(`🚫 当前使用人数过多，服务繁忙，请联系客服处理`);
      onProgress(`💡 已获取的结果已保存，如需继续请联系客服`);
      return {
        success: false,
        searchResults: [],
        error: '服务繁忙，请稍后重试',
        apiCreditsExhausted: true,
        stats: { searchPageRequests, filteredOut, skippedDeceased },
      };
    }
    
    return {
      success: false,
      searchResults: [],
      error: (error.message || '').includes('Scrape.do') ? '服务繁忙，请稍后重试' : error.message,
      stats: { searchPageRequests, filteredOut, skippedDeceased },
    };
  }
}

// ==================== 阶段二：详情页面批量获取 ====================

/**
 * 详情获取结果接口
 */
export interface FetchDetailsResult {
  results: Array<{ task: DetailTask; details: SpfDetailResult | null }>;
  stats: {
    detailPageRequests: number;
    cacheHits: number;
    filteredOut: number;
    /** Scrape.do API 积分耗尽标志 */
    apiCreditsExhausted?: boolean;
  };
}

// ==================== SPF 详情获取分批配置 ====================
const SPF_DETAIL_BATCH_CONFIG = {
  BATCH_SIZE: 15,          // 每批并发数（SPF不需要render，请求较快，15并发合理）
  BATCH_DELAY_MS: 500,     // 批间延迟(ms)
  RETRY_BATCH_SIZE: 8,     // 重试批大小
  RETRY_BATCH_DELAY_MS: 1000, // 重试批间延迟(ms)
  RETRY_WAIT_MS: 3000,     // 重试前等待(ms)
};

/**
 * 批量获取详情页面（v3.0 分批+延迟模式）
 * 
 * 借鉴 TPS v8.0 的"分批+延迟"架构：
 * - 每批 BATCH_SIZE 个请求并行发出
 * - 批间等待 BATCH_DELAY_MS
 * - 失败的链接延后统一重试
 * - 保留缓存、过滤、去重逻辑不变
 * 
 * @param tasks 详情任务列表
 * @param token Scrape.do API token
 * @param concurrency 并发数（已废弃，使用 SPF_DETAIL_BATCH_CONFIG.BATCH_SIZE 代替）
 * @param filters 过滤器
 * @param onProgress 进度回调
 * @param getCachedDetails 获取缓存函数
 * @param setCachedDetails 设置缓存函数
 */
export async function fetchDetailsInBatch(
  tasks: DetailTask[],
  token: string,
  concurrency: number,
  filters: SpfFilters,
  onProgress: (message: string) => void,
  getCachedDetails: (links: string[]) => Promise<Map<string, SpfDetailResult>>,
  setCachedDetails: (items: Array<{ link: string; data: SpfDetailResult }>) => Promise<void>,
  /** v8.2: 详情进度回调，用于实时推送指标更新 */
  onDetailProgress?: (info: { completedDetails: number; totalDetails: number; percent: number; detailPageRequests: number; totalResults: number }) => void
): Promise<FetchDetailsResult> {
  const { BATCH_SIZE, BATCH_DELAY_MS, RETRY_BATCH_SIZE, RETRY_BATCH_DELAY_MS, RETRY_WAIT_MS } = SPF_DETAIL_BATCH_CONFIG;
  
  const results: Array<{ task: DetailTask; details: SpfDetailResult | null }> = [];
  let detailPageRequests = 0;
  let cacheHits = 0;
  let filteredOut = 0;
  let apiCreditsExhausted = false;
  
  const baseUrl = 'https://www.searchpeoplefree.com';
  const uniqueLinks = Array.from(new Set(tasks.map(t => t.detailLink)));
  
  // 静默处理，不输出缓存检查日志
  const cachedMap = await getCachedDetails(uniqueLinks);
  
  // 分离缓存命中和需要获取的任务
  const tasksToFetch: DetailTask[] = [];
  const tasksByLink = new Map<string, DetailTask[]>();
  
  for (const task of tasks) {
    const link = task.detailLink;
    if (!tasksByLink.has(link)) {
      tasksByLink.set(link, []);
    }
    tasksByLink.get(link)!.push(task);
  }
  
  for (const [link, linkTasks] of Array.from(tasksByLink.entries())) {
    const cached = cachedMap.get(link);
    if (cached && cached.phone && cached.phone.length >= 10) {
      cacheHits++;
      // 标记缓存数据来源
      const cachedWithFlag = { ...cached, fromCache: true };
      
      // 应用过滤器
      if (applyFilters(cachedWithFlag, filters)) {
        for (const task of linkTasks) {
          results.push({ task, details: cachedWithFlag });
        }
      } else {
        filteredOut++;
      }
    } else {
      tasksToFetch.push(linkTasks[0]);
    }
  }
  
  const cacheToSave: Array<{ link: string; data: SpfDetailResult }> = [];
  let completed = 0;
  
  // 记录失败的任务，用于延后重试
  const failedTasks: DetailTask[] = [];
  
  if (tasksToFetch.length > 0) {
    const totalBatches = Math.ceil(tasksToFetch.length / BATCH_SIZE);
    
    // ==================== 第一轮：分批并行获取 ====================
    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const startIdx = batchIdx * BATCH_SIZE;
      const endIdx = Math.min(startIdx + BATCH_SIZE, tasksToFetch.length);
      const batchItems = tasksToFetch.slice(startIdx, endIdx);
      
      // 并行发出本批请求
      
      const batchPromises = batchItems.map(async (task) => {
        const link = task.detailLink;
        const detailUrl = link.startsWith('http') ? link : `${baseUrl}${link.startsWith('/') ? '' : '/'}${link}`;
        
        try {
          const html = await fetchWithScrapedo(detailUrl, token);
          return { task, html, error: null, isApiCreditsError: false };
        } catch (error: any) {
          const isApiCreditsError = error instanceof ScrapeApiCreditsError;
          return { task, html: null, error, isApiCreditsError };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      // 检查本批是否有 API 积分耗尽错误
      if (batchResults.some(r => r.isApiCreditsError)) {
        apiCreditsExhausted = true;
        onProgress(`🚫 当前使用人数过多，服务繁忙，请联系客服处理`);
        onProgress(`💡 已获取的结果已保存，如需继续请联系客服`);
      }
      
      // 处理本批结果
      for (const result of batchResults) {
        const { task, error, isApiCreditsError } = result;
        let html = result.html;
        // ⭐ 处理完后立即释放HTML内存
        result.html = null as any;
        const link = task.detailLink;
        
        if (error) {
          // API 积分耗尽的不加入重试队列
          if (!isApiCreditsError) {
            failedTasks.push(task);
          }
          completed++;
          // v8.2: error分支也触发进度回调
          if (onDetailProgress) {
            const validResults = results.filter(r => r.details !== null).length;
            onDetailProgress({
              completedDetails: completed,
              totalDetails: tasksToFetch.length,
              percent: Math.round((completed / tasksToFetch.length) * 100),
              detailPageRequests,
              totalResults: validResults,
            });
          }
          continue;
        }
        
        detailPageRequests++;
        
        // 检查是否是错误响应
        if (html!.includes('"ErrorCode"') || html!.includes('"StatusCode":4')) {
          const linkTasks = tasksByLink.get(link) || [task];
          for (const t of linkTasks) {
            results.push({ task: t, details: null });
          }
          completed++;
          // v8.2: ErrorCode分支也触发进度回调
          if (onDetailProgress) {
            const validResults = results.filter(r => r.details !== null).length;
            onDetailProgress({
              completedDetails: completed,
              totalDetails: tasksToFetch.length,
              percent: Math.round((completed / tasksToFetch.length) * 100),
              detailPageRequests,
              totalResults: validResults,
            });
          }
          continue;
        }
        
        const details = parseDetailPage(html!, link);
        
        if (details) {
          // 保存到缓存
          if (details.phone && details.phone.length >= 10) {
            cacheToSave.push({ link, data: details });
          }
          
          // 标记新获取的数据不是来自缓存
          const detailsWithFlag = { ...details, fromCache: false };
          
          // 应用过滤器
          if (applyFilters(detailsWithFlag, filters)) {
            const linkTasks = tasksByLink.get(link) || [task];
            for (const t of linkTasks) {
              results.push({ task: t, details: detailsWithFlag });
            }
          } else {
            filteredOut++;
          }
        } else {
          const linkTasks = tasksByLink.get(link) || [task];
          for (const t of linkTasks) {
            results.push({ task: t, details: null });
          }
        }
        
        completed++;
        
        // v8.2: 每处理完一条详情就触发进度回调
        if (onDetailProgress) {
          const validResults = results.filter(r => r.details !== null).length;
          onDetailProgress({
            completedDetails: completed,
            totalDetails: tasksToFetch.length,
            percent: Math.round((completed / tasksToFetch.length) * 100),
            detailPageRequests,
            totalResults: validResults,
          });
        }
      }
      
      // 进度报告（每5批报告一次，或最后一批）
      if ((batchIdx + 1) % 5 === 0 || batchIdx === totalBatches - 1) {
        const percent = Math.round((completed / tasksToFetch.length) * 100);
        onProgress(`📥 详情进度: ${completed}/${tasksToFetch.length} (${percent}%)`);
      }
      
      // 批间延迟
      if (batchIdx < totalBatches - 1 && !apiCreditsExhausted) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
      
      // API 积分耗尽，停止后续批次
      if (apiCreditsExhausted) {
        break;
      }
    }
    
    // ==================== 第二轮：延后重试失败的请求 ====================
    // API 积分耗尽时跳过重试
    if (failedTasks.length > 0 && !apiCreditsExhausted) {
      console.log(`[SPF] 延后重试 ${failedTasks.length} 个失败请求`);
      onProgress(`🔄 重试 ${failedTasks.length} 个失败请求...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_WAIT_MS));
      
      const retryBatches = Math.ceil(failedTasks.length / RETRY_BATCH_SIZE);
      
      for (let retryBatchIdx = 0; retryBatchIdx < retryBatches; retryBatchIdx++) {
        const retryStart = retryBatchIdx * RETRY_BATCH_SIZE;
        const retryEnd = Math.min(retryStart + RETRY_BATCH_SIZE, failedTasks.length);
        const retryItems = failedTasks.slice(retryStart, retryEnd);
        
        const retryPromises = retryItems.map(async (task) => {
          const link = task.detailLink;
          const detailUrl = link.startsWith('http') ? link : `${baseUrl}${link.startsWith('/') ? '' : '/'}${link}`;
          
          try {
            const html = await fetchWithScrapedo(detailUrl, token);
            return { task, html, error: null };
          } catch (error: any) {
            return { task, html: null, error };
          }
        });
        
        const retryResults = await Promise.all(retryPromises);
        
        for (const { task, html, error } of retryResults) {
          const link = task.detailLink;
          
          if (error) {
            const safeErrorMsg = (error.message || '').includes('Scrape.do') ? '服务繁忙' : (error.message || error);
            onProgress(`获取详情失败: ${link} - ${safeErrorMsg}`);
            const linkTasks = tasksByLink.get(link) || [task];
            for (const t of linkTasks) {
              results.push({ task: t, details: null });
            }
            continue;
          }
          
          detailPageRequests++;
          
          if (html!.includes('"ErrorCode"') || html!.includes('"StatusCode":4')) {
            const linkTasks = tasksByLink.get(link) || [task];
            for (const t of linkTasks) {
              results.push({ task: t, details: null });
            }
            continue;
          }
          
          const details = parseDetailPage(html!, link);
          
          if (details) {
            if (details.phone && details.phone.length >= 10) {
              cacheToSave.push({ link, data: details });
            }
            
            const detailsWithFlag = { ...details, fromCache: false };
            
            if (applyFilters(detailsWithFlag, filters)) {
              const linkTasks = tasksByLink.get(link) || [task];
              for (const t of linkTasks) {
                results.push({ task: t, details: detailsWithFlag });
              }
            } else {
              filteredOut++;
            }
          } else {
            const linkTasks = tasksByLink.get(link) || [task];
            for (const t of linkTasks) {
              results.push({ task: t, details: null });
            }
          }
        }
        
        // 重试批间延迟
        if (retryBatchIdx < retryBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, RETRY_BATCH_DELAY_MS));
        }
      }
    }
  }
  
  // 保存缓存
  if (cacheToSave.length > 0) {
    await setCachedDetails(cacheToSave);
  }
  
  return {
    results,
    stats: {
      detailPageRequests,
      cacheHits,
      filteredOut,
      apiCreditsExhausted,
    },
  };
}

// ==================== 兼容旧接口 ====================

/**
 * 搜索结果和 API 调用统计（兼容旧接口）
 */
export interface SearchResultWithStats {
  results: SpfDetailResult[];
  searchPageCalls: number;
  detailPageCalls: number;
}

/**
 * 执行搜索并获取详情（兼容旧接口）
 * 
 * 注意：此函数保留用于向后兼容，新代码应使用 searchOnly + fetchDetailsInBatch
 */
export async function searchAndGetDetails(
  name: string,
  location: string,
  token: string,
  filters: SpfFilters = {},
  maxResults: number = 10,
  fetchDetails: boolean = true
): Promise<SearchResultWithStats> {
  const results: SpfDetailResult[] = [];
  let searchPageCalls = 0;
  let detailPageCalls = 0;
  
  try {
    // 使用新的 searchOnly 函数
    const searchResult = await searchOnly(
      name,
      location,
      token,
      SPF_CONFIG.MAX_SAFE_PAGES,
      filters,
      (msg) => console.log(`[SPF] ${msg}`)
    );
    
    searchPageCalls = searchResult.stats.searchPageRequests;
    
    if (!searchResult.success || searchResult.searchResults.length === 0) {
      return { results, searchPageCalls, detailPageCalls };
    }
    
    // 获取详情
    if (fetchDetails) {
      for (const searchRes of searchResult.searchResults) {
        if (results.length >= maxResults) break;
        
        if (searchRes.detailLink) {
          try {
            const detailUrl = searchRes.detailLink.startsWith('http')
              ? searchRes.detailLink
              : `https://www.searchpeoplefree.com${searchRes.detailLink.startsWith('/') ? '' : '/'}${searchRes.detailLink}`;
            
            const detailHtml = await fetchWithScrapedo(detailUrl, token);
            detailPageCalls++;
            
            if (!detailHtml.includes('"ErrorCode"') && !detailHtml.includes('"StatusCode":4')) {
              const detailResult = parseDetailPage(detailHtml, searchRes.detailLink);
              
              if (detailResult) {
                const mergedResult: SpfDetailResult = {
                  ...searchRes,
                  ...detailResult,
                  name: detailResult.name || searchRes.name,
                  age: detailResult.age || searchRes.age,
                  phone: detailResult.phone || searchRes.phone,
                  phoneType: detailResult.phoneType || searchRes.phoneType,
                };
                
                if (applyFilters(mergedResult, filters)) {
                  results.push(mergedResult);
                }
                
                await new Promise(resolve => setTimeout(resolve, 500));
                continue;
              }
            }
          } catch (detailError) {
            console.error(`[SPF] 获取详情页失败: ${searchRes.detailLink}`, detailError);
          }
        }
        
        results.push(searchRes);
      }
    } else {
      results.push(...searchResult.searchResults.slice(0, maxResults));
    }
    
  } catch (error) {
    console.error(`[SPF] 搜索失败: ${name} ${location}`, error);
  }
  
  return { results, searchPageCalls, detailPageCalls };
}

/**
 * 批量搜索（兼容旧接口）
 */
export interface BatchSearchResultWithStats {
  results: SpfDetailResult[];
  totalSearchPageCalls: number;
  totalDetailPageCalls: number;
}

export async function batchSearch(
  names: string[],
  locations: string[],
  token: string,
  filters: SpfFilters = {},
  onProgress?: (completed: number, total: number) => void,
  fetchDetails: boolean = true
): Promise<BatchSearchResultWithStats> {
  const allResults: SpfDetailResult[] = [];
  let totalSearchPageCalls = 0;
  let totalDetailPageCalls = 0;
  const total = names.length;
  let completed = 0;
  
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const location = locations[i] || '';
    
    try {
      const { results, searchPageCalls, detailPageCalls } = await searchAndGetDetails(name, location, token, filters, 10, fetchDetails);
      allResults.push(...results);
      totalSearchPageCalls += searchPageCalls;
      totalDetailPageCalls += detailPageCalls;
    } catch (error) {
      console.error(`[SPF batchSearch] 搜索失败: ${name}`, error);
    }
    
    completed++;
    if (onProgress) {
      onProgress(completed, total);
    }
    
    if (i < names.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return {
    results: deduplicateByDetailLink(allResults),
    totalSearchPageCalls,
    totalDetailPageCalls,
  };
}
