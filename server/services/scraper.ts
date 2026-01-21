import axios from 'axios';
import { getConfig, logApi } from '../db';

const SCRAPE_DO_BASE = 'https://api.scrape.do';

// Scrape.do 优化配置
const SCRAPE_DO_CONFIG = {
  timeout: 15000,       // Scrape.do 请求超时 15 秒
  noRetry: true,        // 禁用 Scrape.do 内置重试，失败立即返回
  render: true,         // 启用无头浏览器渲染，确保获取完整页面内容
};

// 代码层重试配置（禁用，依赖 Scrape.do 内置重试）
const RETRY_CONFIG = {
  maxRetries: 0,        // 禁用代码层重试
  retryDelay: 1000,     // 重试间隔（毫秒）
  retryableErrors: [    // 可重试的错误类型（仅网络层错误）
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'ENETUNREACH',
    'EAI_AGAIN',
    'timeout',
    'Network Error',
  ],
};

// API 错误类型
export type ApiErrorType = 'INSUFFICIENT_CREDITS' | 'RATE_LIMITED' | 'NETWORK_ERROR' | 'UNKNOWN_ERROR' | null;

export interface VerificationResult {
  verified: boolean;
  source: 'TruePeopleSearch' | 'FastPeopleSearch' | 'none';
  matchScore: number;
  phoneNumber?: string;
  phoneType?: 'mobile' | 'landline' | 'voip' | 'unknown';
  carrier?: string;
  details?: {
    age?: number;
    city?: string;
    state?: string;
    carrier?: string;
    name?: string;
  };
  rawData?: any;
  apiError?: ApiErrorType; // 新增：API 错误类型
}

export interface PersonToVerify {
  firstName: string;
  lastName: string;
  city?: string;
  state: string;
  phone: string;
  minAge?: number;
  maxAge?: number;
}

