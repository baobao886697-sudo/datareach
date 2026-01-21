# LeadHunter Pro API 调用逻辑详细分析

## 一、API 服务概述

LeadHunter Pro 使用两个主要的外部 API 服务：

| 服务 | 用途 | API 密钥配置 |
|------|------|--------------|
| Apify | 获取潜在客户数据 | APOLLO_API_KEY |
| Scrape.do | 电话号码验证 | SCRAPE_DO_API_KEY |

---

## 二、Apify API 调用

### 2.1 服务配置 (apify.ts)

```typescript
import { ApifyClient } from 'apify-client';

// Actor ID
const LEADS_FINDER_ACTOR = 'code_crafter/leads-finder';

// 获取 API Token
async function getApifyToken(): Promise<string> {
  // 优先使用环境变量
  if (process.env.APIFY_API_TOKEN) {
    return process.env.APIFY_API_TOKEN;
  }
  
  // 其次使用数据库配置
  const token = await getConfig('APOLLO_API_KEY');
  if (!token) {
    throw new Error('Apify API token not configured');
  }
  return token;
}
```

### 2.2 搜索函数 (apify.ts)

```typescript
export async function searchPeople(
  searchName: string,
  searchTitle: string,
  searchState: string,
  limit: number = 100,
  userId?: number
): Promise<ApifySearchResult> {
  const startTime = Date.now();
  
  try {
    const token = await getApifyToken();
    const client = new ApifyClient({ token });
    
    // 构建 Actor 输入参数
    const actorInput = buildActorInput(searchName, searchTitle, searchState, limit);
    
    console.log('[Apify] Starting search with input:', JSON.stringify(actorInput, null, 2));
    
    // 运行 Actor
    const run = await client.actor(LEADS_FINDER_ACTOR).call(actorInput, {
      waitSecs: 300,  // 最多等待 5 分钟
    });
    
    console.log(`[Apify] Run completed, status: ${run.status}`);
    
    // 获取结果数据
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    
    console.log(`[Apify] Retrieved ${items.length} items from dataset`);
    
    // 转换数据格式
    const people = items.map((item: any) => convertToLeadPerson(item as ApifyLeadRaw));
    
    const responseTime = Date.now() - startTime;
    
    // 记录 API 调用日志
    await logApi(
      'apify_search',
      LEADS_FINDER_ACTOR,
      actorInput,
      200,
      responseTime,
      true,
      undefined,
      0,
      userId
    );
    
    return {
      success: true,
      people,
      totalCount: people.length,
    };
    
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    
    console.error('[Apify] Search error:', error.message);
    
    // 记录错误日志
    await logApi(
      'apify_search',
      LEADS_FINDER_ACTOR,
      { searchName, searchTitle, searchState, limit },
      error.response?.status || 500,
      responseTime,
      false,
      error.message,
      0,
      userId
    );
    
    return {
      success: false,
      people: [],
      totalCount: 0,
      error: error.message,
    };
  }
}
```

### 2.3 Actor 输入参数构建

```typescript
// 州名到 Apify 地区格式的映射
const STATE_TO_APIFY_LOCATION: Record<string, string> = {
  'Alabama': 'alabama, us',
  'Alaska': 'alaska, us',
  'Arizona': 'arizona, us',
  'California': 'california, us',
  // ... 其他州
};

function buildActorInput(
  searchName: string,
  searchTitle: string,
  searchState: string,
  limit: number
): Record<string, any> {
  const input: Record<string, any> = {
    fetch_count: limit,
    file_name: `LeadHunter_${searchTitle}_${searchState}_${Date.now()}`,
  };
  
  // 职位筛选
  if (searchTitle && searchTitle.trim()) {
    input.contact_job_title = [searchTitle.trim()];
  }
  
  // 地区筛选
  if (searchState && searchState.trim()) {
    const apifyLocation = STATE_TO_APIFY_LOCATION[searchState.trim()] 
      || `${searchState.trim().toLowerCase()}, us`;
    input.contact_location = [apifyLocation];
  }
  
  // 注意：searchName 参数未使用，因为 Apify Leads Finder 不支持按人名搜索
  
  return input;
}
```

### 2.4 数据格式转换

