/**
 * Bright Data 服务 - 精准搜索模式
 * 
 * 使用 Bright Data Web Scraper API 进行 LinkedIn 数据采集
 * 然后使用 People Data Labs 进行电话号码匹配
 */

import { LeadPerson, PhoneNumber } from './apify';
import { enrichWithPDL } from './pdl';
import { getConfig } from '../db';
import crypto from 'crypto';

// ============ 类型定义 ============

/**
 * Bright Data 返回的原始数据格式
 */
export interface BrightDataProfile {
  linkedin_url?: string;
  profile_url?: string;
  full_name?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  title?: string;
  location?: string;
  city?: string;
  state?: string;
  country?: string;
  summary?: string;
  current_company_name?: string;
  company?: string;
  organization_name?: string;
  current_company_linkedin_url?: string;
  current_job_title?: string;
  email?: string;
  phone?: string;
  industry?: string;
}

/**
 * PDL 丰富后的数据格式
 */
export interface PdlEnrichedProfile extends BrightDataProfile {
  phone_numbers?: string[];
  emails?: string[];
}

// Bright Data API 配置
// 环境变量作为备用
const ENV_BRIGHT_DATA_API_TOKEN = process.env.BRIGHT_DATA_API_KEY || process.env.BRIGHTDATA_API_KEY || '';
const BRIGHT_DATA_DATASET_ID = process.env.BRIGHT_DATA_DATASET_ID || 'gd_l1viktl72bvl7bjuj0'; // LinkedIn People 数据集 ID

// 获取 Bright Data API Token，优先从数据库配置读取，否则使用环境变量
async function getBrightDataApiToken(): Promise<string> {
  try {
    // 优先从数据库配置读取
    const dbApiKey = await getConfig('BRIGHT_DATA_API_KEY');
    if (dbApiKey) {
      console.log('[BrightData] Using API token from database config');
      return dbApiKey;
    }
  } catch (error) {
    console.error('[BrightData] Error getting API token from database:', error);
  }
  // 回退到环境变量
  if (ENV_BRIGHT_DATA_API_TOKEN) {
    console.log('[BrightData] Using API token from environment variable');
  }
  return ENV_BRIGHT_DATA_API_TOKEN;
}

interface BrightDataTriggerResponse {
  snapshot_id: string;
  status: string;
}

interface BrightDataSnapshotResponse {
  status: 'running' | 'ready' | 'failed';
  data?: BrightDataProfile[];
  error?: string;
}

// ============ Bright Data API 函数 ============

/**
 * 触发 Bright Data 数据采集任务
 */
