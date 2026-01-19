import axios from 'axios';
import { getConfig, logApi } from '../db';
import { getWebhookUrl, registerPendingPhoneRequest } from './apolloWebhook';
import crypto from 'crypto';

const APOLLO_API_BASE = 'https://api.apollo.io/api/v1';

export interface ApolloPerson {
  id: string;
  first_name: string;
  last_name: string;
  last_name_obfuscated?: string;
  name: string;
  title: string;
  organization_name?: string;
  city: string;
  state: string;
  country: string;
  linkedin_url: string;
  email: string;
  phone_numbers?: Array<{
    raw_number: string;
    sanitized_number: string;
    type: string;
    position: number;
    status: string;
  }>;
  organization?: {
    id?: string;
    name?: string;
    phone?: string;
    sanitized_phone?: string;
    industry?: string;
    primary_domain?: string;
  };
  organization_id?: string;
  has_email?: boolean;
  has_direct_phone?: string;
}

export interface ApolloSearchResult {
  success: boolean;
  people: ApolloPerson[];
  totalCount: number;
  errorMessage?: string;
}

async function getApolloApiKey(): Promise<string> {
  // 优先使用环境变量中的 API Key
  const envKey = process.env.APOLLO_API_KEY;
  if (envKey && envKey.trim()) {
    return envKey.trim();
  }
  // 其次从数据库配置读取
  const key = await getConfig('APOLLO_API_KEY');
  if (!key) throw new Error('Apollo API key not configured');
  return key;
}

// 生成职位变体，提高搜索命中率
function generateTitleVariants(title: string): string[] {
  const variants: string[] = [title.toLowerCase()];
  const titleLower = title.toLowerCase();
  
  // CEO 变体
  if (titleLower === 'ceo' || titleLower.includes('chief executive')) {
    variants.push('ceo', 'chief executive officer', 'chief executive');
  }
  // CFO 变体
  else if (titleLower === 'cfo' || titleLower.includes('chief financial')) {
    variants.push('cfo', 'chief financial officer', 'chief financial');
  }
  // CTO 变体
  else if (titleLower === 'cto' || titleLower.includes('chief technology')) {
    variants.push('cto', 'chief technology officer', 'chief technical officer');
  }
  // COO 变体
  else if (titleLower === 'coo' || titleLower.includes('chief operating')) {
    variants.push('coo', 'chief operating officer', 'chief operations officer');
  }
  // CMO 变体
  else if (titleLower === 'cmo' || titleLower.includes('chief marketing')) {
    variants.push('cmo', 'chief marketing officer');
  }
  // Director 变体
  else if (titleLower.includes('director')) {
    const base = titleLower.replace('director of ', '').replace('director, ', '').replace(' director', '');
    variants.push(
      titleLower,
      `director of ${base}`,
      `director, ${base}`,
      `${base} director`
    );
  }
  // VP 变体
  else if (titleLower.includes('vp') || titleLower.includes('vice president')) {
    const base = titleLower.replace('vp of ', '').replace('vp ', '').replace('vice president of ', '').replace('vice president ', '');
    variants.push(
      titleLower,
      `vp ${base}`,
      `vp of ${base}`,
      `vice president ${base}`,
      `vice president of ${base}`
    );
  }
  // Manager 变体
  else if (titleLower.includes('manager')) {
    const base = titleLower.replace('manager of ', '').replace('manager, ', '').replace(' manager', '');
    variants.push(
      titleLower,
      `${base} manager`,
      `manager of ${base}`,
      `manager, ${base}`
    );
  }
  // Owner 变体
  else if (titleLower === 'owner' || titleLower.includes('owner')) {
    variants.push('owner', 'business owner', 'company owner', 'founder', 'co-founder');
  }
  // President 变体
  else if (titleLower === 'president' || titleLower.includes('president')) {
    variants.push('president', 'company president', 'president & ceo');
  }
  
  // 去重
  return [...new Set(variants)];
}