async function getScrapeDoToken(): Promise<string> {
  // 支持两种配置名称
  let token = await getConfig('SCRAPE_DO_API_KEY');
  if (!token) {
    token = await getConfig('SCRAPE_DO_TOKEN');
  }
  if (!token) {
    throw new Error('Scrape.do API token not configured (SCRAPE_DO_API_KEY or SCRAPE_DO_TOKEN)');
  }
  return token;
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 判断错误是否可重试
 * 注意：502/503/429 错误由 Scrape.do 内置机制自动重试，代码层不再重试
 */
function isRetryableError(error: any): boolean {
  if (!error) return false;
  
  // 401 积分耗尽不可重试
  if (error.response?.status === 401) {
    return false;
  }
  
  // 502/503/429 由 Scrape.do 内置重试机制处理，代码层不重试
  if (error.response?.status >= 500 || error.response?.status === 429) {
    return false;
  }
  
  // 仅对网络层错误进行重试（当前已禁用，maxRetries=0）
  if (error.code && RETRY_CONFIG.retryableErrors.includes(error.code)) {
    return true;
  }
  
  // 检查错误消息
  if (error.message) {
    for (const retryableError of RETRY_CONFIG.retryableErrors) {
      if (error.message.includes(retryableError)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * 判断是否是 API 积分耗尽错误
 * Scrape.do 返回 401 表示积分耗尽或订阅已暂停
 */
function isInsufficientCreditsError(error: any): boolean {
  if (!error) return false;
  return error.response?.status === 401;
}

/**
 * 获取 API 错误类型
 */
function getApiErrorType(error: any): ApiErrorType {
  if (!error) return null;
  
  if (error.response?.status === 401) {
    return 'INSUFFICIENT_CREDITS';
  }
  if (error.response?.status === 429) {
    return 'RATE_LIMITED';
  }
  if (error.code && RETRY_CONFIG.retryableErrors.includes(error.code)) {
    return 'NETWORK_ERROR';
  }
  
  return 'UNKNOWN_ERROR';
}

/**
 * 格式化电话号码为带连字符的格式（用于 FastPeopleSearch）
 * 例如：4155480165 -> 415-548-0165
 */
function formatPhoneWithDashes(phone: string): string {
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length === 10) {
    return `${cleanPhone.slice(0, 3)}-${cleanPhone.slice(3, 6)}-${cleanPhone.slice(6)}`;
  } else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
    return `${cleanPhone.slice(1, 4)}-${cleanPhone.slice(4, 7)}-${cleanPhone.slice(7)}`;
  }
  return cleanPhone;
}

/**
 * 第一阶段验证：使用 TruePeopleSearch 进行电话号码反向搜索
 * URL 格式：https://www.truepeoplesearch.com/resultphone?phoneno=4155480165
 * 支持重试机制
 */
export async function verifyWithTruePeopleSearch(person: PersonToVerify, userId?: number): Promise<VerificationResult> {
  const token = await getScrapeDoToken();
  const cleanPhone = person.phone.replace(/\D/g, '');
  const targetUrl = `https://www.truepeoplesearch.com/resultphone?phoneno=${cleanPhone}`;

  console.log(`[Scraper] TruePeopleSearch reverse lookup for phone: ${cleanPhone}`);
  console.log(`[Scraper] Target URL: ${targetUrl}`);

  let lastError: any = null;
  
  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    const startTime = Date.now();
    
    try {
      if (attempt > 0) {
        console.log(`[Scraper] TruePeopleSearch retry attempt ${attempt}/${RETRY_CONFIG.maxRetries}`);
        await delay(RETRY_CONFIG.retryDelay);
      }
      
      const response = await axios.get(SCRAPE_DO_BASE, {
        params: { 
          token, 
          url: targetUrl, 
          super: true,                              // 使用住宅/移动代理
          geoCode: 'us',                            // 美国地区
          render: SCRAPE_DO_CONFIG.render,          // 关闭渲染提升速度
          timeout: SCRAPE_DO_CONFIG.timeout,        // 15秒超时
          noRetry: SCRAPE_DO_CONFIG.noRetry,        // 禁用重试
        },
        timeout: 20000,  // axios 超时 20 秒
      });

      const responseTime = Date.now() - startTime;
      const html = response.data;
      
      console.log(`[Scraper] TruePeopleSearch response received, length: ${html.length}`);
      
      const result = parseTruePeopleSearchReverseResult(html, person);

      await logApi('scrape_tps', targetUrl, { phone: cleanPhone, attempt }, response.status, responseTime, true, undefined, 0, userId);

      console.log(`[Scraper] TruePeopleSearch result: verified=${result.verified}, score=${result.matchScore}, age=${result.details?.age}, name=${result.details?.name}`);

      return result;
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      lastError = error;
      
      console.error(`[Scraper] TruePeopleSearch error (attempt ${attempt + 1}):`, error.message);
      
      // 如果是可重试的错误且还有重试次数，继续重试
      if (isRetryableError(error) && attempt < RETRY_CONFIG.maxRetries) {
        console.log(`[Scraper] Error is retryable, will retry after ${RETRY_CONFIG.retryDelay}ms`);
        continue;
      }
      
      // 检查是否是积分耗尽错误
      const apiError = getApiErrorType(error);
      if (apiError === 'INSUFFICIENT_CREDITS') {
        console.error(`[Scraper] TruePeopleSearch API credits exhausted!`);
        await logApi('scrape_tps', targetUrl, { phone: cleanPhone, attempt, apiError }, 401, responseTime, false, 'API credits exhausted', 0, userId);
        return { verified: false, source: 'TruePeopleSearch', matchScore: 0, apiError: 'INSUFFICIENT_CREDITS' };
      }
      
      // 不可重试或已用完重试次数
      await logApi('scrape_tps', targetUrl, { phone: cleanPhone, attempt, retried: attempt > 0 }, error.response?.status || 0, responseTime, false, error.message, 0, userId);
      return { verified: false, source: 'TruePeopleSearch', matchScore: 0, apiError };
    }
  }
  
  // 所有重试都失败
  return { verified: false, source: 'TruePeopleSearch', matchScore: 0 };
}

/**
 * 第二阶段验证：使用 FastPeopleSearch 进行电话号码反向搜索
 * URL 格式：https://www.fastpeoplesearch.com/415-548-0165（带连字符）
 * 支持重试机制
 */
export async function verifyWithFastPeopleSearch(person: PersonToVerify, userId?: number): Promise<VerificationResult> {
  const token = await getScrapeDoToken();
  const formattedPhone = formatPhoneWithDashes(person.phone);
  const targetUrl = `https://www.fastpeoplesearch.com/${formattedPhone}`;

  console.log(`[Scraper] FastPeopleSearch reverse lookup for phone: ${formattedPhone}`);
  console.log(`[Scraper] Target URL: ${targetUrl}`);

  let lastError: any = null;
  
  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    const startTime = Date.now();
    
    try {
      if (attempt > 0) {
        console.log(`[Scraper] FastPeopleSearch retry attempt ${attempt}/${RETRY_CONFIG.maxRetries}`);
        await delay(RETRY_CONFIG.retryDelay);
      }
      
      const response = await axios.get(SCRAPE_DO_BASE, {
        params: { 
          token, 
          url: targetUrl, 
          super: true,                              // 使用住宅/移动代理
          geoCode: 'us',                            // 美国地区
          render: SCRAPE_DO_CONFIG.render,          // 关闭渲染提升速度
          timeout: SCRAPE_DO_CONFIG.timeout,        // 15秒超时
          noRetry: SCRAPE_DO_CONFIG.noRetry,        // 禁用重试
        },
        timeout: 20000,  // axios 超时 20 秒
      });

      const responseTime = Date.now() - startTime;
      const html = response.data;
      
      console.log(`[Scraper] FastPeopleSearch response received, length: ${html.length}`);
      
      const result = parseFastPeopleSearchReverseResult(html, person);

      await logApi('scrape_fps', targetUrl, { phone: formattedPhone, attempt }, response.status, responseTime, true, undefined, 0, userId);

      console.log(`[Scraper] FastPeopleSearch result: verified=${result.verified}, score=${result.matchScore}, age=${result.details?.age}, name=${result.details?.name}`);

      return result;
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      lastError = error;
      
      console.error(`[Scraper] FastPeopleSearch error (attempt ${attempt + 1}):`, error.message);
      
      // 如果是可重试的错误且还有重试次数，继续重试
      if (isRetryableError(error) && attempt < RETRY_CONFIG.maxRetries) {
        console.log(`[Scraper] Error is retryable, will retry after ${RETRY_CONFIG.retryDelay}ms`);
        continue;
      }
      
      // 检查是否是积分耗尽错误
      const apiError = getApiErrorType(error);
      if (apiError === 'INSUFFICIENT_CREDITS') {
        console.error(`[Scraper] FastPeopleSearch API credits exhausted!`);
        await logApi('scrape_fps', targetUrl, { phone: formattedPhone, attempt, apiError }, 401, responseTime, false, 'API credits exhausted', 0, userId);
        return { verified: false, source: 'FastPeopleSearch', matchScore: 0, apiError: 'INSUFFICIENT_CREDITS' };
      }
      
      // 不可重试或已用完重试次数
      await logApi('scrape_fps', targetUrl, { phone: formattedPhone, attempt, retried: attempt > 0 }, error.response?.status || 0, responseTime, false, error.message, 0, userId);
      return { verified: false, source: 'FastPeopleSearch', matchScore: 0, apiError };
    }
  }
  
  // 所有重试都失败
  return { verified: false, source: 'FastPeopleSearch', matchScore: 0 };
}

/**
 * 主验证函数：先尝试 TruePeopleSearch，失败后尝试 FastPeopleSearch
 * 验证逻辑：
 * 1. 先调用 TruePeopleSearch
 * 2. 如果 TPS 验证成功（verified=true 且 matchScore>=60），直接返回
 * 3. 如果 TPS 失败，再调用 FastPeopleSearch
 * 4. 如果 FPS 验证成功，返回 FPS 结果
 * 5. 如果都失败，返回分数较高的结果
 */
export async function verifyPhoneNumber(person: PersonToVerify, userId?: number): Promise<VerificationResult> {
  console.log(`[Scraper] Starting phone verification for ${person.firstName} ${person.lastName}, phone: ${person.phone}`);
  console.log(`[Scraper] Age range: ${person.minAge || 'default'} - ${person.maxAge || 'default'}`);
  
  // 第一阶段：TruePeopleSearch 电话号码反向搜索
  const tpsResult = await verifyWithTruePeopleSearch(person, userId);
  
  // 如果 API 积分耗尽，立即返回错误
  if (tpsResult.apiError === 'INSUFFICIENT_CREDITS') {
    console.error(`[Scraper] API credits exhausted during TruePeopleSearch, stopping verification`);
    return tpsResult;
  }
  
  // 如果第一阶段验证成功（姓名匹配且年龄在范围内），直接返回
  if (tpsResult.verified && tpsResult.matchScore >= 60) {
    console.log(`[Scraper] TruePeopleSearch verification passed`);
    return { ...tpsResult, source: 'TruePeopleSearch' };
  }

  // 第二阶段：FastPeopleSearch 电话号码反向搜索
  console.log(`[Scraper] TruePeopleSearch failed (verified=${tpsResult.verified}, score=${tpsResult.matchScore}), trying FastPeopleSearch`);
  const fpsResult = await verifyWithFastPeopleSearch(person, userId);
  
  // 如果 API 积分耗尽，立即返回错误
  if (fpsResult.apiError === 'INSUFFICIENT_CREDITS') {
    console.error(`[Scraper] API credits exhausted during FastPeopleSearch, stopping verification`);
    return fpsResult;
  }
  
  if (fpsResult.verified && fpsResult.matchScore >= 60) {
    console.log(`[Scraper] FastPeopleSearch verification passed`);
    return { ...fpsResult, source: 'FastPeopleSearch' };
  }

  // 返回分数较高的结果
  console.log(`[Scraper] Both verifications failed, returning best result`);
  return tpsResult.matchScore > fpsResult.matchScore ? tpsResult : fpsResult;
}

/**
 * 解析 TruePeopleSearch 电话号码反向搜索结果
 * 页面结构：
 * - 姓名：<div class="content-header">John Coughlan</div>
 * - 年龄：<span class="">Age </span><span class="content-value">48</span>
 * - 地点：<span class="content-value">Redwood City, CA</span>
 */
function parseTruePeopleSearchReverseResult(html: string, person: PersonToVerify): VerificationResult {
  const result: VerificationResult = { verified: false, source: 'TruePeopleSearch', matchScore: 0, details: {} };

  try {
    let score = 0;

    // 提取页面中的所有姓名（从 content-header）
    const nameMatches = html.match(/<div[^>]*class="content-header"[^>]*>([^<]+)<\/div>/gi);
    const foundNames: string[] = [];
    if (nameMatches) {
      for (const match of nameMatches) {
        const nameMatch = match.match(/>([^<]+)</);
        if (nameMatch) {
          foundNames.push(nameMatch[1].trim());
        }
      }
    }
    
    console.log(`[Scraper] TPS found names: ${foundNames.join(', ')}`);

    // 检查是否有姓名匹配
    let nameMatched = false;
    let matchedName = '';
    for (const foundName of foundNames) {
      const nameLower = foundName.toLowerCase();
      const firstNameLower = person.firstName.toLowerCase();
      const lastNameLower = person.lastName.toLowerCase();
      
      if (nameLower.includes(firstNameLower) && nameLower.includes(lastNameLower)) {
        nameMatched = true;
        matchedName = foundName;
        score += 40;
        console.log(`[Scraper] TPS Name matched: ${foundName}`);
        break;
      }
    }

    if (!nameMatched) {
      console.log(`[Scraper] TPS No name match found for ${person.firstName} ${person.lastName}`);
      return result;
    }

    result.details!.name = matchedName;

    // 提取年龄
    // 格式：<span class="">Age </span><span class="content-value">48</span>
    const agePattern = /Age\s*<\/span>\s*<span[^>]*class="content-value"[^>]*>\s*(\d+)\s*<\/span>/i;
    const ageMatch = html.match(agePattern);
    
    if (!ageMatch) {
      // 备用模式
      const agePattern2 = /Age[:\s]*(\d{2,3})/i;
      const ageMatch2 = html.match(agePattern2);
      if (ageMatch2) {
        result.details!.age = parseInt(ageMatch2[1], 10);
      }
    } else {
      result.details!.age = parseInt(ageMatch[1], 10);
    }

    if (result.details!.age) {
      console.log(`[Scraper] TPS Age found: ${result.details!.age}`);
      
      // 检查年龄是否在范围内
      const minAge = person.minAge || 50;
      const maxAge = person.maxAge || 79;
      
      if (result.details!.age >= minAge && result.details!.age <= maxAge) {
        score += 30;
        console.log(`[Scraper] TPS Age ${result.details!.age} is within range ${minAge}-${maxAge}`);
      } else {
        console.log(`[Scraper] TPS Age ${result.details!.age} is outside range ${minAge}-${maxAge}, excluding`);
        result.verified = false;
        result.matchScore = score;
        return result;
      }
    }

    // 检查州匹配
    const statePattern = new RegExp(`\\b${escapeRegex(person.state)}\\b`, 'i');
    if (statePattern.test(html)) {
      score += 20;
      result.details!.state = person.state;
      console.log(`[Scraper] TPS State matched: ${person.state}`);
    }

    // 检查城市匹配
    if (person.city) {
      const cityPattern = new RegExp(`\\b${escapeRegex(person.city)}\\b`, 'i');
      if (cityPattern.test(html)) {
        score += 10;
        result.details!.city = person.city;
        console.log(`[Scraper] TPS City matched: ${person.city}`);
      }
    }

    // 检测电话类型
    if (/mobile|cell|wireless/i.test(html)) result.phoneType = 'mobile';
    else if (/landline|home|residential/i.test(html)) result.phoneType = 'landline';
    else if (/voip/i.test(html)) result.phoneType = 'voip';

    result.matchScore = Math.min(score, 100);
    
    // 姓名匹配且分数足够高时验证通过
    if (nameMatched && score >= 70) {
      result.verified = true;
    }

  } catch (error) {
    console.error('[Scraper] Error parsing TruePeopleSearch result:', error);
  }

  return result;
}

/**
 * 解析 FastPeopleSearch 电话号码反向搜索结果
 * 页面结构：
 * - 标题：<title>(415)548-0165 | John Coughlan in Washington, DC | Free Reverse Phone Lookup</title>
 * - 姓名：<span class="larger">John Coughlan</span>
 * - 年龄：<h3>Age:</h3> 48<br>
 * - 地点：<span class="grey">Washington, DC</span>
 */
function parseFastPeopleSearchReverseResult(html: string, person: PersonToVerify): VerificationResult {
  const result: VerificationResult = { verified: false, source: 'FastPeopleSearch', matchScore: 0, details: {} };

  try {
    let score = 0;

    // 从标题提取信息
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      console.log(`[Scraper] FPS Title: ${titleMatch[1]}`);
    }

    // 提取姓名（从 span.larger）
    const nameMatches = html.match(/<span[^>]*class="larger"[^>]*>([^<]+)<\/span>/gi);
    const foundNames: string[] = [];
    if (nameMatches) {
      for (const match of nameMatches) {
        const nameMatch = match.match(/>([^<]+)</);
        if (nameMatch) {
          foundNames.push(nameMatch[1].trim());
        }
      }
    }
    
    // 备用：从 card-title 提取
    if (foundNames.length === 0) {
      const cardTitleMatches = html.match(/<h2[^>]*class="card-title"[^>]*>[\s\S]*?<\/h2>/gi);
      if (cardTitleMatches) {
        for (const match of cardTitleMatches) {
          const nameMatch = match.match(/<span[^>]*>([^<]+)<\/span>/);
          if (nameMatch) {
            foundNames.push(nameMatch[1].trim());
          }
        }
      }
    }

    console.log(`[Scraper] FPS found names: ${foundNames.join(', ')}`);

    // 检查是否有姓名匹配
    let nameMatched = false;
    let matchedName = '';
    for (const foundName of foundNames) {
      const nameLower = foundName.toLowerCase();
      const firstNameLower = person.firstName.toLowerCase();
      const lastNameLower = person.lastName.toLowerCase();
      
      if (nameLower.includes(firstNameLower) && nameLower.includes(lastNameLower)) {
        nameMatched = true;
        matchedName = foundName;
        score += 40;
        console.log(`[Scraper] FPS Name matched: ${foundName}`);
        break;
      }
    }

    if (!nameMatched) {
      console.log(`[Scraper] FPS No name match found for ${person.firstName} ${person.lastName}`);
      return result;
    }

    result.details!.name = matchedName;

    // 提取年龄
    // 格式：<h3>Age:</h3> 48<br>
    const agePattern = /<h3>Age:<\/h3>\s*(\d+)/i;
    const ageMatch = html.match(agePattern);
    
    if (!ageMatch) {
      // 备用模式
      const agePattern2 = /Age[:\s]*(\d{2,3})/i;
      const ageMatch2 = html.match(agePattern2);
      if (ageMatch2) {
        result.details!.age = parseInt(ageMatch2[1], 10);
      }
    } else {
      result.details!.age = parseInt(ageMatch[1], 10);
    }

    if (result.details!.age) {
      console.log(`[Scraper] FPS Age found: ${result.details!.age}`);
      
      // 检查年龄是否在范围内
      const minAge = person.minAge || 50;
      const maxAge = person.maxAge || 79;
      
      if (result.details!.age >= minAge && result.details!.age <= maxAge) {
        score += 30;
        console.log(`[Scraper] FPS Age ${result.details!.age} is within range ${minAge}-${maxAge}`);
      } else {
        console.log(`[Scraper] FPS Age ${result.details!.age} is outside range ${minAge}-${maxAge}, excluding`);
        result.verified = false;
        result.matchScore = score;
        return result;
      }
    }

    // 检查州匹配
    const statePattern = new RegExp(`\\b${escapeRegex(person.state)}\\b`, 'i');
    if (statePattern.test(html)) {
      score += 20;
      result.details!.state = person.state;
      console.log(`[Scraper] FPS State matched: ${person.state}`);
    }

    // 检查城市匹配
    if (person.city) {
      const cityPattern = new RegExp(`\\b${escapeRegex(person.city)}\\b`, 'i');
      if (cityPattern.test(html)) {
        score += 10;
        result.details!.city = person.city;
        console.log(`[Scraper] FPS City matched: ${person.city}`);
      }
    }

    // 检测电话类型
    if (/mobile|cell|wireless/i.test(html)) result.phoneType = 'mobile';
    else if (/landline|home/i.test(html)) result.phoneType = 'landline';
    else if (/voip/i.test(html)) result.phoneType = 'voip';

    result.matchScore = Math.min(score, 100);
    
    // 姓名匹配且分数足够高时验证通过
    if (nameMatched && score >= 70) {
      result.verified = true;
    }

  } catch (error) {
    console.error('[Scraper] Error parsing FastPeopleSearch result:', error);
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
