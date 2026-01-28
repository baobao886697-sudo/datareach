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
 */

import * as cheerio from 'cheerio';

// ==================== Scrape.do API ====================

const SCRAPE_TIMEOUT_MS = 30000;  // 30 秒超时 (SPF 页面较大，需要更长时间)
const SCRAPE_MAX_RETRIES = 3;    // 最多重试 3 次

/**
 * 使用 Scrape.do API 获取页面（带超时和重试）
 */
async function fetchWithScrapedo(url: string, token: string): Promise<string> {
  const encodedUrl = encodeURIComponent(url);
  // 使用 render=true 确保 JavaScript 渲染完成
  // 使用 super=true 启用住宅代理，提高成功率
  // 使用 playWithBrowser 模拟真实浏览器行为，等待页面完全加载并滚动
  const playWithBrowser = encodeURIComponent(JSON.stringify([
    { "Action": "Wait", "Timeout": 3000 },
    { "Action": "ScrollY", "Value": 500 },
    { "Action": "Wait", "Timeout": 2000 },
    { "Action": "ScrollY", "Value": 1000 },
    { "Action": "Wait", "Timeout": 2000 }
  ]));
  const apiUrl = `https://api.scrape.do/?token=${token}&url=${encodedUrl}&render=true&super=true&geoCode=us&playWithBrowser=${playWithBrowser}&timeout=${SCRAPE_TIMEOUT_MS}`;
  
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
        await new Promise(resolve => setTimeout(resolve, 3000)); // 等待 3 秒后重试
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError || new Error('请求失败');
}

// ==================== 配置常量 ====================

export const SPF_CONFIG = {
  TASK_CONCURRENCY: 4,      // 同时执行的搜索任务数
  SCRAPEDO_CONCURRENCY: 10, // 每个任务的 Scrape.do 并发数
  TOTAL_CONCURRENCY: 40,    // 总并发数
  MAX_SAFE_PAGES: 25,       // 最大搜索页数
  SEARCH_COST: 0.3,         // 搜索页成本
  DETAIL_COST: 0.3,         // 详情页成本
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
  birthYear?: string;           // ★ 出生年份 "1976 or 1975"
  city?: string;
  state?: string;
  location?: string;
  phone?: string;
  phoneType?: string;           // ★ "Home/LandLine" / "Wireless"
  carrier?: string;
  allPhones?: Array<{ number: string; type: string }>;
  reportYear?: number;
  isPrimary?: boolean;
  // ★ SPF 独特字段
  email?: string;               // 主邮箱
  allEmails?: string[];         // 所有邮箱
  maritalStatus?: string;       // 婚姻状态
  spouseName?: string;          // 配偶姓名
  spouseLink?: string;          // 配偶链接
  employment?: string;          // 就业状态
  confirmedDate?: string;       // 数据确认日期
  latitude?: number;            // 纬度
  longitude?: number;           // 经度
  // 其他字段
  familyMembers?: string[];
  associates?: string[];
  businesses?: string[];        // ★ 关联企业
  propertyValue?: number;
  yearBuilt?: number;
  isDeceased?: boolean;
  detailLink?: string;
  fromCache?: boolean;
}