// 格式化位置，确保包含国家代码
function formatLocation(state: string): string[] {
  // 美国州名映射
  const usStates: Record<string, string> = {
    'alabama': 'Alabama, US',
    'alaska': 'Alaska, US',
    'arizona': 'Arizona, US',
    'arkansas': 'Arkansas, US',
    'california': 'California, US',
    'colorado': 'Colorado, US',
    'connecticut': 'Connecticut, US',
    'delaware': 'Delaware, US',
    'florida': 'Florida, US',
    'georgia': 'Georgia, US',
    'hawaii': 'Hawaii, US',
    'idaho': 'Idaho, US',
    'illinois': 'Illinois, US',
    'indiana': 'Indiana, US',
    'iowa': 'Iowa, US',
    'kansas': 'Kansas, US',
    'kentucky': 'Kentucky, US',
    'louisiana': 'Louisiana, US',
    'maine': 'Maine, US',
    'maryland': 'Maryland, US',
    'massachusetts': 'Massachusetts, US',
    'michigan': 'Michigan, US',
    'minnesota': 'Minnesota, US',
    'mississippi': 'Mississippi, US',
    'missouri': 'Missouri, US',
    'montana': 'Montana, US',
    'nebraska': 'Nebraska, US',
    'nevada': 'Nevada, US',
    'new hampshire': 'New Hampshire, US',
    'new jersey': 'New Jersey, US',
    'new mexico': 'New Mexico, US',
    'new york': 'New York, US',
    'north carolina': 'North Carolina, US',
    'north dakota': 'North Dakota, US',
    'ohio': 'Ohio, US',
    'oklahoma': 'Oklahoma, US',
    'oregon': 'Oregon, US',
    'pennsylvania': 'Pennsylvania, US',
    'rhode island': 'Rhode Island, US',
    'south carolina': 'South Carolina, US',
    'south dakota': 'South Dakota, US',
    'tennessee': 'Tennessee, US',
    'texas': 'Texas, US',
    'utah': 'Utah, US',
    'vermont': 'Vermont, US',
    'virginia': 'Virginia, US',
    'washington': 'Washington, US',
    'west virginia': 'West Virginia, US',
    'wisconsin': 'Wisconsin, US',
    'wyoming': 'Wyoming, US',
  };
  
  const stateLower = state.toLowerCase().trim();
  
  // 如果已经包含国家代码，直接返回
  if (stateLower.includes(', us') || stateLower.includes(',us')) {
    return [state];
  }
  
  // 查找匹配的州名
  const formatted = usStates[stateLower];
  if (formatted) {
    return [formatted];
  }
  
  // 如果是美国，返回 United States
  if (stateLower === 'united states' || stateLower === 'usa' || stateLower === 'us') {
    return ['United States'];
  }
  
  // 默认添加 US 后缀
  return [`${state}, US`];
}

// 根据职位推断职级
function inferSeniorities(title: string): string[] {
  const titleLower = title.toLowerCase();
  const seniorities: string[] = [];
  
  if (titleLower.includes('ceo') || titleLower.includes('cfo') || titleLower.includes('cto') || 
      titleLower.includes('coo') || titleLower.includes('cmo') || titleLower.includes('chief')) {
    seniorities.push('c_suite');
  }
  if (titleLower.includes('owner') || titleLower.includes('founder')) {
    seniorities.push('owner', 'founder');
  }
  if (titleLower.includes('partner')) {
    seniorities.push('partner');
  }
  if (titleLower.includes('vp') || titleLower.includes('vice president')) {
    seniorities.push('vp');
  }
  if (titleLower.includes('head')) {
    seniorities.push('head');
  }
  if (titleLower.includes('director')) {
    seniorities.push('director');
  }
  if (titleLower.includes('manager')) {
    seniorities.push('manager');
  }
  if (titleLower.includes('senior') || titleLower.includes('sr.') || titleLower.includes('sr ')) {
    seniorities.push('senior');
  }
  if (titleLower.includes('president') && !titleLower.includes('vice')) {
    seniorities.push('c_suite');
  }
  
  return seniorities.length > 0 ? seniorities : [];
}

