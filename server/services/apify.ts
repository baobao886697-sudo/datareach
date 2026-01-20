/**
 * Apify Leads Finder 服务模块
 * 
 * 替代 Apollo API，使用 Apify Leads Finder Actor 获取潜在客户数据
 * 
 * 优势：
 * 1. 成本更低：约 $1.5/千条 vs Apollo 的 $30-50/千条
 * 2. 一次性获取完整数据：包括姓名、邮箱、电话、公司信息
 * 3. 无需 Webhook：同步获取所有数据
 */

import { ApifyClient } from 'apify-client';
import { logApi, getConfig } from '../db';
import crypto from 'crypto';

// ============ 类型定义 ============

/**
 * Apify Leads Finder 返回的原始数据格式
 */
export interface ApifyLeadRaw {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  job_title?: string;
  email?: string;
  mobile_number?: string;
  phone_number?: string;
  linkedin?: string;
  linkedin_url?: string;
  company_name?: string;
  company_website?: string;
  company_linkedin?: string;
  company_industry?: string;
  industry?: string;
  company_size?: string;
  company_total_funding?: string;
  company_annual_revenue?: string;
  company_founded_year?: number;
  company_location?: string;
  person_location?: string;
  city?: string;
  state?: string;
  country?: string;
  seniority?: string;
  departments?: string[];
}

/**
 * 统一的 Lead 数据格式（兼容现有系统）
 */
export interface LeadPerson {
  id: string;                    // 生成的唯一ID
  first_name: string;
  last_name: string;
  name: string;                  // 全名
  title: string;                 // 职位
  email: string | null;
  phone_numbers: PhoneNumber[];  // 电话号码列表
  linkedin_url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  organization_name: string | null;
  organization?: {
    name: string | null;
    website_url: string | null;
    linkedin_url: string | null;
    industry: string | null;
    estimated_num_employees: string | null;
    total_funding: string | null;
    annual_revenue: string | null;
    founded_year: number | null;
  };
  seniority: string | null;
  departments: string[];
  // Apify 特有字段
  source: 'apify';
  rawData?: ApifyLeadRaw;
}

export interface PhoneNumber {
  raw_number: string;
  sanitized_number: string;
  type: 'mobile' | 'work' | 'other';
  position: number;
}

/**
 * 搜索参数
 */
export interface ApifySearchParams {
  jobTitles?: string[];
  locations?: string[];
  industries?: string[];
  companySizes?: string[];
  keywords?: string[];
  limit?: number;
}

/**
 * 搜索结果
 */
export interface ApifySearchResult {
  success: boolean;
  people: LeadPerson[];
  totalCount: number;
  errorMessage?: string;
  runId?: string;
  datasetId?: string;
}

// ============ 工具函数 ============

/**
 * 生成唯一ID
 * 使用 LinkedIn URL 或多字段组合的哈希值
 */
function generateLeadId(lead: ApifyLeadRaw): string {
  // 优先使用 LinkedIn URL
  const linkedinUrl = lead.linkedin || lead.linkedin_url;
  if (linkedinUrl) {
    return crypto.createHash('md5').update(linkedinUrl).digest('hex');
  }
  
  // 否则使用多字段组合
  const combined = [
    lead.first_name || '',
    lead.last_name || '',
    lead.email || '',
    lead.company_name || '',
    lead.job_title || ''
  ].join('|').toLowerCase();
  
  return crypto.createHash('md5').update(combined).digest('hex');
}

/**
 * 解析位置信息，提取城市和州
 */
function parseLocation(location: string | undefined): { city: string | null; state: string | null; country: string | null } {
  if (!location) {
    return { city: null, state: null, country: null };
  }
  
  // 常见格式: "Los Angeles, California, United States" 或 "Los Angeles, CA"
  const parts = location.split(',').map(p => p.trim());
  
  if (parts.length >= 3) {
    return {
      city: parts[0],
      state: parts[1],
      country: parts[2]
    };
  } else if (parts.length === 2) {
    // 可能是 "City, State" 或 "City, Country"
    const stateAbbreviations = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];
    const isState = stateAbbreviations.includes(parts[1].toUpperCase()) || parts[1].length > 2;
    
    return {
      city: parts[0],
      state: isState ? parts[1] : null,
      country: isState ? 'United States' : parts[1]
    };
  } else if (parts.length === 1) {
    return {
      city: parts[0],
      state: null,
      country: null
    };
  }
  
  return { city: null, state: null, country: null };
}