```typescript
// Apify 原始数据格式
interface ApifyLeadRaw {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  organization_name?: string;
  city?: string;
  state?: string;
  country?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
}

// 转换后的格式
interface LeadPerson {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  title: string;
  company: string;
  city: string;
  state: string;
  country: string;
  email: string;
  phone: string;
  linkedinUrl: string;
}

function convertToLeadPerson(raw: ApifyLeadRaw): LeadPerson {
  const firstName = raw.first_name || '';
  const lastName = raw.last_name || '';
  const fullName = raw.name || `${firstName} ${lastName}`.trim();
  
  return {
    id: raw.id || crypto.randomUUID(),
    firstName,
    lastName,
    fullName,
    title: raw.title || '',
    company: raw.organization_name || '',
    city: raw.city || '',
    state: raw.state || '',
    country: raw.country || 'United States',
    email: raw.email || '',
    phone: raw.phone || '',
    linkedinUrl: raw.linkedin_url || '',
  };
}
```

---

## 三、Scrape.do API 调用

### 3.1 服务配置 (scraper.ts)

```typescript
const SCRAPE_DO_BASE = 'https://api.scrape.do';

// 重试配置
const RETRY_CONFIG = {
  maxRetries: 1,        // 最大重试次数
  retryDelay: 2000,     // 重试间隔（毫秒）
  retryableErrors: [    // 可重试的错误类型
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

// 获取 API Token
async function getScrapeDoToken(): Promise<string> {
  let token = await getConfig('SCRAPE_DO_API_KEY');
  if (!token) {
    token = await getConfig('SCRAPE_DO_TOKEN');
  }
  if (!token) {
    throw new Error('Scrape.do API token not configured');
  }
  return token;
}
```

### 3.2 TruePeopleSearch 验证

```typescript
export async function verifyWithTruePeopleSearch(
  person: PersonToVerify, 
  userId?: number
): Promise<VerificationResult> {
  const token = await getScrapeDoToken();
  const cleanPhone = person.phone.replace(/\D/g, '');  // 移除非数字字符
  const targetUrl = `https://www.truepeoplesearch.com/resultphone?phoneno=${cleanPhone}`;

  console.log(`[Scraper] TruePeopleSearch reverse lookup for phone: ${cleanPhone}`);
  
  let lastError: any = null;
  
  // 重试循环
  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    const startTime = Date.now();
    
    try {
      if (attempt > 0) {
        console.log(`[Scraper] Retry attempt ${attempt}/${RETRY_CONFIG.maxRetries}`);
        await delay(RETRY_CONFIG.retryDelay);
      }
      
      // 调用 Scrape.do API
      const response = await axios.get(SCRAPE_DO_BASE, {
        params: { 
          token,              // API Token
          url: targetUrl,     // 目标 URL
          super: true,        // 使用高级代理
          geoCode: 'us',      // 美国地区
          render: true        // 渲染 JavaScript
        },
        timeout: 90000,       // 90 秒超时
      });

      const responseTime = Date.now() - startTime;
      const html = response.data;
      
      console.log(`[Scraper] Response received, length: ${html.length}`);
      
      // 解析 HTML 结果
      const result = parseTruePeopleSearchReverseResult(html, person);

      // 记录 API 调用日志
      await logApi(
        'scrape_tps',
        targetUrl,
        { phone: cleanPhone, attempt },
        response.status,
        responseTime,
        true,
        undefined,
        0,
        userId
      );

      return result;
      
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      lastError = error;
      
      console.error(`[Scraper] Error (attempt ${attempt + 1}):`, error.message);
      
      // 检查是否可重试
      if (isRetryableError(error) && attempt < RETRY_CONFIG.maxRetries) {
        continue;
      }
      
      // 检查是否是积分耗尽错误 (401)
      const apiError = getApiErrorType(error);
      if (apiError === 'INSUFFICIENT_CREDITS') {
        console.error(`[Scraper] API credits exhausted!`);
        await logApi('scrape_tps', targetUrl, { phone: cleanPhone, apiError }, 401, responseTime, false, 'API credits exhausted', 0, userId);
        return { verified: false, source: 'TruePeopleSearch', matchScore: 0, apiError: 'INSUFFICIENT_CREDITS' };
      }
      
      // 记录错误日志
      await logApi('scrape_tps', targetUrl, { phone: cleanPhone, attempt }, error.response?.status || 0, responseTime, false, error.message, 0, userId);
      return { verified: false, source: 'TruePeopleSearch', matchScore: 0, apiError };
    }
  }
  
  return { verified: false, source: 'TruePeopleSearch', matchScore: 0 };
}
```

### 3.3 FastPeopleSearch 验证

```typescript
export async function verifyWithFastPeopleSearch(
  person: PersonToVerify, 
  userId?: number
): Promise<VerificationResult> {
  const token = await getScrapeDoToken();
  
  // FastPeopleSearch 需要带连字符的电话格式
  const formattedPhone = formatPhoneWithDashes(person.phone);  // 415-548-0165
  const targetUrl = `https://www.fastpeoplesearch.com/${formattedPhone}`;

  console.log(`[Scraper] FastPeopleSearch reverse lookup for phone: ${formattedPhone}`);
  
  // 与 TruePeopleSearch 类似的重试逻辑...
  
  const response = await axios.get(SCRAPE_DO_BASE, {
    params: { 
      token, 
      url: targetUrl, 
      super: true, 
      geoCode: 'us', 
      render: true 
    },
    timeout: 90000,
  });

  return parseFastPeopleSearchReverseResult(response.data, person);
}