export async function searchPeople(
  name: string,
  title: string,
  state: string,
  limit: number = 100,
  userId?: number
): Promise<ApolloSearchResult> {
  const apiKey = await getApolloApiKey();
  const startTime = Date.now();

  try {
    // 生成职位变体
    const titleVariants = generateTitleVariants(title);
    // 格式化位置
    const locations = formatLocation(state);
    // 推断职级
    const seniorities = inferSeniorities(title);
    
    // 构建请求参数
    const params: Record<string, any> = {
      per_page: Math.min(limit, 100),
      page: 1,
    };
    
    // 添加职位筛选
    if (titleVariants.length > 0) {
      params.person_titles = titleVariants;
    }
    
    // 添加位置筛选
    if (locations.length > 0) {
      params.person_locations = locations;
    }
    
    // 添加职级筛选（如果能推断出来）
    if (seniorities.length > 0) {
      params.person_seniorities = seniorities;
    }
    
    // 如果有姓名，添加关键词搜索
    if (name && name.trim()) {
      params.q_keywords = name.trim();
    }
    
    console.log('[Apollo] Search params:', JSON.stringify(params, null, 2));
    
    const response = await axios.post(
      `${APOLLO_API_BASE}/mixed_people/api_search`,
      params,
      { 
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'x-api-key': apiKey  // 使用小写
        }, 
        timeout: 30000 
      }
    );

    const responseTime = Date.now() - startTime;
    const totalCount = response.data.pagination?.total_entries || response.data.total_entries || 0;
    
    console.log(`[Apollo] Search returned ${response.data.people?.length || 0} people, total: ${totalCount}`);
    
    await logApi('apollo_search', '/mixed_people/api_search', params, response.status, responseTime, true, undefined, 0, userId);

    return {
      success: true,
      people: response.data.people || [],
      totalCount: totalCount,
    };
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message;
    console.error('[Apollo] Search error:', errorMessage, error.response?.data);
    await logApi('apollo_search', '/mixed_people/api_search', { name, title, state }, error.response?.status || 0, responseTime, false, errorMessage, 0, userId);
    return { success: false, people: [], totalCount: 0, errorMessage };
  }
}

// 预览搜索 - 只获取总数，不消耗积分
export async function previewSearch(
  name: string,
  title: string,
  state: string,
  userId?: number
): Promise<{ success: boolean; totalCount: number; errorMessage?: string }> {
  const result = await searchPeople(name, title, state, 1, userId);
  return {
    success: result.success,
    totalCount: result.totalCount,
    errorMessage: result.errorMessage,
  };
}

// 同步获取人员详情（不包含电话号码）
export async function enrichPerson(personId: string, userId?: number): Promise<ApolloPerson | null> {
  const apiKey = await getApolloApiKey();
  const startTime = Date.now();

  console.log(`[enrichPerson] Starting enrich for personId: ${personId}`);

  try {
    const response = await axios.post(
      `${APOLLO_API_BASE}/people/match`,
      {
        id: personId,
        reveal_personal_emails: true
      },
      { 
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'x-api-key': apiKey
        }, 
        timeout: 30000 
      }
    );

    const responseTime = Date.now() - startTime;
    console.log(`[enrichPerson] Success for ${personId}, status: ${response.status}, has person: ${!!response.data.person}`);
    await logApi('apollo_enrich', '/people/match', { id: personId }, response.status, responseTime, true, undefined, 0, userId);

    return response.data.person || null;
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message;
    const errorStatus = error.response?.status || 0;
    const errorData = JSON.stringify(error.response?.data || {});
    console.error(`[enrichPerson] FAILED for ${personId}: status=${errorStatus}, error=${errorMessage}, data=${errorData}`);
    await logApi('apollo_enrich', '/people/match', { id: personId }, errorStatus, responseTime, false, errorMessage, 0, userId);
    return null;
  }
}