/**
 * 将 Apify 原始数据转换为统一的 LeadPerson 格式
 */
function convertToLeadPerson(raw: ApifyLeadRaw): LeadPerson {
  const id = generateLeadId(raw);
  
  // 解析位置
  const locationInfo = parseLocation(raw.person_location || raw.company_location);
  
  // 构建电话号码列表
  const phoneNumbers: PhoneNumber[] = [];
  
  if (raw.mobile_number) {
    const sanitized = raw.mobile_number.replace(/\D/g, '');
    phoneNumbers.push({
      raw_number: raw.mobile_number,
      sanitized_number: sanitized,
      type: 'mobile',
      position: 0
    });
  }
  
  if (raw.phone_number && raw.phone_number !== raw.mobile_number) {
    const sanitized = raw.phone_number.replace(/\D/g, '');
    phoneNumbers.push({
      raw_number: raw.phone_number,
      sanitized_number: sanitized,
      type: 'work',
      position: 1
    });
  }
  
  // 构建姓名
  const firstName = raw.first_name || '';
  const lastName = raw.last_name || '';
  const fullName = raw.full_name || `${firstName} ${lastName}`.trim();
  
  return {
    id,
    first_name: firstName,
    last_name: lastName,
    name: fullName,
    title: raw.job_title || '',
    email: raw.email || null,
    phone_numbers: phoneNumbers,
    linkedin_url: raw.linkedin || raw.linkedin_url || null,
    city: raw.city || locationInfo.city,
    state: raw.state || locationInfo.state,
    country: raw.country || locationInfo.country,
    organization_name: raw.company_name || null,
    organization: {
      name: raw.company_name || null,
      website_url: raw.company_website || null,
      linkedin_url: raw.company_linkedin || null,
      industry: raw.industry || raw.company_industry || null,
      estimated_num_employees: raw.company_size || null,
      total_funding: raw.company_total_funding || null,
      annual_revenue: raw.company_annual_revenue || null,
      founded_year: raw.company_founded_year || null
    },
    seniority: raw.seniority || null,
    departments: raw.departments || [],
    source: 'apify',
    rawData: raw
  };
}

/**
 * 将搜索参数转换为 Apify Actor 输入格式
 */
function buildActorInput(
  searchName: string,
  searchTitle: string,
  searchState: string,
  limit: number
): Record<string, any> {
  // Apify Leads Finder Actor 输入格式
  // 参考: https://apify.com/code_crafter/leads-finder
  
  const input: Record<string, any> = {
    // 搜索条件
    maxResults: limit,
    
    // 职位筛选
    jobTitles: searchTitle ? [searchTitle] : [],
    
    // 地区筛选 - 使用美国州名
    locations: searchState ? [searchState] : [],
    
    // 关键词搜索（用于姓名匹配）
    keywords: searchName ? [searchName] : [],
    
    // 输出选项
    includeEmail: true,
    includePhone: true,
    includeLinkedIn: true,
    includeCompanyInfo: true,
    
    // 代理设置
    proxyConfiguration: {
      useApifyProxy: true,
      apifyProxyGroups: ['RESIDENTIAL']
    }
  };
  
  return input;
}

// ============ 主要 API 函数 ============

/**
 * 获取 Apify API Token
 */
async function getApifyToken(): Promise<string> {
  // 优先从环境变量获取
  if (process.env.APIFY_API_TOKEN) {
    return process.env.APIFY_API_TOKEN;
  }
  
  // 从数据库配置获取
  const config = await getConfig('APIFY_API_TOKEN');
  if (config) {
    return config;
  }
  
  throw new Error('Apify API Token 未配置');
}

/**
 * 搜索人员 - 主要入口函数
 * 
 * @param searchName - 姓名关键词
 * @param searchTitle - 职位
 * @param searchState - 州/地区
 * @param limit - 返回数量限制
 * @param userId - 用户ID（用于日志）
 */
