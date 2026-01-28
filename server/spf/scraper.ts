/**
 * SearchPeopleFree (SPF) 网页抓取模块
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
 * 重要说明：
 * 根据 Scrape.do 技术支持建议，SearchPeopleFree 使用 super=true + geoCode=us
 * 搜索页面和详情页面都可以成功访问
 */

import * as cheerio from 'cheerio';

// ==================== Scrape.do API ====================

const SCRAPE_TIMEOUT_MS = 60000;  // 60 秒超时
const SCRAPE_MAX_RETRIES = 3;    // 最多重试 3 次

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
  const apiUrl = `https://api.scrape.do/?token=${token}&url=${encodedUrl}&super=true&geoCode=us`;
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= SCRAPE_MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS + 15000);
      
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
          await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));  // 递增延迟
          continue;
        }
        throw new Error(`Scrape.do API 请求失败: ${response.status} ${response.statusText}`);
      }
      
      return await response.text();
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
        await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));  // 递增延迟
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError || new Error('请求失败');
}

// ==================== 配置常量 ====================

export const SPF_CONFIG = {
  TASK_CONCURRENCY: 4,
  SCRAPEDO_CONCURRENCY: 10,
  TOTAL_CONCURRENCY: 40,
  MAX_SAFE_PAGES: 25,
  SEARCH_COST: 0.85,  // 搜索页成本 (每次 API 调用)
  DETAIL_COST: 0.85,  // 详情页成本 (每次 API 调用)
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
  allPhones?: Array<{ number: string; type: string; year?: number; date?: string }>;  // 添加年份和日期
  phoneYear?: number;  // 主电话的年份
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
  searchResult: SpfSearchResult;
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
 * Cloudflare 使用 data-cfemail 属性存储编码后的邮箱
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

// ==================== 搜索页面解析 (完整数据提取) ====================

/**
 * 从搜索页面提取完整的详细信息
 * 
 * SearchPeopleFree 搜索页面已包含完整数据：
 * - 姓名、年龄、出生年份
 * - 电话号码和类型 (Landline/Wireless)
 * - 当前地址和历史地址
 * - 家庭成员 (Spouse, partner, mother, father...)
 * - 关联人员 (Friends, family, business associates...)
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
      addresses: [],
      familyMembers: [],
      associates: [],
      alsoKnownAs: [],
      allEmails: [],
    };
    
    try {
      // 1. 提取姓名和详情链接
      const h2 = article.find('h2.h2').first();
      const nameLink = h2.find('a[href*="/find/"]').first();
      
      // 获取姓名 (链接的直接文本，不包括子元素)
      result.name = nameLink.clone().children().remove().end().text().trim();
      result.detailLink = nameLink.attr('href') || '';
      
      if (!result.name) return;
      
      // 确保详情链接是完整 URL
      if (result.detailLink && !result.detailLink.startsWith('http')) {
        result.detailLink = `https://www.searchpeoplefree.com${result.detailLink}`;
      }
      
      // 解析姓名
      const nameParts = result.name.split(' ');
      result.firstName = nameParts[0];
      result.lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : undefined;
      
      // 2. 提取位置
      const locationSpan = h2.find('span').first();
      let locationText = locationSpan.text().replace(/^in\s+/i, '').trim();
      if (locationText.includes('also')) {
        locationText = locationText.split('also')[0].trim();
      }
      result.location = locationText;
      
      // 解析城市和州
      if (locationText) {
        const locationParts = locationText.split(',').map(p => p.trim());
        if (locationParts.length >= 2) {
          result.city = locationParts[0];
          result.state = locationParts[1];
        }
      }
      
      // 3. 提取 "Also Known As" (别名)
      h2.find('span').each((_, spanEl) => {
        const spanText = $(spanEl).text();
        if (spanText.includes('also')) {
          const akaMatch = spanText.match(/also\s+(.+)/i);
          if (akaMatch && result.alsoKnownAs) {
            result.alsoKnownAs.push(akaMatch[1].trim());
          }
        }
      });
      
      // 4. 提取年龄和出生年份
      const h3 = article.find('h3.mb-3').first();
      const ageText = h3.text();
      const { age, birthYear } = parseAgeAndBirthYear(ageText);
      result.age = age;
      result.birthYear = birthYear;
      
      // 5. 提取地址
      article.find('ul.inline').each((_, ulEl) => {
        const ul = $(ulEl);
        const prevText = ul.prev('i.text-muted').text().toLowerCase();
        
        if (prevText.includes('address') || prevText.includes('property')) {
          ul.find('li').each((_, liEl) => {
            const addressLink = $(liEl).find('a[href*="/address/"]');
            if (addressLink.length) {
              const address = addressLink.text().trim();
              const isCurrent = $(liEl).find('i.text-highlight').text().toLowerCase().includes('current');
              
              if (address && result.addresses) {
                result.addresses.push(address);
                if (isCurrent) {
                  result.currentAddress = address;
                }
              }
            }
          });
        }
      });
      
      // 6. 提取电话号码
      article.find('ul.inline').each((_, ulEl) => {
        const ul = $(ulEl);
        const prevText = ul.prev('i.text-muted').text().toLowerCase();
        
        if (prevText.includes('telephone') || prevText.includes('phone')) {
          ul.find('li').each((_, liEl) => {
            const phoneLink = $(liEl).find('a[href*="/phone-lookup/"]');
            if (phoneLink.length) {
              const phoneText = phoneLink.text().trim();
              const typeText = $(liEl).find('i.text-highlight').first().text();
              const isCurrent = $(liEl).text().toLowerCase().includes('current');
              
              const phoneNumber = formatPhoneNumber(phoneText);
              const phoneType = parsePhoneType(typeText);
              
              if (phoneNumber && result.allPhones) {
                result.allPhones.push({
                  number: phoneNumber,
                  type: phoneType,
                });
                
                // 设置主电话 (优先当前电话，其次第一个)
                if (isCurrent || !result.phone) {
                  result.phone = phoneNumber;
                  result.phoneType = phoneType;
                }
              }
            }
          });
        }
      });
      
      // 7. 提取家庭成员 (Spouse, partner, mother, father, sister, brother)
      article.find('ul.inline').each((_, ulEl) => {
        const ul = $(ulEl);
        const prevText = ul.prev('i.text-muted').text().toLowerCase();
        
        if (prevText.includes('spouse') || prevText.includes('partner') || 
            prevText.includes('mother') || prevText.includes('father') ||
            prevText.includes('sister') || prevText.includes('brother') ||
            prevText.includes('ex-spouse')) {
          ul.find('li a[href*="/find/"]').each((_, aEl) => {
            const memberName = $(aEl).text().trim();
            if (memberName && result.familyMembers) {
              result.familyMembers.push(memberName);
              
              // 第一个家庭成员可能是配偶
              if (!result.spouseName && prevText.includes('spouse')) {
                result.spouseName = memberName;
                result.spouseLink = $(aEl).attr('href') || undefined;
              }
            }
          });
        }
      });
      
      // 8. 提取关联人员 (Friends, family, business associates, roommates)
      article.find('ul.inline').each((_, ulEl) => {
        const ul = $(ulEl);
        const prevText = ul.prev('i.text-muted').text().toLowerCase();
        
        if (prevText.includes('friends') || prevText.includes('associates') || 
            prevText.includes('roommates') || prevText.includes('business')) {
          ul.find('li a[href*="/find/"]').each((_, aEl) => {
            const associateName = $(aEl).text().trim();
            if (associateName && result.associates) {
              result.associates.push(associateName);
            }
          });
        }
      });
      
      // 9. 检查是否已故
      result.isDeceased = article.text().toLowerCase().includes('deceased');
      
      results.push(result);
      
    } catch (error) {
      console.error('[SPF parseSearchPageFull] 解析单个结果时出错:', error);
    }
  });
  
  console.log(`[SPF parseSearchPageFull] 解析到 ${results.length} 个完整结果`);
  return results;
}

/**
 * 提取搜索页面的下一页链接
 * @param html - 搜索页面 HTML
 * @returns 下一页的完整 URL，如果没有下一页则返回 null
 */
export function extractNextPageUrl(html: string): string | null {
  const $ = cheerio.load(html);
  
  // 查找 "Next Page" 链接
  // 格式: <a href="/find/john-smith/p-2">Next Page »</a>
  const nextPageLink = $('a').filter((_, el) => {
    const text = $(el).text().toLowerCase();
    return text.includes('next page') || text.includes('next »') || text.includes('»');
  }).first();
  
  if (nextPageLink.length) {
    const href = nextPageLink.attr('href');
    if (href) {
      // 确保是完整 URL
      if (href.startsWith('http')) {
        return href;
      }
      return `https://www.searchpeoplefree.com${href.startsWith('/') ? '' : '/'}${href}`;
    }
  }
  
  return null;
}

/**
 * 简化版搜索页面解析 (仅提取基本信息)
 */
export function parseSearchPage(html: string): SpfSearchResult[] {
  const $ = cheerio.load(html);
  const results: SpfSearchResult[] = [];
  
  $('li.toc.l-i.mb-5 article, li.toc article').each((_, articleEl) => {
    const article = $(articleEl);
    
    const h2 = article.find('h2.h2').first();
    const nameLink = h2.find('a[href*="/find/"]').first();
    
    const name = nameLink.clone().children().remove().end().text().trim();
    const detailLink = nameLink.attr('href') || '';
    
    if (!name || !detailLink) return;
    
    const locationSpan = h2.find('span').first();
    let location = locationSpan.text().replace(/^in\s+/i, '').trim();
    if (location.includes('also')) {
      location = location.split('also')[0].trim();
    }
    
    const h3 = article.find('h3.mb-3').first();
    const ageText = h3.text();
    const ageMatch = ageText.match(/(\d+)/);
    const age = ageMatch ? parseInt(ageMatch[1], 10) : undefined;
    
    const isDeceased = article.text().toLowerCase().includes('deceased');
    
    const fullDetailLink = detailLink.startsWith('http') 
      ? detailLink 
      : `https://www.searchpeoplefree.com${detailLink}`;
    
    results.push({
      name,
      age,
      location,
      detailLink: fullDetailLink,
      isDeceased,
    });
  });
  
  console.log(`[SPF parseSearchPage] 解析到 ${results.length} 个搜索结果`);
  return results;
}

// ==================== 详情页面解析 ====================

/**
 * 解析详情页面 - 提取完整的个人信息
 * 
 * 详情页面包含以下数据：
 * - 基本信息：姓名、年龄、出生年份、确认日期
 * - 婚姻状态：已婚/未婚，配偶姓名和链接
 * - 邮箱地址：多个邮箱（部分遮蔽）
 * - 就业信息
 * - 教育信息
 * - 电话号码：多个电话及类型
 * - 地址：当前地址和历史地址（带时间戳）
 * - 别名 (Also Known As)
 * - 家庭成员
 * - 关联人员
 * - 企业关联
 * 
 * HTML 结构示例:
 * <article class="background">
 *   <article class="current-bg">
 *     <p>Married to <a href="...">Jennifer A Smith</a></p>
 *   </article>
 * </article>
 * <article class="email-bg">
 *   <ol class="inline row">
 *     <li><a href="...">jh*****<span data-cfemail="...">[email protected]</span></a></li>
 *   </ol>
 * </article>
 */
export function parseDetailPage(html: string, detailLink: string): SpfDetailResult | null {
  try {
    const $ = cheerio.load(html);
    
    // 检查是否是有效的详情页面
    if (!html.includes('personDetails') && !html.includes('current-bg')) {
      console.log('[SPF parseDetailPage] 不是有效的详情页面');
      return null;
    }
    
    const result: SpfDetailResult = {
      name: '',
      detailLink: detailLink,
      allPhones: [],
      allEmails: [],
      addresses: [],
      familyMembers: [],
      associates: [],
      alsoKnownAs: [],
      businesses: [],
    };
    
    // 1. 从 dataLayer 提取统计信息
    const scriptContent = html.match(/dataLayer\.push\(\{[^}]+\}\)/g);
    if (scriptContent) {
      scriptContent.forEach(script => {
        const addressMatch = script.match(/'addressCount':\s*'(\d+)'/);
        const phoneMatch = script.match(/'phoneCount':\s*'(\d+)'/);
        const emailMatch = script.match(/'emailCount':\s*'(\d+)'/);
        const akaMatch = script.match(/'akaCount':\s*'(\d+)'/);
        const familyMatch = script.match(/'familyCount':\s*'(\d+)'/);
        const associateMatch = script.match(/'associateCount':\s*'(\d+)'/);
        const businessMatch = script.match(/'businessCount':\s*'(\d+)'/);
        
        if (addressMatch) result.addressCount = parseInt(addressMatch[1], 10);
        if (phoneMatch) result.phoneCount = parseInt(phoneMatch[1], 10);
        if (emailMatch) result.emailCount = parseInt(emailMatch[1], 10);
        if (akaMatch) result.akaCount = parseInt(akaMatch[1], 10);
        if (familyMatch) result.familyCount = parseInt(familyMatch[1], 10);
        if (associateMatch) result.associateCount = parseInt(associateMatch[1], 10);
        if (businessMatch) result.businessCount = parseInt(businessMatch[1], 10);
      });
    }
    
    // 2. 提取标题中的姓名
    const title = $('title').text();
    const titleMatch = title.match(/^([^|]+)/);
    if (titleMatch) {
      const titleName = titleMatch[1].replace(/living in.*|Contact Details/gi, '').trim();
      result.name = titleName;
    }
    
    // 3. 提取确认日期
    const confirmedTime = $('article.background time[datetime]').first();
    if (confirmedTime.length) {
      result.confirmedDate = confirmedTime.text().replace('Confirmed on', '').trim();
    }
    
    // 4. 提取当前信息区块 (current-bg)
    const currentBg = $('article.current-bg').first();
    if (currentBg.length) {
      // 姓名
      const headerP = currentBg.find('header p').first();
      if (headerP.length) {
        result.name = headerP.text().trim();
      }
      
      // 解析姓名
      if (result.name) {
        const nameParts = result.name.split(' ');
        result.firstName = nameParts[0];
        result.lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : undefined;
      }
      
      // 年龄和出生年份
      const ageText = currentBg.text();
      const { age, birthYear } = parseAgeAndBirthYear(ageText);
      result.age = age;
      result.birthYear = birthYear;
      
      // 婚姻状态 - 增强解析逻辑
      const currentBgHtml = currentBg.html() || '';
      const currentBgText = currentBg.text().toLowerCase();
      
      // 模式 1: "Married to <a>..."
      const marriedMatch = currentBgHtml.match(/Married to\s*<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/i);
      if (marriedMatch) {
        result.maritalStatus = 'Married';
        result.spouseLink = marriedMatch[1];
        result.spouseName = marriedMatch[2].trim();
        if (result.spouseLink && !result.spouseLink.startsWith('http')) {
          result.spouseLink = `https://www.searchpeoplefree.com${result.spouseLink}`;
        }
      } 
      // 模式 2: 纯文本 "Married" 或 "married"
      else if (currentBgText.includes('married') && !currentBgText.includes('unmarried')) {
        result.maritalStatus = 'Married';
        // 尝试从文本中提取配偶名字
        const spouseTextMatch = currentBgHtml.match(/Married(?:\s+to)?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
        if (spouseTextMatch && spouseTextMatch[1]) {
          result.spouseName = spouseTextMatch[1].trim();
        }
      }
      // 模式 3: "Single" 或 "single"
      else if (currentBgText.includes('single')) {
        result.maritalStatus = 'Single';
      }
      // 模式 4: "Divorced" 或 "divorced"
      else if (currentBgText.includes('divorced')) {
        result.maritalStatus = 'Divorced';
      }
      // 模式 5: "Widowed" 或 "widowed"
      else if (currentBgText.includes('widowed')) {
        result.maritalStatus = 'Widowed';
      }
      
      // 主邮箱
      const emailLink = currentBg.find('a[href*="/email/"]').first();
      if (emailLink.length) {
        const cfEmail = emailLink.find('span.__cf_email__').attr('data-cfemail');
        if (cfEmail) {
          const decodedEmail = decodeCloudflareEmail(cfEmail);
          if (decodedEmail) {
            result.email = decodedEmail;
            result.allEmails?.push(decodedEmail);
          }
        }
      }
      
      // 就业状态
      if (currentBg.text().includes('No known employment')) {
        result.employment = 'No known employment';
      }
      
      // 主电话
      currentBg.find('a[href*="hone-lookup"]').each((_, aEl) => {
        const phoneText = $(aEl).text().trim();
        const phoneNumber = formatPhoneNumber(phoneText);
        const typeText = $(aEl).next('i.text-highlight').text();
        const phoneType = parsePhoneType(typeText);
        
        if (phoneNumber && result.allPhones) {
          result.allPhones.push({ number: phoneNumber, type: phoneType });
          if (!result.phone) {
            result.phone = phoneNumber;
            result.phoneType = phoneType;
          }
        }
      });
    }
    
    // 5. 提取教育信息 (education-bg)
    const educationBg = $('article.education-bg').first();
    if (educationBg.length) {
      const educationText = educationBg.find('dfn.text-muted').text().trim();
      if (educationText && !educationText.includes('not associated')) {
        result.education = educationText;
      } else {
        // 查找具体的教育记录
        const educationItems = educationBg.find('ol.inline li');
        if (educationItems.length) {
          const educations: string[] = [];
          educationItems.each((_, li) => {
            educations.push($(li).text().trim());
          });
          result.education = educations.join('; ');
        }
      }
    }
    
    // 6. 提取就业信息 (employment-bg)
    const employmentBg = $('article.employment-bg').first();
    if (employmentBg.length) {
      const employmentText = employmentBg.find('dfn.text-muted').text().trim();
      if (employmentText && !employmentText.includes('not associated')) {
        result.employment = employmentText;
      } else {
        // 查找具体的就业记录
        const employmentItems = employmentBg.find('ol.inline li');
        if (employmentItems.length) {
          const employments: string[] = [];
          employmentItems.each((_, li) => {
            employments.push($(li).text().trim());
          });
          result.employment = employments.join('; ');
        }
      }
    }
    
    // 7. 提取邮箱地址 (email-bg)
    const emailBg = $('article.email-bg').first();
    if (emailBg.length) {
      emailBg.find('ol.inline li a[href*="/email/"]').each((_, aEl) => {
        const cfEmail = $(aEl).find('span.__cf_email__').attr('data-cfemail');
        if (cfEmail) {
          const decodedEmail = decodeCloudflareEmail(cfEmail);
          if (decodedEmail && result.allEmails && !result.allEmails.includes(decodedEmail)) {
            result.allEmails.push(decodedEmail);
            if (!result.email) {
              result.email = decodedEmail;
            }
          }
        }
      });
    }
    
    // 8. 提取电话号码 (phone-bg) - 包含年份信息，选择最新号码
    const phoneBg = $('article.phone-bg').first();
    if (phoneBg.length) {
      // 临时存储所有电话信息
      const phoneEntries: Array<{ number: string; type: string; year: number; date: string }> = [];
      
      phoneBg.find('ol.inline li').each((_, liEl) => {
        const li = $(liEl);
        const phoneLink = li.find('a[href*="/phone-lookup/"], a[href*="hone-lookup"]');
        if (phoneLink.length) {
          const phoneText = phoneLink.text().trim();
          const phoneNumber = formatPhoneNumber(phoneText);
          const typeText = li.find('i.text-highlight').text();
          const phoneType = parsePhoneType(typeText);
          
          // 提取年份信息从 <time> 元素
          const timeEl = li.find('time');
          let year = 0;
          let dateStr = '';
          if (timeEl.length) {
            const datetime = timeEl.attr('datetime'); // 格式: "2025-12-01 12:00"
            const timeText = timeEl.text().trim(); // 格式: "- December 2025"
            
            if (datetime) {
              const yearMatch = datetime.match(/^(\d{4})/);
              if (yearMatch) {
                year = parseInt(yearMatch[1], 10);
              }
              dateStr = datetime.split(' ')[0]; // "2025-12-01"
            } else if (timeText) {
              const yearMatch = timeText.match(/(\d{4})/);
              if (yearMatch) {
                year = parseInt(yearMatch[1], 10);
              }
              dateStr = timeText.replace(/^-\s*/, '');
            }
          }
          
          // 检查是否已存在
          if (phoneNumber && !phoneEntries.some(p => p.number === phoneNumber)) {
            phoneEntries.push({ number: phoneNumber, type: phoneType, year, date: dateStr });
          }
        }
      });
      
      // 按年份降序排序，选择最新的电话号码
      phoneEntries.sort((a, b) => b.year - a.year);
      
      // 存储到 result
      result.allPhones = phoneEntries;
      
      // 选择最新的电话号码作为主电话
      if (phoneEntries.length > 0) {
        const newestPhone = phoneEntries[0];
        result.phone = newestPhone.number;
        result.phoneType = newestPhone.type;
        result.phoneYear = newestPhone.year;
        console.log(`[SPF] 选择最新电话: ${newestPhone.number} (${newestPhone.type}, ${newestPhone.year})`);
      }
    }
    
    // 9. 提取地址 (address-bg)
    const addressBg = $('article.address-bg').first();
    if (addressBg.length) {
      addressBg.find('ol.inline li').each((_, liEl) => {
        const li = $(liEl);
        const addressLink = li.find('a[href*="/address/"]');
        if (addressLink.length) {
          const address = addressLink.text().trim();
          const timeEl = li.find('time');
          const reportDate = timeEl.length ? timeEl.text().trim() : '';
          
          if (address && result.addresses) {
            const fullAddress = reportDate ? `${address} ${reportDate}` : address;
            result.addresses.push(fullAddress);
            
            // 第一个地址通常是当前地址
            if (!result.currentAddress) {
              result.currentAddress = address;
            }
          }
        }
      });
    }
    
    // 10. 提取别名 (alias-bg)
    const aliasBg = $('article.alias-bg').first();
    if (aliasBg.length) {
      aliasBg.find('ol.inline li a[href*="/find/"]').each((_, aEl) => {
        const alias = $(aEl).text().trim();
        if (alias && result.alsoKnownAs && !result.alsoKnownAs.includes(alias)) {
          result.alsoKnownAs.push(alias);
        }
      });
    }
    
    // 11. 提取家庭成员 (family-bg)
    const familyBg = $('article.family-bg').first();
    if (familyBg.length) {
      familyBg.find('ol.inline li a[href*="/find/"]').each((_, aEl) => {
        const member = $(aEl).text().trim();
        if (member && result.familyMembers && !result.familyMembers.includes(member)) {
          result.familyMembers.push(member);
        }
      });
    }
    
    // 12. 提取关联人员 (associate-bg)
    const associateBg = $('article.associate-bg').first();
    if (associateBg.length) {
      associateBg.find('ol.inline li a[href*="/find/"]').each((_, aEl) => {
        const associate = $(aEl).text().trim();
        if (associate && result.associates && !result.associates.includes(associate)) {
          result.associates.push(associate);
        }
      });
    }
    
    // 13. 提取企业关联 (business-bg)
    const businessBg = $('article.business-bg').first();
    if (businessBg.length) {
      businessBg.find('ol.inline li').each((_, liEl) => {
        const business = $(liEl).text().trim();
        if (business && result.businesses && !result.businesses.includes(business)) {
          result.businesses.push(business);
        }
      });
    }
    
    // 14. 提取位置信息
    if (result.currentAddress) {
      const addressParts = result.currentAddress.split(',').map(p => p.trim());
      if (addressParts.length >= 2) {
        result.city = addressParts[addressParts.length - 2];
        const stateZip = addressParts[addressParts.length - 1];
        const stateMatch = stateZip.match(/^([A-Z]{2})/);
        if (stateMatch) {
          result.state = stateMatch[1];
        }
      }
      result.location = result.city && result.state ? `${result.city}, ${result.state}` : result.currentAddress;
    }
    
    // 15. 检查是否已故
    result.isDeceased = html.toLowerCase().includes('deceased');
    
    console.log(`[SPF parseDetailPage] 解析详情页成功: ${result.name}, 邮箱: ${result.allEmails?.length || 0}, 电话: ${result.allPhones?.length || 0}`);
    
    return result;
    
  } catch (error) {
    console.error('[SPF parseDetailPage] 解析详情页面时出错:', error);
    return null;
  }
}

// ==================== 主搜索函数 ====================

/**
 * 应用过滤器检查详情是否符合条件
 */
function applyFilters(detail: SpfDetailResult, filters: SpfFilters): boolean {
  if (filters.minAge && detail.age && detail.age < filters.minAge) {
    console.log(`[SPF] 跳过 ${detail.name}: 年龄 ${detail.age} < ${filters.minAge}`);
    return false;
  }
  
  if (filters.maxAge && detail.age && detail.age > filters.maxAge) {
    console.log(`[SPF] 跳过 ${detail.name}: 年龄 ${detail.age} > ${filters.maxAge}`);
    return false;
  }
  
  if (filters.excludeLandline && detail.phoneType === 'Landline') {
    console.log(`[SPF] 跳过 ${detail.name}: 排除座机`);
    return false;
  }
  
  if (filters.excludeWireless && detail.phoneType === 'Wireless') {
    console.log(`[SPF] 跳过 ${detail.name}: 排除手机`);
    return false;
  }
  
  return true;
}

/**
 * 搜索结果和 API 调用统计
 */
export interface SearchResultWithStats {
  results: SpfDetailResult[];
  searchPageCalls: number;  // 搜索页 API 调用次数
  detailPageCalls: number;  // 详情页 API 调用次数
}

/**
 * 执行搜索并获取详情
 * 
 * 流程:
 * 1. 获取搜索页面 (/find/john-smith) - 计费 0.85 积分
 * 2. 从搜索页面提取基本数据
 * 3. 获取详情页面以获取更多数据（邮箱、婚姻状态等）- 每个结果计费 0.85 积分
 * 4. 应用过滤器
 * 5. 返回结果和 API 调用统计
 * 
 * @param fetchDetails - 是否获取详情页面（默认 true，获取邮箱、婚姻状态等）
 */
export async function searchAndGetDetails(
  name: string,
  location: string,
  token: string,
  filters: SpfFilters = {},
  maxResults: number = 10,
  fetchDetails: boolean = true  // 默认启用详情页获取，获取邮箱、婚姻状态等
): Promise<SearchResultWithStats> {
  const results: SpfDetailResult[] = [];
  let searchPageCalls = 0;
  let detailPageCalls = 0;
  
  // 调试日志：打印接收到的过滤器
  console.log(`[SPF] 接收到的过滤器: ${JSON.stringify(filters)}`);
  
  try {
    // 1. 构建搜索 URL
    const searchUrl = buildSearchUrl(name, location);
    console.log(`[SPF] 搜索: ${searchUrl}`);
    
    // 2. 获取搜索页面 HTML
    const searchHtml = await fetchWithScrapedo(searchUrl, token);
    searchPageCalls++;  // 计数搜索页 API 调用
    console.log(`[SPF] 获取搜索页面成功，大小: ${searchHtml.length} bytes`);
    
    // 检查是否是错误响应
    if (searchHtml.includes('"ErrorCode"') || searchHtml.includes('"StatusCode":4') || searchHtml.includes('"StatusCode":5')) {
      console.error(`[SPF] API 返回错误: ${searchHtml.substring(0, 500)}`);
      return { results, searchPageCalls, detailPageCalls };
    }
    
    // 3. 检测返回的是搜索列表页还是详情页
    // 当搜索 "姓名+地点" 时，SearchPeopleFree 可能直接返回匹配的详情页而不是搜索列表
    const isDetailPage = (searchHtml.includes('current-bg') || searchHtml.includes('personDetails')) && 
                         !searchHtml.includes('li class="toc l-i mb-5"');
    
    if (isDetailPage) {
      console.log(`[SPF] 检测到直接返回详情页（姓名+地点搜索）`);
      // 直接解析详情页
      const detailResult = parseDetailPage(searchHtml, searchUrl);
      if (detailResult) {
        // 添加搜索信息
        detailResult.searchName = name;
        detailResult.searchLocation = location;
        
        // 应用过滤器
        if (applyFilters(detailResult, filters)) {
          results.push(detailResult);
          console.log(`[SPF] 详情页解析成功: ${detailResult.name}, 年龄: ${detailResult.age}, 电话: ${detailResult.phone}`);
        } else {
          console.log(`[SPF] 详情页结果被过滤: ${detailResult.name}, 年龄: ${detailResult.age}`);
        }
      } else {
        console.log(`[SPF] 详情页解析失败`);
      }
      return { results, searchPageCalls, detailPageCalls };
    }
    
    // 4. 分页获取所有搜索结果
    const maxPages = 3;  // 最大获取 3 页，避免过多 API 调用
    let currentPageHtml = searchHtml;
    let currentPageNum = 1;
    const allSearchResults: SpfDetailResult[] = [];
    
    while (currentPageNum <= maxPages) {
      // 解析当前页的搜索结果
      const pageResults = parseSearchPageFull(currentPageHtml);
      console.log(`[SPF] 第 ${currentPageNum} 页解析到 ${pageResults.length} 个结果`);
      
      if (pageResults.length === 0) {
        break;
      }
      
      allSearchResults.push(...pageResults);
      
      // 检查是否有下一页
      const nextPageUrl = extractNextPageUrl(currentPageHtml);
      if (!nextPageUrl || allSearchResults.length >= maxResults * 2) {
        // 没有下一页，或已获取足够多结果
        break;
      }
      
      // 获取下一页
      console.log(`[SPF] 获取下一页: ${nextPageUrl}`);
      try {
        currentPageHtml = await fetchWithScrapedo(nextPageUrl, token);
        searchPageCalls++;
        currentPageNum++;
        
        // 检查是否是错误响应
        if (currentPageHtml.includes('"ErrorCode"') || currentPageHtml.includes('"StatusCode":4')) {
          console.log(`[SPF] 下一页获取失败，停止分页`);
          break;
        }
        
        // 请求间延迟
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (pageError) {
        console.error(`[SPF] 获取下一页失败:`, pageError);
        break;
      }
    }
    
    console.log(`[SPF] 共获取 ${currentPageNum} 页，总计 ${allSearchResults.length} 个搜索结果`);
    
    if (allSearchResults.length === 0) {
      console.log(`[SPF] 未找到匹配结果: ${name} ${location}`);
      return { results, searchPageCalls, detailPageCalls };
    }
    
    // 5. 处理每个结果
    for (const searchResult of allSearchResults) {
      if (results.length >= maxResults) break;
      
      // 先应用过滤器
      if (!applyFilters(searchResult, filters)) {
        continue;
      }
      
      // 如果需要获取详情页面
      if (fetchDetails && searchResult.detailLink) {
        try {
          // 将相对路径转换为完整 URL
          const detailUrl = searchResult.detailLink.startsWith('http') 
            ? searchResult.detailLink 
            : `https://www.searchpeoplefree.com${searchResult.detailLink.startsWith('/') ? '' : '/'}${searchResult.detailLink}`;
          console.log(`[SPF] 获取详情页: ${detailUrl}`);
          const detailHtml = await fetchWithScrapedo(detailUrl, token);
          detailPageCalls++;  // 计数详情页 API 调用
          
          // 检查是否是错误响应
          if (!detailHtml.includes('"ErrorCode"') && !detailHtml.includes('"StatusCode":4')) {
            const detailResult = parseDetailPage(detailHtml, searchResult.detailLink);
            
            if (detailResult) {
              // 合并搜索页面和详情页面的数据
              const mergedResult: SpfDetailResult = {
                ...searchResult,
                ...detailResult,
                // 保留搜索页面的某些字段（如果详情页面没有）
                name: detailResult.name || searchResult.name,
                age: detailResult.age || searchResult.age,
                phone: detailResult.phone || searchResult.phone,
                phoneType: detailResult.phoneType || searchResult.phoneType,
              };
              
              // 详情页获取后再次应用年龄过滤（因为详情页可能更新了年龄）
              if (!applyFilters(mergedResult, filters)) {
                console.log(`[SPF] 详情页后过滤: ${mergedResult.name}, 年龄 ${mergedResult.age} 不符合条件`);
                continue;
              }
              
              results.push(mergedResult);
              console.log(`[SPF] 详情页数据合并成功: ${mergedResult.name}, 婚姻: ${mergedResult.maritalStatus}, 邮箱: ${mergedResult.email}`);
              
              // 请求间延迟
              await new Promise(resolve => setTimeout(resolve, 1000));
              continue;
            }
          }
        } catch (detailError) {
          console.error(`[SPF] 获取详情页失败: ${searchResult.detailLink}`, detailError);
        }
      }
      
      // 如果不需要详情页或获取失败，使用搜索页面数据
      results.push(searchResult);
    }
    
    console.log(`[SPF] 搜索完成，返回 ${results.length} 个有效结果, 搜索页API: ${searchPageCalls}, 详情页API: ${detailPageCalls}`);
    
  } catch (error) {
    console.error(`[SPF] 搜索失败: ${name} ${location}`, error);
  }
  
  return { results, searchPageCalls, detailPageCalls };
}

/**
 * 批量搜索结果和 API 调用统计
 */
export interface BatchSearchResultWithStats {
  results: SpfDetailResult[];
  totalSearchPageCalls: number;
  totalDetailPageCalls: number;
}

/**
 * 批量搜索
 * 
 * @param fetchDetails - 是否获取详情页面（默认 true）
 */
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
  
  // 逐个搜索 (避免并发过高)
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
    
    // 请求间延迟
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

/**
 * 导出搜索结果为 CSV 格式
 * 
 * 简洁的 16 字段格式，参考 TPS 设计
 * 数据质量门槛：必须有年龄或电话才导出
 */
export function exportToCsv(results: SpfDetailResult[]): string {
  // 电话号码格式化函数：转换为 +1 格式
  const formatPhone = (phone: string): string => {
    if (!phone) return "";
    // 移除所有非数字字符
    const digits = phone.replace(/\D/g, "");
    // 如果是10位数字，添加+1前缀
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    // 如果是11位且以1开头，添加+前缀
    if (digits.length === 11 && digits.startsWith("1")) {
      return `+${digits}`;
    }
    // 其他情况返回原始数字
    return digits;
  };

  // 数据质量过滤：必须有年龄或电话
  const filteredResults = results.filter(r => r.age || r.phone);

  // 16 个核心字段
  const headers = [
    '姓名',
    '年龄',
    '城市',
    '州',
    '电话',
    '电话类型',
    '邮箱',
    '婚姻状态',
    '配偶姓名',
    '就业状态',
    '企业',
    '当前地址',
    '搜索姓名',
    '搜索地点',
    '缓存命中',
    '详情链接',
  ];
  
  const rows = filteredResults.map(r => [
    r.name || '',
    r.age?.toString() || '',
    r.city || '',
    r.state || '',
    formatPhone(r.phone || ''),
    r.phoneType || '',
    r.email || '',
    r.maritalStatus || '',
    r.spouseName || '',
    r.employment || '',
    r.businesses?.length ? r.businesses[0] : '',  // 第一个企业
    r.currentAddress || r.location || '',
    (r as any).searchName || '',
    (r as any).searchLocation || '',
    r.fromCache ? '是' : '否',
    r.detailLink ? `https://www.searchpeoplefree.com${r.detailLink.startsWith('/') ? '' : '/'}${r.detailLink}` : '',
  ]);
  
  // 添加 UTF-8 BOM 头以确保 Excel 正确识别中文
  const BOM = "\uFEFF";
  const csvContent = BOM + [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  
  return csvContent;
}