// 异步请求电话号码（通过 Webhook 返回）
export async function requestPhoneNumberAsync(
  personId: string,
  taskId: string,
  personData: any,
  userId?: number,
  ageFilter?: { min?: number; max?: number }
): Promise<boolean> {
  const apiKey = await getApolloApiKey();
  const startTime = Date.now();
  const webhookUrl = getWebhookUrl();
  const requestId = crypto.randomUUID();

  try {
    // 注册待处理请求（包含年龄筛选参数）
    registerPendingPhoneRequest(requestId, taskId, personId, personData, ageFilter);

    const response = await axios.post(
      `${APOLLO_API_BASE}/people/bulk_match`,
      {
        details: [{ id: personId }],
        reveal_phone_number: true,
        webhook_url: webhookUrl
      },
      { 
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'x-api-key': apiKey
        }, 
        timeout: 30000 
      }
    );

    const responseTime = Date.now() - startTime;
    await logApi('apollo_enrich', '/people/bulk_match', { id: personId, webhook: webhookUrl }, response.status, responseTime, true, undefined, 0, userId);

    return true;
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error.response?.data?.error || error.message;
    await logApi('apollo_enrich', '/people/bulk_match', { id: personId }, error.response?.status || 0, responseTime, false, errorMessage, 0, userId);
    return false;
  }
}

// 批量获取人员详情（同步，不包含电话号码）
export async function enrichPeopleBatch(peopleIds: string[], userId?: number): Promise<ApolloPerson[]> {
  const apiKey = await getApolloApiKey();
  const results: ApolloPerson[] = [];

  const shuffledIds = shuffleArray([...peopleIds]);
  const batchSize = 10;
  const batches = chunkArray(shuffledIds, batchSize);

  for (const batch of batches) {
    const startTime = Date.now();

    try {
      const response = await axios.post(
        `${APOLLO_API_BASE}/people/bulk_match`,
        {
          details: batch.map(id => ({ id })),
          reveal_personal_emails: true,
          // 不使用 reveal_phone_number，因为需要 webhook
        },
        { 
          headers: { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'x-api-key': apiKey
          }, 
          timeout: 60000 
        }
      );

      const responseTime = Date.now() - startTime;
      await logApi('apollo_enrich', '/people/bulk_match', { ids: batch }, response.status, responseTime, true, undefined, 0, userId);

      if (response.data.matches) {
        results.push(...response.data.matches);
      }
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error.response?.data?.error || error.message;
      await logApi('apollo_enrich', '/people/bulk_match', { ids: batch }, error.response?.status || 0, responseTime, false, errorMessage, 0, userId);
    }
  }

  return results;
}

// 使用公司电话作为备选方案
export function getOrganizationPhone(person: ApolloPerson): string | null {
  if (person.organization?.sanitized_phone) {
    return person.organization.sanitized_phone;
  }
  if (person.organization?.phone) {
    // 清理电话号码格式
    return person.organization.phone.replace(/[^\d+]/g, '');
  }
  return null;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}


// 获取公司行业信息
export interface OrganizationInfo {
  id: string;
  name: string;
  industry?: string;
  industries?: string[];
  primary_domain?: string;
}

export async function enrichOrganization(domain: string, userId?: number): Promise<OrganizationInfo | null> {
  const apiKey = await getApolloApiKey();
  const startTime = Date.now();

  try {
    const response = await axios.get(
      `${APOLLO_API_BASE}/organizations/enrich`,
      { 
        params: { domain },
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'x-api-key': apiKey
        }, 
        timeout: 30000 
      }
    );

    const responseTime = Date.now() - startTime;
    await logApi('apollo_enrich', '/organizations/enrich', { domain }, response.status, responseTime, true, undefined, 0, userId);

    const org = response.data.organization;
    if (org) {
      return {
        id: org.id,
        name: org.name,
        industry: org.industry,
        industries: org.industries,
        primary_domain: org.primary_domain,
      };
    }
    return null;
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error.response?.data?.error || error.message;
    await logApi('apollo_enrich', '/organizations/enrich', { domain }, error.response?.status || 0, responseTime, false, errorMessage, 0, userId);
    return null;
  }
}
