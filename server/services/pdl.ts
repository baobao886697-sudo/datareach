/**
 * People Data Labs (PDL) 服务模块
 * 
 * 用于根据领英档案等信息，丰富联系人的手机号码。
 */

import { BrightDataProfile, PdlEnrichedProfile } from './brightdata';

// PDL API 配置
const PDL_API_BASE_URL = 'https://api.peopledatalabs.com/v5/person/enrich';
const CONCURRENT_LIMIT = 5; // 并发限制，避免触发 PDL 速率限制

/**
 * PDL API 返回的电话号码格式
 */
interface PdlPhone {
  number: string;
  first_seen?: string;
  last_seen?: string;
  num_sources?: number;
}

/**
 * PDL API 返回的邮箱格式
 */
interface PdlEmail {
  address: string;
  type?: string;
  first_seen?: string;
  last_seen?: string;
  num_sources?: number;
}

/**
 * PDL API 响应格式
 */
interface PdlResponse {
  status: number;
  likelihood: number;
  data?: {
    id?: string;
    full_name?: string;
    first_name?: string;
    last_name?: string;
    phones?: PdlPhone[];
    emails?: PdlEmail[];
    mobile_phone?: string;
    work_email?: string;
    personal_emails?: string[];
    linkedin_url?: string;
    linkedin_username?: string;
  };
  error?: {
    type: string;
    message: string;
  };
}

/**
 * 批量处理函数，控制并发数量
 */
async function processBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
    
    // 在批次之间添加小延迟，避免触发速率限制
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  return results;
}

/**
 * 使用 PDL API 丰富单个联系人信息
 */
async function enrichSingleProfile(
  profile: BrightDataProfile,
  apiKey: string
): Promise<PdlEnrichedProfile> {
  // 获取 LinkedIn URL
  const linkedinUrl = profile.linkedin_url || profile.profile_url;
  
  if (!linkedinUrl) {
    console.log('[PDL] No LinkedIn URL, skipping:', profile.full_name || profile.name);
    return { ...profile, phone_numbers: [], emails: [] };
  }

  try {
    // 构建请求参数 - PDL 使用 profile 参数（单个字符串，不是数组）
    const params = new URLSearchParams({
      profile: linkedinUrl,
      titlecase: 'true',
      pretty: 'false',
    });

    const response = await fetch(`${PDL_API_BASE_URL}?${params.toString()}`, {
      method: 'GET',
      headers: {
        'X-Api-Key': apiKey,
        'Accept': 'application/json',
      },
    });

    if (response.status === 200) {
      const result: PdlResponse = await response.json();
      
      // 提取电话号码
      const phoneNumbers: string[] = [];
      
      // 优先使用 mobile_phone
      if (result.data?.mobile_phone) {
        phoneNumbers.push(result.data.mobile_phone);
      }
      
      // 从 phones 数组中提取
      if (result.data?.phones && result.data.phones.length > 0) {
        for (const phone of result.data.phones) {
          if (phone.number && !phoneNumbers.includes(phone.number)) {
            phoneNumbers.push(phone.number);
          }
        }
      }
      
      // 提取邮箱
      const emails: string[] = [];
      
      // 优先使用 work_email
      if (result.data?.work_email) {
        emails.push(result.data.work_email);
      }
      
      // 从 personal_emails 中提取
      if (result.data?.personal_emails) {
        for (const email of result.data.personal_emails) {
          if (!emails.includes(email)) {
            emails.push(email);
          }
        }
      }
      
      // 从 emails 数组中提取
      if (result.data?.emails && result.data.emails.length > 0) {
        for (const emailObj of result.data.emails) {
          if (emailObj.address && !emails.includes(emailObj.address)) {
            emails.push(emailObj.address);
          }
        }
      }
      
      console.log(`[PDL] Enriched ${profile.full_name || profile.name}: ${phoneNumbers.length} phones, ${emails.length} emails`);
      
      return {
        ...profile,
        phone_numbers: phoneNumbers,
        emails: emails,
        // 如果原始数据缺少姓名，从 PDL 补充
        first_name: profile.first_name || result.data?.first_name,
        last_name: profile.last_name || result.data?.last_name,
        full_name: profile.full_name || result.data?.full_name,
      };
    } else if (response.status === 404) {
      // 未找到匹配的人员，这是正常情况
      console.log(`[PDL] No match found for: ${profile.full_name || profile.name}`);
      return { ...profile, phone_numbers: [], emails: [] };
    } else if (response.status === 402) {
      // 积分不足
      console.error('[PDL] Insufficient credits');
      return { ...profile, phone_numbers: [], emails: [] };
    } else if (response.status === 429) {
      // 速率限制
      console.error('[PDL] Rate limit exceeded');
      return { ...profile, phone_numbers: [], emails: [] };
    } else {
      const errorText = await response.text();
      console.error(`[PDL] API error for ${linkedinUrl}: ${response.status}`, errorText);
      return { ...profile, phone_numbers: [], emails: [] };
    }
  } catch (error: any) {
    console.error(`[PDL] Network error for ${linkedinUrl}:`, error.message);
    return { ...profile, phone_numbers: [], emails: [] };
  }
}

/**
 * 使用 PDL API 丰富联系人信息，主要是手机号
 * @param profiles - 从 Bright Data 获取的原始档案数组
 * @returns 丰富后的档案数组
 */
export async function enrichWithPDL(
  profiles: BrightDataProfile[]
): Promise<PdlEnrichedProfile[]> {
  const apiKey = process.env.PDL_API_KEY;

  if (!apiKey) {
    console.warn('[PDL] API key not found in environment variables (PDL_API_KEY). Skipping enrichment.');
    // 如果没有 API key，直接返回原始数据，仅转换类型
    return profiles.map(p => ({ ...p, phone_numbers: [], emails: [] }));
  }

  console.log(`[PDL] Starting enrichment for ${profiles.length} profiles (concurrent limit: ${CONCURRENT_LIMIT})`);

  // 使用批量处理，控制并发数量
  const enrichedProfiles = await processBatches(
    profiles,
    CONCURRENT_LIMIT,
    (profile) => enrichSingleProfile(profile, apiKey)
  );

  // 统计结果
  const withPhones = enrichedProfiles.filter(p => p.phone_numbers && p.phone_numbers.length > 0).length;
  const withEmails = enrichedProfiles.filter(p => p.emails && p.emails.length > 0).length;
  
  console.log(`[PDL] Enrichment complete: ${withPhones}/${profiles.length} with phones, ${withEmails}/${profiles.length} with emails`);

  return enrichedProfiles;
}

/**
 * 检查 PDL 服务是否可用
 */
export async function checkPDLStatus(): Promise<boolean> {
  const apiKey = process.env.PDL_API_KEY;
  
  if (!apiKey) {
    return false;
  }
  
  try {
    // 使用一个简单的测试请求检查 API 是否可用
    const response = await fetch('https://api.peopledatalabs.com/v5/person/enrich?profile=linkedin.com/in/test', {
      method: 'GET',
      headers: {
        'X-Api-Key': apiKey,
        'Accept': 'application/json',
      },
    });
    
    // 404 表示 API 正常工作，只是没找到这个测试用户
    return response.status === 200 || response.status === 404;
  } catch (error) {
    console.error('[PDL] Status check failed:', error);
    return false;
  }
}