// 格式化电话号码
function formatPhoneWithDashes(phone: string): string {
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length === 10) {
    return `${cleanPhone.slice(0, 3)}-${cleanPhone.slice(3, 6)}-${cleanPhone.slice(6)}`;
  } else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
    return `${cleanPhone.slice(1, 4)}-${cleanPhone.slice(4, 7)}-${cleanPhone.slice(7)}`;
  }
  return cleanPhone;
}
```

### 3.4 主验证函数

```typescript
export async function verifyPhoneNumber(
  person: PersonToVerify, 
  userId?: number
): Promise<VerificationResult> {
  console.log(`[Scraper] Starting verification for ${person.firstName} ${person.lastName}`);
  
  // 第一阶段：TruePeopleSearch
  const tpsResult = await verifyWithTruePeopleSearch(person, userId);
  
  // 如果 API 积分耗尽，立即返回
  if (tpsResult.apiError === 'INSUFFICIENT_CREDITS') {
    return tpsResult;
  }
  
  // 如果验证成功（分数 >= 60），直接返回
  if (tpsResult.verified && tpsResult.matchScore >= 60) {
    console.log(`[Scraper] TruePeopleSearch verification passed`);
    return { ...tpsResult, source: 'TruePeopleSearch' };
  }

  // 第二阶段：FastPeopleSearch
  console.log(`[Scraper] TruePeopleSearch failed, trying FastPeopleSearch`);
  const fpsResult = await verifyWithFastPeopleSearch(person, userId);
  
  if (fpsResult.apiError === 'INSUFFICIENT_CREDITS') {
    return fpsResult;
  }
  
  if (fpsResult.verified && fpsResult.matchScore >= 60) {
    console.log(`[Scraper] FastPeopleSearch verification passed`);
    return { ...fpsResult, source: 'FastPeopleSearch' };
  }

  // 返回分数较高的结果
  return tpsResult.matchScore > fpsResult.matchScore ? tpsResult : fpsResult;
}
```

---

## 四、验证评分算法

### 4.1 评分规则

| 匹配项 | 分数 | 说明 |
|--------|------|------|
| 姓名匹配 | +40 | 名字和姓氏都在页面中找到 |
| 年龄在范围内 | +30 | 年龄在 minAge 和 maxAge 之间 |
| 州匹配 | +20 | 州名在页面中找到 |
| 城市匹配 | +10 | 城市名在页面中找到 |

### 4.2 验证通过条件

```typescript
// 验证通过条件：姓名匹配 且 总分 >= 70
if (nameMatched && score >= 70) {
  result.verified = true;
}
```

### 4.3 TruePeopleSearch 解析

```typescript
function parseTruePeopleSearchReverseResult(html: string, person: PersonToVerify): VerificationResult {
  const result: VerificationResult = { 
    verified: false, 
    source: 'TruePeopleSearch', 
    matchScore: 0, 
    details: {} 
  };

  try {
    let score = 0;

    // 提取页面中的所有姓名
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

    // 检查姓名匹配
    let nameMatched = false;
    for (const foundName of foundNames) {
      const nameLower = foundName.toLowerCase();
      const firstNameLower = person.firstName.toLowerCase();
      const lastNameLower = person.lastName.toLowerCase();
      
      if (nameLower.includes(firstNameLower) && nameLower.includes(lastNameLower)) {
        nameMatched = true;
        score += 40;
        result.details!.name = foundName;
        break;
      }
    }

    if (!nameMatched) {
      return result;  // 姓名不匹配，直接返回
    }

    // 提取年龄
    const agePattern = /Age\s*<\/span>\s*<span[^>]*class="content-value"[^>]*>\s*(\d+)\s*<\/span>/i;
    const ageMatch = html.match(agePattern);
    
    if (ageMatch) {
      result.details!.age = parseInt(ageMatch[1], 10);
      
      // 检查年龄范围
      const minAge = person.minAge || 50;
      const maxAge = person.maxAge || 79;
      
      if (result.details!.age >= minAge && result.details!.age <= maxAge) {
        score += 30;
      } else {
        // 年龄不在范围内，排除
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
    }

    // 检查城市匹配
    if (person.city) {
      const cityPattern = new RegExp(`\\b${escapeRegex(person.city)}\\b`, 'i');
      if (cityPattern.test(html)) {
        score += 10;
        result.details!.city = person.city;
      }
    }

    // 检测电话类型
    if (/mobile|cell|wireless/i.test(html)) result.phoneType = 'mobile';
    else if (/landline|home|residential/i.test(html)) result.phoneType = 'landline';
    else if (/voip/i.test(html)) result.phoneType = 'voip';

    result.matchScore = Math.min(score, 100);
    
    // 验证通过条件
    if (nameMatched && score >= 70) {
      result.verified = true;
    }

  } catch (error) {
    console.error('[Scraper] Error parsing result:', error);
  }

  return result;
}
```

---

## 五、错误处理

### 5.1 错误类型

```typescript
export type ApiErrorType = 
  | 'INSUFFICIENT_CREDITS'  // API 积分耗尽 (401)
  | 'RATE_LIMITED'          // 请求频率限制 (429)
  | 'NETWORK_ERROR'         // 网络错误
  | 'UNKNOWN_ERROR'         // 未知错误
  | null;

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
```

### 5.2 可重试错误判断

```typescript
function isRetryableError(error: any): boolean {
  if (!error) return false;
  
  // 401 积分耗尽不可重试
  if (error.response?.status === 401) {
    return false;
  }
  
  // 检查错误代码
  if (error.code && RETRY_CONFIG.retryableErrors.includes(error.code)) {
    return true;
  }
  
  // 5xx 服务器错误可重试
  if (error.response?.status >= 500) {
    return true;
  }
  
  // 429 Too Many Requests 可重试
  if (error.response?.status === 429) {
    return true;
  }
  
  return false;
}
```

### 5.3 积分耗尽处理

```typescript
function isInsufficientCreditsError(error: any): boolean {
  return error?.response?.status === 401;
}

// 在 searchProcessorV3.ts 中处理
if (verificationResult.apiError === 'INSUFFICIENT_CREDITS') {
  apiCreditsExhausted = true;
  addLog(`⚠️ API 积分耗尽，停止验证`, 'warning', 'verification', '');
  // 退还未处理的积分
  // ...
}
```

---

## 六、API 日志记录

### 6.1 日志函数 (db.ts)

```typescript
export async function logApi(
  apiType: 'apollo_search' | 'apollo_enrich' | 'apify_search' | 'scrape_tps' | 'scrape_fps',
  endpoint: string,
  requestParams: any,
  responseStatus: number,
  responseTime: number,
  success: boolean,
  errorMessage?: string,
  creditsUsed: number = 0,
  userId?: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  try {
    await db.insert(apiLogs).values({
      userId,
      apiType,
      endpoint,
      requestParams,
      responseStatus,
      responseTime,
      success,
      errorMessage,
      creditsUsed,
    });
  } catch (error) {
    console.error('记录 API 日志失败:', error);
  }
}
```

### 6.2 日志表结构

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 主键 |
| userId | int | 用户ID |
| apiType | enum | API 类型 |
| endpoint | varchar | 请求端点 |
| requestParams | json | 请求参数 |
| responseStatus | int | 响应状态码 |
| responseTime | int | 响应时间(毫秒) |
| success | boolean | 是否成功 |
| errorMessage | text | 错误信息 |
| creditsUsed | int | 消耗积分 |
| createdAt | timestamp | 创建时间 |

---

## 七、并发控制

### 7.1 并发处理 (searchProcessorV3.ts)

```typescript
const CONCURRENT_LIMIT = 15;  // 并发限制

// 分批并发处理
async function processBatch(items: LeadPerson[], startIndex: number): Promise<void> {
  const batch = items.slice(startIndex, startIndex + CONCURRENT_LIMIT);
  
  await Promise.all(batch.map(async (person, index) => {
    const globalIndex = startIndex + index;
    
    // 处理单个人员
    await processPersonWithVerification(person, globalIndex);
  }));
}

// 循环处理所有批次
for (let i = 0; i < actualCount; i += CONCURRENT_LIMIT) {
  await processBatch(apifyResults, i);
  
  // 更新进度
  const progress = Math.round(((i + CONCURRENT_LIMIT) / actualCount) * 100);
  await updateTaskProgress(task.taskId, Math.min(progress, 100));
}
```

### 7.2 并发限制原因

- 避免触发 Scrape.do 的速率限制
- 防止服务器资源耗尽
- 保持稳定的响应时间

---

## 八、数据流图

```
┌─────────────────────────────────────────────────────────────────┐
│                         前端 (Search.tsx)                        │
│                                                                 │
│  用户输入: name, title, state, limit, ageMin, ageMax            │
│                           │                                     │
│                           ▼                                     │
│                   trpc.search.start()                           │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      后端 (routers.ts)                           │
│                                                                 │
│  search.start: 验证参数 → 检查积分 → 创建任务                    │
│                           │                                     │
│                           ▼                                     │
│                   executeSearchV3()                             │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                searchProcessorV3.ts                              │
│                                                                 │
│  阶段1: 初始化任务                                               │
│  阶段2: 检查缓存 / 调用 Apify                                    │
│         │                                                       │
│         ├─ 缓存命中 → 使用缓存数据                               │
│         │                                                       │
│         └─ 缓存未命中 → 调用 Apify API                           │
│                           │                                     │
│                           ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    apify.ts                              │   │
│  │                                                         │   │
│  │  searchPeople() → ApifyClient → Leads Finder Actor      │   │
│  │                           │                              │   │
│  │                           ▼                              │   │
│  │  返回 LeadPerson[] (包含姓名、职位、公司、电话等)         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  阶段3: 扣除数据费用                                             │
│  阶段4: 并发处理数据 (15条/批)                                   │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    scraper.ts                            │   │
│  │                                                         │   │
│  │  verifyPhoneNumber()                                    │   │
│  │         │                                               │   │
│  │         ├─ verifyWithTruePeopleSearch()                 │   │
│  │         │         │                                     │   │
│  │         │         ▼                                     │   │
│  │         │  Scrape.do API → TruePeopleSearch             │   │
│  │         │         │                                     │   │
│  │         │         ▼                                     │   │
│  │         │  解析 HTML → 计算匹配分数                      │   │
│  │         │                                               │   │
│  │         └─ verifyWithFastPeopleSearch() (备用)          │   │
│  │                   │                                     │   │
│  │                   ▼                                     │   │
│  │  返回 VerificationResult (verified, matchScore, etc.)   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  阶段5: 保存验证结果                                             │
│  阶段6: 完成统计、退还积分                                       │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      数据库 (MySQL/TiDB)                         │
│                                                                 │
│  - search_tasks: 任务状态、进度、日志                            │
│  - search_results: 搜索结果、验证信息                            │
│  - global_cache: 缓存数据                                        │
│  - credit_logs: 积分变动记录                                     │
│  - api_logs: API 调用日志                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 九、API 调用统计

### 9.1 统计函数 (db.ts)

```typescript
export async function getApiStats(days: number = 7): Promise<ApiStat[]> {
  const db = await getDb();
  if (!db) return [];
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const stats = await db.select()
    .from(apiStats)
    .where(gte(apiStats.date, startDate.toISOString().split('T')[0]))
    .orderBy(desc(apiStats.date));
  
  return stats;
}
```

### 9.2 管理后台显示

- 今日搜索: 5
- 总搜索次数: 62
- 今日积分消耗: 685

---

## 十、总结

### 10.1 API 调用链

1. **Apify Leads Finder**: 获取潜在客户基础数据
2. **Scrape.do + TruePeopleSearch**: 第一阶段电话验证
3. **Scrape.do + FastPeopleSearch**: 第二阶段电话验证（备用）

### 10.2 关键参数

| 参数 | 值 | 说明 |
|------|-----|------|
| Apify 超时 | 300秒 | 最多等待5分钟 |
| Scrape.do 超时 | 90秒 | 单次请求超时 |
| 最大重试次数 | 1 | 失败后重试1次 |
| 重试间隔 | 2000ms | 重试前等待2秒 |
| 并发限制 | 15 | 同时处理15条数据 |

### 10.3 错误处理策略

1. **可重试错误**: 网络错误、5xx 错误、429 错误
2. **不可重试错误**: 401 积分耗尽
3. **降级策略**: TruePeopleSearch 失败时使用 FastPeopleSearch
