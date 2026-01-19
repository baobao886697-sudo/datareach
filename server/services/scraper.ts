import axios from 'axios';
import { getConfig, logApi } from '../db';

const SCRAPE_DO_BASE = 'https://api.scrape.do';

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
}

export interface PersonToVerify {
  firstName: string;
  lastName: string;
  city?: string;
  state: string;
  phone: string;
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
 * 第一阶段验证：使用 TruePeopleSearch 进行电话号码反向搜索
 * 通过电话号码搜索，然后匹配姓名和地区
 */
export async function verifyWithTruePeopleSearch(person: PersonToVerify, userId?: number): Promise<VerificationResult> {
  const token = await getScrapeDoToken();
  const startTime = Date.now();

  // 清理电话号码，只保留数字
  const cleanPhone = person.phone.replace(/\D/g, '');
  
  // 使用电话号码反向搜索 URL
  const targetUrl = `https://www.truepeoplesearch.com/resultphone?phoneno=${cleanPhone}`;

  console.log(`[Scraper] TruePeopleSearch reverse lookup for phone: ${cleanPhone}`);

  try {
    const response = await axios.get(SCRAPE_DO_BASE, {
      params: { token, url: targetUrl, super: true, geoCode: 'us', render: true },
      timeout: 60000,
    });

    const responseTime = Date.now() - startTime;
    const html = response.data;
    const result = parseTruePeopleSearchReverseResult(html, person);

    await logApi('scrape_tps', targetUrl, { phone: cleanPhone }, response.status, responseTime, true, undefined, 0, userId);

    console.log(`[Scraper] TruePeopleSearch result: verified=${result.verified}, score=${result.matchScore}, age=${result.details?.age}`);

    return result;
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    console.error(`[Scraper] TruePeopleSearch error:`, error.message);
    await logApi('scrape_tps', targetUrl, { phone: cleanPhone }, error.response?.status || 0, responseTime, false, error.message, 0, userId);
    return { verified: false, source: 'TruePeopleSearch', matchScore: 0 };
  }
}

/**
 * 第二阶段验证：使用 FastPeopleSearch 进行电话号码反向搜索
 * 只有当第一阶段验证失败时才执行
 */
export async function verifyWithFastPeopleSearch(person: PersonToVerify, userId?: number): Promise<VerificationResult> {
  const token = await getScrapeDoToken();
  const startTime = Date.now();

  // 清理电话号码，只保留数字
  const cleanPhone = person.phone.replace(/\D/g, '');
  
  // 使用电话号码反向搜索 URL
  const targetUrl = `https://www.fastpeoplesearch.com/${cleanPhone}`;

  console.log(`[Scraper] FastPeopleSearch reverse lookup for phone: ${cleanPhone}`);

  try {
    const response = await axios.get(SCRAPE_DO_BASE, {
      params: { token, url: targetUrl, super: true, geoCode: 'us', render: true },
      timeout: 60000,
    });

    const responseTime = Date.now() - startTime;
    const html = response.data;
    const result = parseFastPeopleSearchReverseResult(html, person);

    await logApi('scrape_fps', targetUrl, { phone: cleanPhone }, response.status, responseTime, true, undefined, 0, userId);

    console.log(`[Scraper] FastPeopleSearch result: verified=${result.verified}, score=${result.matchScore}, age=${result.details?.age}`);

    return result;
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    console.error(`[Scraper] FastPeopleSearch error:`, error.message);
    await logApi('scrape_fps', targetUrl, { phone: cleanPhone }, error.response?.status || 0, responseTime, false, error.message, 0, userId);
    return { verified: false, source: 'FastPeopleSearch', matchScore: 0 };
  }
}

/**
 * 主验证函数：先尝试 TruePeopleSearch，失败后尝试 FastPeopleSearch
 */
export async function verifyPhoneNumber(person: PersonToVerify, userId?: number): Promise<VerificationResult> {
  console.log(`[Scraper] Starting phone verification for ${person.firstName} ${person.lastName}, phone: ${person.phone}`);
  
  // 第一阶段：TruePeopleSearch 电话号码反向搜索
  const tpsResult = await verifyWithTruePeopleSearch(person, userId);
  
  // 如果第一阶段验证成功（姓名和地区匹配），直接返回
  if (tpsResult.verified && tpsResult.matchScore >= 70) {
    console.log(`[Scraper] TruePeopleSearch verification passed`);
    return { ...tpsResult, source: 'TruePeopleSearch' };
  }

  // 第二阶段：FastPeopleSearch 电话号码反向搜索
  console.log(`[Scraper] TruePeopleSearch failed, trying FastPeopleSearch`);
  const fpsResult = await verifyWithFastPeopleSearch(person, userId);
  
  if (fpsResult.verified && fpsResult.matchScore >= 70) {
    console.log(`[Scraper] FastPeopleSearch verification passed`);
    return { ...fpsResult, source: 'FastPeopleSearch' };
  }

  // 返回分数较高的结果
  console.log(`[Scraper] Both verifications failed, returning best result`);
  return tpsResult.matchScore > fpsResult.matchScore ? tpsResult : fpsResult;
}

/**
 * 解析 TruePeopleSearch 电话号码反向搜索结果
 * 匹配姓名、州/城市，并提取年龄
 */
function parseTruePeopleSearchReverseResult(html: string, person: PersonToVerify): VerificationResult {
  const result: VerificationResult = { verified: false, source: 'TruePeopleSearch', matchScore: 0, details: {} };

  try {
    let score = 0;

    // 检查姓名匹配（姓和名都需要出现在页面中）
    const firstNamePattern = new RegExp(`\\b${escapeRegex(person.firstName)}\\b`, 'i');
    const lastNamePattern = new RegExp(`\\b${escapeRegex(person.lastName)}\\b`, 'i');
    
    const firstNameMatch = firstNamePattern.test(html);
    const lastNameMatch = lastNamePattern.test(html);
    
    if (firstNameMatch && lastNameMatch) {
      score += 40; // 姓名完全匹配
      result.verified = true;
      console.log(`[Scraper] Name matched: ${person.firstName} ${person.lastName}`);
    } else if (firstNameMatch || lastNameMatch) {
      score += 20; // 部分匹配
      console.log(`[Scraper] Partial name match: first=${firstNameMatch}, last=${lastNameMatch}`);
    } else {
      console.log(`[Scraper] Name not found in results`);
      return result; // 姓名完全不匹配，直接返回
    }

    // 检查州匹配
    const statePattern = new RegExp(`\\b${escapeRegex(person.state)}\\b`, 'i');
    if (statePattern.test(html)) {
      score += 30;
      result.details!.state = person.state;
      console.log(`[Scraper] State matched: ${person.state}`);
    }

    // 检查城市匹配
    if (person.city) {
      const cityPattern = new RegExp(`\\b${escapeRegex(person.city)}\\b`, 'i');
      if (cityPattern.test(html)) {
        score += 20;
        result.details!.city = person.city;
        console.log(`[Scraper] City matched: ${person.city}`);
      }
    }

    // 提取年龄 - 多种格式匹配
    const agePatterns = [
      /Age[:\s]*(\d{2,3})/i,
      /(\d{2,3})\s*years?\s*old/i,
      /Born[:\s]*\d{4}[^<]*?Age[:\s]*(\d{2,3})/i,
      /\((\d{2,3})\)/  // 括号中的年龄
    ];
    
    for (const pattern of agePatterns) {
      const ageMatch = html.match(pattern);
      if (ageMatch) {
        const age = parseInt(ageMatch[1], 10);
        if (age >= 18 && age <= 120) { // 合理的年龄范围
          result.details!.age = age;
          console.log(`[Scraper] Age found: ${age}`);
          break;
        }
      }
    }

    // 提取运营商信息
    const carrierMatch = html.match(/(?:Carrier|Provider|Network)[:\s]*([A-Za-z\s&]+?)(?:<|,|\n|$)/i);
    if (carrierMatch) {
      result.details!.carrier = carrierMatch[1].trim();
    }

    // 检测电话类型
    if (/mobile|cell|wireless/i.test(html)) result.phoneType = 'mobile';
    else if (/landline|home|residential/i.test(html)) result.phoneType = 'landline';
    else if (/voip/i.test(html)) result.phoneType = 'voip';

    result.matchScore = Math.min(score, 100);
    
    // 只有当姓名匹配且分数足够高时才算验证通过
    if (score < 70) {
      result.verified = false;
    }

  } catch (error) {
    console.error('[Scraper] Error parsing TruePeopleSearch result:', error);
  }

  return result;
}

/**
 * 解析 FastPeopleSearch 电话号码反向搜索结果
 * 匹配姓名、州/城市，并提取年龄
 */
function parseFastPeopleSearchReverseResult(html: string, person: PersonToVerify): VerificationResult {
  const result: VerificationResult = { verified: false, source: 'FastPeopleSearch', matchScore: 0, details: {} };

  try {
    let score = 0;

    // 检查姓名匹配
    const firstNamePattern = new RegExp(`\\b${escapeRegex(person.firstName)}\\b`, 'i');
    const lastNamePattern = new RegExp(`\\b${escapeRegex(person.lastName)}\\b`, 'i');
    
    const firstNameMatch = firstNamePattern.test(html);
    const lastNameMatch = lastNamePattern.test(html);
    
    if (firstNameMatch && lastNameMatch) {
      score += 40;
      result.verified = true;
      console.log(`[Scraper] FPS Name matched: ${person.firstName} ${person.lastName}`);
    } else if (firstNameMatch || lastNameMatch) {
      score += 20;
      console.log(`[Scraper] FPS Partial name match`);
    } else {
      console.log(`[Scraper] FPS Name not found`);
      return result;
    }

    // 检查州匹配
    const statePattern = new RegExp(`\\b${escapeRegex(person.state)}\\b`, 'i');
    if (statePattern.test(html)) {
      score += 30;
      result.details!.state = person.state;
    }

    // 检查城市匹配
    if (person.city) {
      const cityPattern = new RegExp(`\\b${escapeRegex(person.city)}\\b`, 'i');
      if (cityPattern.test(html)) {
        score += 20;
        result.details!.city = person.city;
      }
    }

    // 提取年龄
    const agePatterns = [
      /(\d{2,3})\s*years?\s*old/i,
      /Age[:\s]*(\d{2,3})/i,
      /\((\d{2,3})\)/
    ];
    
    for (const pattern of agePatterns) {
      const ageMatch = html.match(pattern);
      if (ageMatch) {
        const age = parseInt(ageMatch[1], 10);
        if (age >= 18 && age <= 120) {
          result.details!.age = age;
          break;
        }
      }
    }

    // 检测电话类型
    if (/mobile|cell|wireless/i.test(html)) result.phoneType = 'mobile';
    else if (/landline|home/i.test(html)) result.phoneType = 'landline';
    else if (/voip/i.test(html)) result.phoneType = 'voip';

    result.matchScore = Math.min(score, 100);
    
    if (score < 70) {
      result.verified = false;
    }

  } catch (error) {
    console.error('[Scraper] Error parsing FastPeopleSearch result:', error);
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