export interface SpfFilters {
  minAge?: number;
  maxAge?: number;
  minYear?: number;
  minPropertyValue?: number;
  excludeTMobile?: boolean;
  excludeComcast?: boolean;
  excludeLandline?: boolean;
  excludeWireless?: boolean;    // ★ SPF 独特：可排除手机
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
 * SearchPeopleFree URL 格式: /find/{firstname}-{lastname}/{city}-{state}
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
function deduplicateByDetailLink(results: SpfSearchResult[]): SpfSearchResult[] {
  const seenLinks = new Set<string>();
  const uniqueResults: SpfSearchResult[] = [];
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
 * 输入: "Age 50 (1976 or 1975)"
 * 输出: { age: 50, birthYear: "1976 or 1975" }
 */
function parseAgeAndBirthYear(text: string): { age?: number; birthYear?: string } {
  const result: { age?: number; birthYear?: string } = {};
  
  // 提取年龄
  const ageMatch = text.match(/(?:Age\s*)?(\d+)/i);
  if (ageMatch) {
    result.age = parseInt(ageMatch[1], 10);
  }
  
  // 提取出生年份
  const birthYearMatch = text.match(/\(([^)]+)\)/);
  if (birthYearMatch) {
    result.birthYear = birthYearMatch[1].trim();
  }
  
  return result;
}

/**
 * 解析电话号码和类型
 * 输入: "(901) 465-1839" + "Home/LandLine Phone"
 * 输出: { number: "9014651839", type: "Landline" }
 */
function parsePhoneWithType(phoneText: string, typeText: string): { number: string; type: string } {
  // 清理电话号码
  const number = phoneText.replace(/[^\d]/g, '');
  
  // 标准化类型
  let type = 'Unknown';
  const typeLower = typeText.toLowerCase();
  if (typeLower.includes('wireless') || typeLower.includes('mobile') || typeLower.includes('cell')) {
    type = 'Wireless';
  } else if (typeLower.includes('landline') || typeLower.includes('home') || typeLower.includes('land')) {
    type = 'Landline';
  } else if (typeLower.includes('voip')) {
    type = 'VoIP';
  }
  
  return { number, type };
}

/**
 * 解析地理坐标
 * 从 Google Maps 链接或 location 链接中提取
 */
function parseCoordinates(html: string): { latitude?: number; longitude?: number } {
  const result: { latitude?: number; longitude?: number } = {};
  
  // 尝试从 location 链接提取: /location/41.388416,-81.793122
  const locationMatch = html.match(/\/location\/([-\d.]+),([-\d.]+)/);
  if (locationMatch) {
    result.latitude = parseFloat(locationMatch[1]);
    result.longitude = parseFloat(locationMatch[2]);
  }
  
  return result;
}

/**
 * 格式化电话号码为标准格式
 * 输入: 任意格式
 * 输出: 11位纯数字 (如 14102595378)
 */
function formatPhoneNumber(phone: string): string {
  if (!phone) return '';
  
  // 移除所有非数字字符
  const digits = phone.replace(/\D/g, '');
  
  // 如果是10位，加上1前缀
  if (digits.length === 10) {
    return `1${digits}`;
  }
  
  // 如果是11位且以1开头，直接返回
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits;
  }
  
  // 其他情况返回原始数字
  return digits;
}

// ==================== 搜索页面解析 ====================

/**
 * 解析搜索结果页面
 * SearchPeopleFree 搜索结果使用 <li class="toc l-i mb-5"> 和 <article> 结构
 */
export function parseSearchPage(html: string): SpfSearchResult[] {
  const $ = cheerio.load(html);
  const results: SpfSearchResult[] = [];
  
  // SPF 搜索结果结构: <li class="toc l-i mb-5"><article>...</article></li>
  // 每个结果包含: h2 (姓名和位置), h3 (年龄), 地址列表, 电话列表等
  
  $('li.toc.l-i.mb-5 article, li.toc article').each((_, articleEl) => {
    const article = $(articleEl);
    
    // 1. 提取姓名和详情链接
    const h2 = article.find('h2.h2').first();
    const nameLink = h2.find('a[href*="/find/"]').first();
    const name = nameLink.text().replace(/in\s+[A-Za-z,\s]+$/i, '').replace(/also\s+.*/i, '').trim();
    const detailLink = nameLink.attr('href') || '';
    
    if (!name || !detailLink) return;
    
    // 2. 提取位置 (从 h2 中的 span)
    const locationSpan = h2.find('span').first();
    let location = locationSpan.text().replace(/^in\s+/i, '').trim();
    
    // 3. 提取年龄
    const h3 = article.find('h3.mb-3').first();
    const ageText = h3.text();
    const ageMatch = ageText.match(/Age\s*(\d+)/i);
    const age = ageMatch ? parseInt(ageMatch[1], 10) : undefined;
    
    // 4. 检查是否已故
    const isDeceased = article.text().toLowerCase().includes('deceased');
    
    // 确保详情链接是完整 URL
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
  
  // 如果没有找到结果，尝试从 "More Free Details" 按钮获取
  if (results.length === 0) {
    $('a.btn-continue[href*="/find/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href) {
        const fullLink = href.startsWith('http') 
          ? href 
          : `https://www.searchpeoplefree.com${href}`;
        
        // 从 h1 获取姓名
        const h1Name = $('h1.highlight-letter').text().trim();
        
        results.push({
          name: h1Name || 'Unknown',
          location: '',
          detailLink: fullLink,
          isDeceased: false,
        });
      }
    });
  }
  
  // 同时查找页面上的其他相关人员链接 (在 "Also Known As" 或相关人员区域)
  $('a[href*="/find/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    
    // 排除导航链接、字母索引和已存在的链接
    if (href.includes('/find/') && 
        !href.includes('/find/popular') && 
        !href.includes('/find/john-smith') && // 排除当前搜索
        text.length > 3 &&
        !text.match(/^[A-Z]$/) &&
        text.match(/^[A-Z][a-z]+ [A-Z]/)) {
      
      const fullLink = href.startsWith('http') 
        ? href 
        : `https://www.searchpeoplefree.com${href}`;
      
      // 检查是否已存在
      const exists = results.some(r => r.detailLink === fullLink);
      if (!exists) {
        results.push({
          name: text,
          location: '',
          detailLink: fullLink,
          isDeceased: false,
        });
      }
    }
  });
  
  console.log(`[SPF parseSearchPage] 解析到 ${results.length} 个搜索结果`);
  return deduplicateByDetailLink(results);
}

