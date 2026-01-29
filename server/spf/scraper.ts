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

// ==================== Scrape.do API ====================

const SCRAPE_TIMEOUT_MS = 5000;   // 5 秒超时（降低以快速失败，避免长时间等待 502）
const SCRAPE_MAX_RETRIES = 2;    // 最多重试 2 次（减少重试次数）

/**
 * 使用 Scrape.do API 获取页面（带超时和重试）
 * 
 * 关键参数说明 (根据 Scrape.do 技术支持建议):
 * - super=true: 使用住宅代理，提高成功率
 * - geoCode=us: 使用美国 IP
 * - 不使用 render=true: SearchPeopleFree 不支持渲染模式
 */
async function fetchWithScrapedo(url: string, token: string): Promise<string> {
  const encodedUrl = encodeURIComponent(url);
  // 注意：不使用 timeout 和 disableRetry 参数，让 scrape.do 使用默认配置（之前成功的配置）
  const apiUrl = `https://api.scrape.do/?token=${token}&url=${encodedUrl}&super=true&geoCode=us`;
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= SCRAPE_MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS + 15000); // 客户端超时比 API 超时多 15 秒
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      // 检查是否是可重试的服务器错误 (502, 503, 504)
      if (!response.ok) {
        const isRetryableError = [502, 503, 504].includes(response.status);
        if (isRetryableError && attempt < SCRAPE_MAX_RETRIES) {
          console.log(`[SPF fetchWithScrapedo] 服务器错误 ${response.status}，正在重试 (${attempt + 1}/${SCRAPE_MAX_RETRIES})...`);
          await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
          continue;
        }
        throw new Error(`Scrape.do API 请求失败: ${response.status} ${response.statusText}`);
      }
      
      const text = await response.text();
      
      // 检查响应是否是 JSON 错误（scrape.do 有时返回 200 但内容是 JSON 错误）
      if (text.startsWith('{') && text.includes('"StatusCode"')) {
        try {
          const jsonError = JSON.parse(text);
          const statusCode = jsonError.StatusCode || 0;
          const isRetryableError = [502, 503, 504].includes(statusCode);
          
          if (isRetryableError && attempt < SCRAPE_MAX_RETRIES) {
            console.log(`[SPF fetchWithScrapedo] API 返回 JSON 错误 (StatusCode: ${statusCode})，正在重试 (${attempt + 1}/${SCRAPE_MAX_RETRIES})...`);
            await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
            continue;
          }
          
          const errorMsg = Array.isArray(jsonError.Message) ? jsonError.Message.join(', ') : (jsonError.Message || 'Unknown error');
          throw new Error(`Scrape.do API 返回错误: StatusCode ${statusCode} - ${errorMsg}`);
        } catch (parseError: any) {
          // 如果不是有效的 JSON 或已经是我们的错误，重新抛出
          if (parseError.message?.includes('Scrape.do API')) {
            throw parseError;
          }
        }
      }
      
      // 检查响应是否是有效的 HTML
      const trimmedText = text.trim();
      if (!trimmedText.startsWith('<') && !trimmedText.startsWith('<!DOCTYPE')) {
        if (attempt < SCRAPE_MAX_RETRIES) {
          console.log(`[SPF fetchWithScrapedo] 响应不是有效的 HTML，正在重试 (${attempt + 1}/${SCRAPE_MAX_RETRIES})...`);
          await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
          continue;
        }
        throw new Error('Scrape.do API 返回的不是有效的 HTML');
      }
      
      return text;
    } catch (error: any) {
      lastError = error;
      
      if (attempt >= SCRAPE_MAX_RETRIES) {
        break;
      }
      
      const isTimeout = error.name === 'AbortError' || error.message?.includes('timeout');
      const isNetworkError = error.message?.includes('fetch') || error.message?.includes('network');
      const isServerError = error.message?.includes('502') || error.message?.includes('503') || error.message?.includes('504');
      
      if (isTimeout || isNetworkError || isServerError) {
        console.log(`[SPF fetchWithScrapedo] 请求失败 (${error.message})，正在重试 (${attempt + 1}/${SCRAPE_MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError || new Error('请求失败');
}

// ==================== 配置常量 ====================

export const SPF_CONFIG = {
  TASK_CONCURRENCY: 3,       // 同时执行的搜索任务数（降低以减少 502）
  SCRAPEDO_CONCURRENCY: 5,   // 每个任务的 Scrape.do 并发数（降低）
  TOTAL_CONCURRENCY: 10,     // 详情页总并发数（降低以避免限流）
  MAX_SAFE_PAGES: 25,        // 最大搜索页数（网站上限）
  MAX_DETAILS_PER_TASK: 250, // 每个任务最大详情数 (25页 × 10条/页)
  SEARCH_COST: 0.85,         // 搜索页成本 (每次 API 调用)
  DETAIL_COST: 0.85,         // 详情页成本 (每次 API 调用)
};

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
 */
function buildSearchUrl(name: string, location: string): string {
  const nameParts = name.trim().toLowerCase().replace(/\s+/g, '-');
  let url = `https://www.searchpeoplefree.com/find/${nameParts}`;
  
  if (location) {
    const locationParts = location.trim().toLowerCase().replace(/,\s*/g, '-').replace(/\s+/g, '-');
    url += `/${locationParts}`;
  }
  
  return url;
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
    onProgress(`搜索: ${searchUrl}`);
    
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
      onProgress(`检测到直接返回详情页`);
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
      onProgress(`第 ${currentPageNum}/${maxPages} 页: ${pageResults.length} 个结果`);
      
      if (pageResults.length === 0) {
        onProgress(`第 ${currentPageNum} 页无结果，停止分页`);
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
        onProgress(`已到达最后一页，共 ${currentPageNum} 页`);
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
      } catch (pageError) {
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
    return {
      success: false,
      searchResults: [],
      error: error.message,
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
  };
}

/**
 * 批量获取详情页面（统一队列并发）
 * 
 * @param tasks 详情任务列表
 * @param token Scrape.do API token
 * @param concurrency 并发数
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
  setCachedDetails: (items: Array<{ link: string; data: SpfDetailResult }>) => Promise<void>
): Promise<FetchDetailsResult> {
  const results: Array<{ task: DetailTask; details: SpfDetailResult | null }> = [];
  let detailPageRequests = 0;
  let cacheHits = 0;
  let filteredOut = 0;
  
  const baseUrl = 'https://www.searchpeoplefree.com';
  const uniqueLinks = [...new Set(tasks.map(t => t.detailLink))];
  
  onProgress(`检查缓存: ${uniqueLinks.length} 个链接...`);
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
  
  for (const [link, linkTasks] of tasksByLink) {
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
  
  onProgress(`⚡ 缓存命中: ${cacheHits}, 待获取: ${tasksToFetch.length}`);
  
  const cacheToSave: Array<{ link: string; data: SpfDetailResult }> = [];
  let completed = 0;
  
  if (tasksToFetch.length > 0) {
    // 并发控制实现
    const concurrencyPool = new Set<Promise<any>>();
    
    for (const task of tasksToFetch) {
      if (concurrencyPool.size >= concurrency) {
        await Promise.race(concurrencyPool);
      }
      
      const promise = (async () => {
        const link = task.detailLink;
        const detailUrl = link.startsWith('http') ? link : `${baseUrl}${link.startsWith('/') ? '' : '/'}${link}`;
        
        try {
          const html = await fetchWithScrapedo(detailUrl, token);
          detailPageRequests++;
          
          // 检查是否是错误响应
          if (html.includes('"ErrorCode"') || html.includes('"StatusCode":4')) {
            const linkTasks = tasksByLink.get(link) || [task];
            for (const t of linkTasks) {
              results.push({ task: t, details: null });
            }
            return;
          }
          
          const details = parseDetailPage(html, link);
          
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
        } catch (error: any) {
          onProgress(`获取详情失败: ${link} - ${error.message || error}`);
          const linkTasks = tasksByLink.get(link) || [task];
          for (const t of linkTasks) {
            results.push({ task: t, details: null });
          }
        } finally {
          completed++;
          if (completed % 10 === 0 || completed === tasksToFetch.length) {
            const percent = Math.round((completed / tasksToFetch.length) * 100);
            onProgress(`📥 详情进度: ${completed}/${tasksToFetch.length} (${percent}%)`);
          }
          concurrencyPool.delete(promise);
        }
      })();
      
      concurrencyPool.add(promise);
    }
    
    await Promise.all(Array.from(concurrencyPool));
  }
  
  // 保存缓存
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