async function triggerBrightDataCollection(
  searchName: string,
  searchTitle: string,
  searchState: string,
  limit: number
): Promise<string | null> {
  try {
    // 获取 API Token
    const apiToken = await getBrightDataApiToken();
    if (!apiToken) {
      console.error('[BrightData] API token not configured');
      return null;
    }
    
    // 构建搜索关键词
    const keyword = `${searchName} ${searchTitle} ${searchState}`;
    
    const params = new URLSearchParams({
      dataset_id: BRIGHT_DATA_DATASET_ID,
      type: 'discover_new',
      discover_by: 'keyword',
      limit_per_input: limit.toString(),
      format: 'json',
      include_errors: 'false',
    });

    const body = JSON.stringify([{
      keyword: keyword,
    }]);

    const response = await fetch(`https://api.brightdata.com/datasets/v3/trigger?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[BrightData] Trigger failed:', response.status, errorText);
      return null;
    }

    const result = await response.json() as BrightDataTriggerResponse;
    console.log('[BrightData] Collection triggered, snapshot_id:', result.snapshot_id);
    return result.snapshot_id;
  } catch (error) {
    console.error('[BrightData] Trigger error:', error);
    return null;
  }
}

/**
 * 轮询获取 Bright Data 采集结果
 */
async function pollBrightDataSnapshot(
  snapshotId: string,
  maxWaitMs: number = 180000, // 最长等待 3 分钟
  pollIntervalMs: number = 5000 // 每 5 秒轮询一次
): Promise<BrightDataProfile[]> {
  const startTime = Date.now();
  
  // 获取 API Token
  const apiToken = await getBrightDataApiToken();
  if (!apiToken) {
    console.error('[BrightData] API token not configured for polling');
    return [];
  }
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
        },
      });

      if (!response.ok) {
        console.error('[BrightData] Snapshot poll failed:', response.status);
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        continue;
      }

      const result = await response.json() as BrightDataSnapshotResponse;
      
      if (result.status === 'ready' && result.data) {
        console.log('[BrightData] Snapshot ready, records:', result.data.length);
        return result.data;
      } else if (result.status === 'failed') {
        console.error('[BrightData] Snapshot failed:', result.error);
        return [];
      }
      
      // 继续等待
      console.log('[BrightData] Snapshot status:', result.status, '- waiting...');
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    } catch (error) {
      console.error('[BrightData] Poll error:', error);
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  }
  
  console.error('[BrightData] Timeout waiting for snapshot');
  return [];
}

// ============ 工具函数 ============

/**
 * 生成唯一ID
 */
function generateLeadId(profile: BrightDataProfile): string {
  const linkedinUrl = profile.linkedin_url || profile.profile_url;
  if (linkedinUrl) {
    return crypto.createHash('md5').update(linkedinUrl).digest('hex');
  }
  const combined = `${profile.full_name || profile.name || ''}|${profile.current_company_name || profile.company || ''}|${profile.current_job_title || profile.title || ''}`.toLowerCase();
  return crypto.createHash('md5').update(combined).digest('hex');
}

/**
 * 解析位置字符串
 */
function parseLocation(location: string): { city: string; state: string; country: string } {
  const parts = location.split(',').map(p => p.trim());
  
  if (parts.length >= 3) {
    return {
      city: parts[0],
      state: parts[1],
      country: parts[2],
    };
  } else if (parts.length === 2) {
    return {
      city: parts[0],
      state: parts[1],
      country: 'United States',
    };
  } else {
    return {
      city: location,
      state: '',
      country: 'United States',
    };
  }
}

/**
 * 将 Bright Data 和 PDL 的数据转换为统一的 LeadPerson 格式
 */
function convertToLeadPerson(profile: PdlEnrichedProfile): LeadPerson {
  const id = generateLeadId(profile);
  
  // 解析姓名
  let firstName = profile.first_name || '';
  let lastName = profile.last_name || '';
  const fullName = profile.full_name || profile.name || '';
  
  if (!firstName && !lastName && fullName) {
    const nameParts = fullName.split(' ');
    firstName = nameParts[0] || '';
    lastName = nameParts.slice(1).join(' ') || '';
  }

  // 解析位置
  let city = profile.city || '';
  let state = profile.state || '';
  let country = profile.country || 'United States';
  
  if (profile.location && (!city || !state)) {
    const locationParts = parseLocation(profile.location);
    city = city || locationParts.city;
    state = state || locationParts.state;
    country = country || locationParts.country;
  }

  // 处理电话号码
  const phoneNumbers: PhoneNumber[] = [];
  
  // 从 PDL 丰富的电话号码
  if (profile.phone_numbers && profile.phone_numbers.length > 0) {
    profile.phone_numbers.forEach((phone, index) => {
      phoneNumbers.push({
        raw_number: phone,
        sanitized_number: phone.replace(/\D/g, ''),
        type: 'mobile',
        position: index,
      });
    });
  }
  
  // 从原始数据的电话号码
  if (profile.phone && phoneNumbers.length === 0) {
    phoneNumbers.push({
      raw_number: profile.phone,
      sanitized_number: profile.phone.replace(/\D/g, ''),
      type: 'mobile',
      position: 0,
    });
  }

  // 处理邮箱
  let email: string | null = null;
  if (profile.emails && profile.emails.length > 0) {
    email = profile.emails[0];
  } else if (profile.email) {
    email = profile.email;
  }

  // 处理公司名称
  const companyName = profile.current_company_name || profile.company || profile.organization_name || '';

  return {
    id,
    first_name: firstName,
    last_name: lastName,
    name: fullName || `${firstName} ${lastName}`.trim(),
    title: profile.current_job_title || profile.title || profile.headline || '',
    email: email,
    phone_numbers: phoneNumbers,
    linkedin_url: profile.linkedin_url || profile.profile_url || null,
    city: city || null,
    state: state || null,
    country: country || null,
    organization_name: companyName || null,
    organization: companyName ? {
      name: companyName,
      website_url: null,
      linkedin_url: profile.current_company_linkedin_url || null,
      industry: profile.industry || null,
      estimated_num_employees: null,
      total_funding: null,
      annual_revenue: null,
      founded_year: null,
    } : undefined,
    seniority: null,
    departments: [],
    source: 'brightdata',
  };
}

// ============ 主要 API 函数 ============

/**
 * 使用 Bright Data 搜索 LinkedIn 人员
 * 这是精准搜索的主入口函数
 */
export async function brightdataSearchPeople(
  searchName: string,
  searchTitle: string,
  searchState: string,
  limit: number
): Promise<LeadPerson[]> {
  console.log(`[BrightData] Starting exact search: ${searchName} | ${searchTitle} | ${searchState} | limit: ${limit}`);
  
  // 检查 API Token（优先从数据库配置读取）
  const apiToken = await getBrightDataApiToken();
  if (!apiToken) {
    console.error('[BrightData] API token not configured (neither in database config nor environment variables)');
    // 返回空数组，让系统优雅降级
    return [];
  }
  
  try {
    // 步骤 1: 触发数据采集
    const snapshotId = await triggerBrightDataCollection(searchName, searchTitle, searchState, limit);
    
    if (!snapshotId) {
      console.error('[BrightData] Failed to trigger collection');
      return [];
    }
    
    // 步骤 2: 轮询获取结果
    const profiles = await pollBrightDataSnapshot(snapshotId);
    
    if (profiles.length === 0) {
      console.log('[BrightData] No profiles found');
      return [];
    }
    
    // 步骤 3: 使用 PDL 丰富电话号码
    // PDL API Key 现在优先从数据库配置读取，在 enrichWithPDL 函数内部处理
    console.log('[BrightData] Enriching with PDL for phone numbers...');
    const enrichedProfiles = await enrichWithPDL(profiles);
    console.log(`[BrightData] PDL enrichment complete`);
    
    // 步骤 4: 转换为 LeadPerson 格式
    const leadPersons = enrichedProfiles.map(convertToLeadPerson);
    console.log(`[BrightData] Converted ${leadPersons.length} profiles to LeadPerson format`);
    
    return leadPersons;
  } catch (error) {
    console.error('[BrightData] Search error:', error);
    return [];
  }
}

/**
 * 检查 Bright Data 服务是否可用
 */
export async function checkBrightDataStatus(): Promise<boolean> {
  // 优先从数据库配置读取 API Token
  const apiToken = await getBrightDataApiToken();
  if (!apiToken) {
    return false;
  }
  
  try {
    const response = await fetch('https://api.brightdata.com/datasets/v3/datasets', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
      },
    });
    
    return response.ok;
  } catch (error) {
    console.error('[BrightData] Status check failed:', error);
    return false;
  }
}