// ==================== 详情页面解析 ====================

/**
 * 解析详情页面 - 提取所有 SPF 独特数据
 */
export function parseDetailPage(html: string, detailLink: string): SpfDetailResult | null {
  const $ = cheerio.load(html);
  const result: SpfDetailResult = {
    name: '',
    detailLink,
  };
  
  try {
    // 1. 解析姓名
    const nameElement = $('article.current-bg header p').first();
    result.name = nameElement.text().trim() || $('h1').first().text().replace(/living in.*$/i, '').trim();
    
    if (result.name) {
      const nameParts = result.name.split(' ');
      result.firstName = nameParts[0];
      result.lastName = nameParts[nameParts.length - 1];
    }
    
    // 2. 解析年龄和出生年份
    const currentSection = $('article.current-bg');
    const ageText = currentSection.text();
    const { age, birthYear } = parseAgeAndBirthYear(ageText);
    result.age = age;
    result.birthYear = birthYear;
    
    // 3. 解析数据确认日期
    const confirmedMatch = html.match(/Confirmed on ([A-Za-z]+ \d+, \d{4})/);
    if (confirmedMatch) {
      result.confirmedDate = confirmedMatch[1];
    }
    
    // 4. 解析电子邮件
    const emails: string[] = [];
    $('a[href*="/email/"]').each((_, el) => {
      const emailText = $(el).text().trim();
      if (emailText && emailText.includes('@')) {
        emails.push(emailText);
      }
    });
    if (emails.length > 0) {
      result.email = emails[0];
      result.allEmails = emails;
    }
    
    // 5. 解析婚姻状态和配偶
    const marriedMatch = html.match(/Married to\s*<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/i);
    if (marriedMatch) {
      result.maritalStatus = 'Married';
      result.spouseLink = marriedMatch[1].startsWith('http') ? marriedMatch[1] : `https://www.searchpeoplefree.com${marriedMatch[1]}`;
      result.spouseName = marriedMatch[2].trim();
    } else if (html.toLowerCase().includes('single')) {
      result.maritalStatus = 'Single';
    }
    
    // 6. 解析就业状态
    const employmentMatch = html.match(/\[([^\]]*employment[^\]]*)\]/i);
    if (employmentMatch) {
      result.employment = employmentMatch[1].trim();
    } else {
      // 尝试查找工作信息
      const workSection = currentSection.find('p:contains("works at"), p:contains("employed")');
      if (workSection.length > 0) {
        result.employment = workSection.text().trim();
      }
    }
    
    // 7. 解析电话号码和类型
    const phones: Array<{ number: string; type: string }> = [];
    $('a[href*="/phone-lookup/"]').each((_, el) => {
      const phoneText = $(el).text().trim();
      const parentText = $(el).parent().text();
      
      // 查找电话类型
      let phoneType = 'Unknown';
      if (parentText.toLowerCase().includes('wireless') || parentText.toLowerCase().includes('mobile')) {
        phoneType = 'Wireless';
      } else if (parentText.toLowerCase().includes('landline') || parentText.toLowerCase().includes('home')) {
        phoneType = 'Landline';
      }
      
      if (phoneText) {
        const cleanNumber = phoneText.replace(/[^\d]/g, '');
        if (cleanNumber.length >= 10) {
          phones.push({ number: formatPhoneNumber(cleanNumber), type: phoneType });
        }
      }
    });
    
    if (phones.length > 0) {
      result.phone = phones[0].number;
      result.phoneType = phones[0].type;
      result.allPhones = phones;
    }
    
    // 8. 解析地址和位置
    const addressLink = $('a[href*="/address/"]').first();
    if (addressLink.length > 0) {
      const addressText = addressLink.text().trim();
      result.location = addressText;
      
      // 解析城市和州
      const addressParts = addressText.split(',');
      if (addressParts.length >= 2) {
        result.city = addressParts[addressParts.length - 2].trim().split(' ').slice(0, -1).join(' ');
        const stateZip = addressParts[addressParts.length - 1].trim().split(' ');
        result.state = stateZip[0];
      }
    }
    
    // 9. 解析地理坐标
    const coords = parseCoordinates(html);
    result.latitude = coords.latitude;
    result.longitude = coords.longitude;
    
    // 10. 解析家庭成员
    const familyMembers: string[] = [];
    $('a[href*="/find/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim();
      const parentText = $(el).parent().parent().text().toLowerCase();
      
      if ((parentText.includes('family') || parentText.includes('relative')) && 
          text.match(/^[A-Z][a-z]+ [A-Z]/)) {
        familyMembers.push(text);
      }
    });
    result.familyMembers = familyMembers;
    
    // 11. 解析关联人
    const associates: string[] = [];
    $('a[href*="/find/"]').each((_, el) => {
      const text = $(el).text().trim();
      const parentText = $(el).parent().parent().text().toLowerCase();
      
      if (parentText.includes('associate') && text.match(/^[A-Z][a-z]+ [A-Z]/)) {
        associates.push(text);
      }
    });
    result.associates = associates;
    
    // 12. 解析企业关联
    const businesses: string[] = [];
    const businessSection = html.match(/businesses?[^<]*associated[^<]*with[^<]*:([^<]+)/i);
    if (businessSection) {
      // 提取企业名称
      const businessText = businessSection[1];
      const businessMatches = businessText.match(/[A-Z][A-Za-z\s&]+(?:Inc|LLC|Corp|Co)?/g);
      if (businessMatches) {
        businesses.push(...businessMatches.map(b => b.trim()));
      }
    }
    result.businesses = businesses;
    
    // 13. 检查是否已故
    result.isDeceased = html.toLowerCase().includes('deceased') || 
                        html.toLowerCase().includes('passed away');
    
    return result;
  } catch (error) {
    console.error('[SPF parseDetailPage] 解析错误:', error);
    return null;
  }
}

