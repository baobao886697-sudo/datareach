/**
 * SearchPeopleFree (SPF) 网页抓取模块
 * 
 * 数据亮点：
 * - 电子邮件信息
 * - 电话类型标注 (座机/手机)
 * - 婚姻状态和配偶信息
 * - 就业状态
 * - 数据确认日期
 * - 地理坐标
 * 
 * 重要说明：
 * 根据 Scrape.do 技术支持建议，SearchPeopleFree 不支持 render=true
 * 搜索页面已包含完整的详细信息，无需访问详情页面
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
      
      if (!response.ok) {
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
      
      if (isTimeout || isNetworkError) {
        console.log(`[SPF fetchWithScrapedo] 请求超时/失败，正在重试 (${attempt + 1}/${SCRAPE_MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
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
  SEARCH_COST: 0.8,  // 搜索页成本 (包含完整数据)
  DETAIL_COST: 0,    // 不再需要详情页
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
  allPhones?: Array<{ number: string; type: string }>;
  reportYear?: number;
  isPrimary?: boolean;
  email?: string;
  allEmails?: string[];
  maritalStatus?: string;
  spouseName?: string;
  spouseLink?: string;
  employment?: string;
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
 * 
 * HTML 结构:
 * <li class="toc l-i mb-5">
 *   <article>
 *     <h2 class="h2">
 *       <a href="/find/john-smith/27Ob2fkq8DOF">
 *         John Smith
 *         <span>in Brook Park, OH</span>
 *         <span class="d-block d-md-inline"><b class="text-aka">also</b> John Morris</span>
 *       </a>
 *     </h2>
 *     <h3 class="mb-3">Age <span>50 <i class="text-muted">(1976 or 1975)</i></span></h3>
 *     <i class="text-muted">Home address...</i>
 *     <ul class="inline current row mb-3">
 *       <li class="col-lg-6">
 *         <address><a href="...">123 Main St, City, ST 12345</a><i class="text-highlight ml-1">-Current</i></address>
 *       </li>
 *     </ul>
 *     <i class="text-muted">Home telephone number...</i>
 *     <ul class="inline current row mb-3">
 *       <li class="col-md-6 col-lg-4">
 *         <h4><a href="...">(123) 456-7890</a><i class="text-highlight"> - LandLine</i></h4>
 *       </li>
 *     </ul>
 *     <i class="text-muted">Spouse, partner, mother, father...</i>
 *     <ul class="inline row mb-3">
 *       <li class="col-md-6 col-lg-4"><a href="...">Jane Smith</a></li>
 *     </ul>
 *   </article>
 * </li>
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

// ==================== 详情页面解析 (保留但不再主要使用) ====================

/**
 * 解析详情页面 - 保留用于可能的未来使用
 */
export function parseDetailPage(html: string, detailLink: string): SpfDetailResult | null {
  // 由于详情页面无法访问，此函数暂时返回 null
  // 所有数据现在从搜索页面提取
  console.log('[SPF parseDetailPage] 详情页面解析已禁用，使用搜索页面数据');
  return null;
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
 * 执行搜索并获取详情
 * 
 * 新流程 (无需访问详情页面):
 * 1. 获取搜索页面 (/find/john-smith)
 * 2. 直接从搜索页面提取完整数据
 * 3. 应用过滤器
 * 4. 返回结果
 */
export async function searchAndGetDetails(
  name: string,
  location: string,
  token: string,
  filters: SpfFilters = {},
  maxResults: number = 10
): Promise<SpfDetailResult[]> {
  const results: SpfDetailResult[] = [];
  
  try {
    // 1. 构建搜索 URL
    const searchUrl = buildSearchUrl(name, location);
    console.log(`[SPF] 搜索: ${searchUrl}`);
    
    // 2. 获取搜索页面 HTML
    const searchHtml = await fetchWithScrapedo(searchUrl, token);
    console.log(`[SPF] 获取搜索页面成功，大小: ${searchHtml.length} bytes`);
    
    // 检查是否是错误响应
    if (searchHtml.includes('"ErrorCode"') || searchHtml.includes('"StatusCode":4') || searchHtml.includes('"StatusCode":5')) {
      console.error(`[SPF] API 返回错误: ${searchHtml.substring(0, 500)}`);
      return results;
    }
    
    // 3. 直接从搜索页面提取完整数据
    const fullResults = parseSearchPageFull(searchHtml);
    console.log(`[SPF] 解析到 ${fullResults.length} 个完整结果`);
    
    if (fullResults.length === 0) {
      console.log(`[SPF] 未找到匹配结果: ${name} ${location}`);
      return results;
    }
    
    // 4. 应用过滤器并限制结果数量
    for (const detail of fullResults) {
      if (results.length >= maxResults) break;
      
      if (applyFilters(detail, filters)) {
        results.push(detail);
      }
    }
    
    console.log(`[SPF] 搜索完成，返回 ${results.length} 个有效结果`);
    
  } catch (error) {
    console.error(`[SPF] 搜索失败: ${name} ${location}`, error);
  }
  
  return results;
}

/**
 * 批量搜索
 */
export async function batchSearch(
  names: string[],
  locations: string[],
  token: string,
  filters: SpfFilters = {},
  onProgress?: (completed: number, total: number) => void
): Promise<SpfDetailResult[]> {
  const allResults: SpfDetailResult[] = [];
  const total = names.length;
  let completed = 0;
  
  // 逐个搜索 (避免并发过高)
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const location = locations[i] || '';
    
    try {
      const results = await searchAndGetDetails(name, location, token, filters);
      allResults.push(...results);
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
  
  return deduplicateByDetailLink(allResults);
}

/**
 * 导出搜索结果为 CSV 格式
 */
export function exportToCsv(results: SpfDetailResult[]): string {
  const headers = [
    'Name',
    'First Name',
    'Last Name',
    'Age',
    'Birth Year',
    'Location',
    'City',
    'State',
    'Phone',
    'Phone Type',
    'All Phones',
    'Current Address',
    'All Addresses',
    'Family Members',
    'Associates',
    'Also Known As',
    'Is Deceased',
    'Detail Link',
  ];
  
  const rows = results.map(r => [
    r.name || '',
    r.firstName || '',
    r.lastName || '',
    r.age?.toString() || '',
    r.birthYear || '',
    r.location || '',
    r.city || '',
    r.state || '',
    r.phone || '',
    r.phoneType || '',
    r.allPhones?.map(p => `${p.number}(${p.type})`).join('; ') || '',
    r.currentAddress || '',
    r.addresses?.join('; ') || '',
    r.familyMembers?.join('; ') || '',
    r.associates?.join('; ') || '',
    r.alsoKnownAs?.join('; ') || '',
    r.isDeceased ? 'Yes' : 'No',
    r.detailLink || '',
  ]);
  
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  
  return csvContent;
}