export async function searchPeople(
  searchName: string,
  searchTitle: string,
  searchState: string,
  limit: number = 50,
  userId?: number
): Promise<ApifySearchResult> {
  const startTime = Date.now();
  
  try {
    const token = await getApifyToken();
    const client = new ApifyClient({ token });
    
    // 构建 Actor 输入
    const actorInput = buildActorInput(searchName, searchTitle, searchState, limit);
    
    console.log(`[Apify] Starting search: name=${searchName}, title=${searchTitle}, state=${searchState}, limit=${limit}`);
    console.log(`[Apify] Actor input:`, JSON.stringify(actorInput));
    
    // 运行 Actor
    // Actor ID: code_crafter/leads-finder
    const run = await client.actor('code_crafter/leads-finder').call(actorInput, {
      waitSecs: 300, // 最多等待5分钟
    });
    
    console.log(`[Apify] Run completed: runId=${run.id}, status=${run.status}`);
    
    if (run.status !== 'SUCCEEDED') {
      throw new Error(`Apify Actor 运行失败: ${run.status}`);
    }
    
    // 获取结果数据
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    
    console.log(`[Apify] Retrieved ${items.length} items from dataset`);
    
    // 转换数据格式
    const people = items.map((item: any) => convertToLeadPerson(item as ApifyLeadRaw));
    
    const duration = Date.now() - startTime;
    
    // 记录 API 日志
    await logApi(
      'apify_search',
      '/actor/code_crafter/leads-finder',
      actorInput,
      200,
      duration,
      true,
      undefined,
      0,
      userId
    );
    
    console.log(`[Apify] Search completed: ${people.length} people found in ${duration}ms`);
    
    return {
      success: true,
      people,
      totalCount: people.length,
      runId: run.id,
      datasetId: run.defaultDatasetId
    };
    
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    console.error(`[Apify] Search error:`, error);
    
    // 记录错误日志
    await logApi(
      'apify_search',
      '/actor/code_crafter/leads-finder',
      { searchName, searchTitle, searchState, limit },
      500,
      duration,
      false,
      error.message,
      0,
      userId
    );
    
    return {
      success: false,
      people: [],
      totalCount: 0,
      errorMessage: error.message
    };
  }
}

/**
 * 获取单个人员的详细信息
 * 
 * 注意：Apify Leads Finder 在搜索时已经返回完整数据，
 * 这个函数主要用于兼容现有代码结构
 */
export async function enrichPerson(
  personId: string,
  userId?: number
): Promise<LeadPerson | null> {
  // Apify 搜索已经返回完整数据，不需要单独的 enrich 调用
  // 这个函数保留用于兼容性，实际上不会被调用
  console.log(`[Apify] enrichPerson called for ${personId} - no-op for Apify`);
  return null;
}

/**
 * 获取电话号码
 * 
 * 注意：Apify Leads Finder 在搜索时已经返回电话号码，
 * 这个函数主要用于兼容现有代码结构
 */
export async function getPhoneNumber(
  personId: string,
  userId?: number
): Promise<PhoneNumber[] | null> {
  // Apify 搜索已经返回电话号码，不需要单独获取
  console.log(`[Apify] getPhoneNumber called for ${personId} - no-op for Apify`);
  return null;
}

/**
 * 检查 Apify 服务状态
 */
export async function checkApifyStatus(): Promise<{ available: boolean; message: string }> {
  try {
    const token = await getApifyToken();
    const client = new ApifyClient({ token });
    
    // 获取用户信息验证 token 有效性
    const user = await client.user().get();
    
    return {
      available: true,
      message: `Apify 服务正常，用户: ${user?.username || 'unknown'}`
    };
  } catch (error: any) {
    return {
      available: false,
      message: `Apify 服务不可用: ${error.message}`
    };
  }
}

/**
 * 获取 Apify 账户使用情况
 */
export async function getApifyUsage(): Promise<{
  planName: string;
  usedCredits: number;
  maxCredits: number;
  usagePercentage: number;
} | null> {
  try {
    const token = await getApifyToken();
    const client = new ApifyClient({ token });
    
    const user = await client.user().get();
    
    // 注意：实际的使用情况可能需要通过其他 API 获取
    return {
      planName: (user?.plan as any)?.name || 'Unknown',
      usedCredits: 0, // 需要从 billing API 获取
      maxCredits: 0,
      usagePercentage: 0
    };
  } catch (error) {
    console.error('[Apify] Failed to get usage:', error);
    return null;
  }
}

// ============ 导出 ============

export default {
  searchPeople,
  enrichPerson,
  getPhoneNumber,
  checkApifyStatus,
  getApifyUsage
};