// ==================== 主搜索函数 ====================

/**
 * 执行搜索并获取详情
 */
export async function searchAndGetDetails(
  name: string,
  location: string,
  token: string,
  filters: SpfFilters = {}
): Promise<SpfDetailResult[]> {
  const results: SpfDetailResult[] = [];
  
  try {
    // 构建搜索 URL
    const searchUrl = buildSearchUrl(name, location);
    console.log(`[SPF] 搜索: ${searchUrl}`);
    
    // 获取页面
    const html = await fetchWithScrapedo(searchUrl, token);
    
    // 解析详情（SPF 搜索页面直接显示详情）
    const detail = parseDetailPage(html, searchUrl);
    
    if (detail && detail.name) {
      // 应用过滤器
      if (filters.minAge && detail.age && detail.age < filters.minAge) {
        console.log(`[SPF] 跳过 ${detail.name}: 年龄 ${detail.age} < ${filters.minAge}`);
        return results;
      }
      
      if (filters.maxAge && detail.age && detail.age > filters.maxAge) {
        console.log(`[SPF] 跳过 ${detail.name}: 年龄 ${detail.age} > ${filters.maxAge}`);
        return results;
      }
      
      if (filters.excludeLandline && detail.phoneType === 'Landline') {
        console.log(`[SPF] 跳过 ${detail.name}: 排除座机`);
        return results;
      }
      
      if (filters.excludeWireless && detail.phoneType === 'Wireless') {
        console.log(`[SPF] 跳过 ${detail.name}: 排除手机`);
        return results;
      }
      
      results.push(detail);
    }
    
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
  const tasks: Array<{ name: string; location: string }> = [];
  
  // 生成所有搜索组合
  for (const name of names) {
    if (locations.length > 0) {
      for (const location of locations) {
        tasks.push({ name, location });
      }
    } else {
      tasks.push({ name, location: '' });
    }
  }
  
  const total = tasks.length;
  let completed = 0;
  
  // 并发执行搜索
  const concurrency = SPF_CONFIG.SCRAPEDO_CONCURRENCY;
  
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    
    const batchResults = await Promise.all(
      batch.map(async (task) => {
        try {
          return await searchAndGetDetails(task.name, task.location, token, filters);
        } catch (error) {
          console.error(`[SPF] 批量搜索错误: ${task.name}`, error);
          return [];
        }
      })
    );
    
    for (const results of batchResults) {
      allResults.push(...results);
      completed++;
      onProgress?.(completed, total);
    }
    
    // 批次间延迟
    if (i + concurrency < tasks.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  return allResults;
}
