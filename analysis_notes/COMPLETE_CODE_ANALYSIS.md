# LeadHunter Pro 完整代码分析报告

## 一、项目架构概述

LeadHunter Pro 是一个潜在客户搜索平台，采用全栈 TypeScript 架构，部署在 Railway 平台上。

### 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React + TypeScript + Vite | 使用 TailwindCSS 进行样式设计 |
| 后端 | Node.js + tRPC | 类型安全的 API 通信 |
| 数据库 | MySQL (TiDB) | 使用 Drizzle ORM |
| 外部API | Apify + Scrape.do | 数据获取和验证 |

### 目录结构

```
leadhunter-pro/
├── client/                 # 前端代码
│   └── src/
│       ├── pages/          # 页面组件
│       │   ├── Search.tsx        # 搜索页面
│       │   ├── SearchProgress.tsx # 搜索进度页面
│       │   └── Results.tsx       # 结果页面
│       ├── components/     # 通用组件
│       └── lib/
│           └── trpc.ts     # tRPC 客户端配置
├── server/                 # 后端代码
│   ├── routers.ts          # API 路由定义
│   ├── db.ts               # 数据库操作
│   └── services/           # 业务服务
│       ├── searchProcessorV3.ts  # 搜索处理器核心
│       ├── apify.ts              # Apify API 服务
│       └── scraper.ts            # Scrape.do 验证服务
├── drizzle/
│   └── schema.ts           # 数据库表结构定义
└── shared/                 # 前后端共享代码
```

---

## 二、搜索功能完整流程

### 2.1 搜索流程图

```
用户输入搜索条件
       ↓
前端验证 → 积分检查
       ↓
调用 search.preview (可选预览)
       ↓
调用 search.start
       ↓
后端 executeSearchV3()
       ↓
┌──────────────────────────────────────┐
│ 阶段1: 初始化                         │
│ - 创建搜索任务                        │
│ - 扣除搜索基础费用 (1积分)            │
└──────────────────────────────────────┘
       ↓
┌──────────────────────────────────────┐
│ 阶段2: 检查缓存 / 调用 Apify API      │
│ - 检查 apify:{searchHash} 缓存       │
│ - 命中则跳过 API 调用                 │
│ - 未命中则调用 Apify Leads Finder    │
│ - 缓存结果 180 天                     │
└──────────────────────────────────────┘
       ↓
┌──────────────────────────────────────┐
│ 阶段3: 计算并扣除数据费用             │
│ - 计算实际可处理数量                  │
│ - 一次性扣除: 数量 × 2 积分           │
└──────────────────────────────────────┘
       ↓
┌──────────────────────────────────────┐
│ 阶段4: 并发处理数据                   │
│ - 分离有电话/无电话记录               │
│ - 无电话记录快速处理                  │
│ - 有电话记录并发验证 (15并发)         │
└──────────────────────────────────────┘
       ↓
┌──────────────────────────────────────┐
│ 阶段5: 二次电话验证 (Scrape.do)       │
│ - TruePeopleSearch 反向查询          │
│ - FastPeopleSearch 反向查询          │
│ - 姓名匹配 + 年龄验证                 │
└──────────────────────────────────────┘
       ↓
┌──────────────────────────────────────┐
│ 阶段6: 完成统计                       │
│ - 计算最终消耗积分                    │
│ - 如有剩余则退还积分                  │
│ - 保存结果到数据库                    │
└──────────────────────────────────────┘
       ↓
返回搜索结果
```

---

## 三、搜索参数详解

### 3.1 前端搜索参数 (Search.tsx)

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| name | string | 必填 | 姓名关键词 (实际未用于 Apify 搜索) |
| title | string | 必填 | 职位筛选 |
| state | string | 必填 | 美国州名 |
| limit | number | 100 | 搜索数量 (100/500/1000/5000) |
| ageMin | number | 50 | 最小年龄 (启用年龄筛选时) |
| ageMax | number | 79 | 最大年龄 (启用年龄筛选时) |
| enableVerification | boolean | true | 是否启用电话验证 |

### 3.2 后端搜索参数 (routers.ts)

```typescript
z.object({
  name: z.string().min(1, "请输入姓名"),
  title: z.string().min(1, "请输入职位"),
  state: z.string().min(1, "请选择州"),
  limit: z.number().min(100).max(10000).optional().default(100),
  ageMin: z.number().min(18).max(80).optional(),
  ageMax: z.number().min(18).max(80).optional(),
  enableVerification: z.boolean().optional().default(true),
})
```

### 3.3 Apify Actor 输入参数 (apify.ts)

| 参数 | 说明 |
|------|------|
| fetch_count | 获取数量限制 |
| contact_job_title | 职位筛选数组 |
| contact_location | 地区筛选数组 (格式: "california, us") |
| file_name | 运行标签/文件名 |

**注意**: searchName 参数实际上未传递给 Apify，因为 Apify Leads Finder 不支持按人名搜索。

---

## 四、扣分机制详解

### 4.1 积分费用常量 (searchProcessorV3.ts)

```typescript
const SEARCH_CREDITS = 1;           // 搜索基础费用
const PHONE_CREDITS_PER_PERSON = 2; // 每条数据费用
const VERIFY_CREDITS_PER_PHONE = 0; // 验证费用（目前免费）
```

### 4.2 积分扣除流程

**第一步: 搜索基础费用 (阶段2)**
```typescript
// 扣除搜索积分
const searchDeducted = await deductCredits(
  userId, 
  SEARCH_CREDITS,  // 1 积分
  'search', 
  `搜索: ${searchName} | ${searchTitle} | ${searchState}`, 
  task.taskId
);
stats.creditsUsed += SEARCH_CREDITS;
```

**第二步: 数据费用 (阶段4)**
```typescript
const actualCount = Math.min(apifyResults.length, requestedCount);
const dataCreditsNeeded = actualCount * PHONE_CREDITS_PER_PERSON;  // 数量 × 2

const dataDeducted = await deductCredits(
  userId, 
  dataCreditsNeeded, 
  'search', 
  `数据费用: ${actualCount} 条 × ${PHONE_CREDITS_PER_PERSON} 积分`, 
  task.taskId
);
stats.creditsUsed += dataCreditsNeeded;
```

### 4.3 积分退还机制

**场景1: 实际数据量少于请求数量**
```typescript
if (actualCount < requestedCount) {
  const savedCredits = (requestedCount - actualCount) * PHONE_CREDITS_PER_PERSON;
  stats.creditsRefunded = savedCredits;
  // 用户少付了积分，无需实际退还
}
```

**场景2: API 积分耗尽导致提前停止**
```typescript
if (apiCreditsExhausted) {
  const unprocessedCount = actualCount - processedCount;
  const refundCredits = unprocessedCount * PHONE_CREDITS_PER_PERSON;
  
  // 实际退还积分
  await db.update(users)
    .set({ credits: sql`credits + ${refundCredits}` })
    .where(eq(users.id, userId));
  
  stats.creditsRefunded += refundCredits;
}
```

### 4.4 积分计算公式

```
总费用 = 搜索基础费 + 数据费用
       = 1 + (实际处理数量 × 2)

最终消耗 = 总费用 - 退还积分
```

### 4.5 前端积分预估 (Search.tsx)

```typescript
const creditEstimate = useMemo(() => {
  const searchCost = SEARCH_COST;                    // 1
  const phoneCost = searchLimit * PHONE_COST_PER_PERSON;  // limit × 2
  const totalCost = searchCost + phoneCost;
  const currentCredits = profile?.credits || 0;
  const remainingCredits = currentCredits - totalCost;
  const canAfford = currentCredits >= totalCost;
  const maxAffordable = Math.floor((currentCredits - SEARCH_COST) / PHONE_COST_PER_PERSON);
  
  return { searchCost, phoneCost, totalCost, currentCredits, remainingCredits, canAfford, maxAffordable };
}, [searchLimit, profile?.credits]);
```

---

## 五、缓存命中机制详解

### 5.1 缓存类型

| 缓存类型 | 缓存键格式 | 有效期 | 说明 |
|----------|-----------|--------|------|
| search | apify:{searchHash} | 180天 | Apify 搜索结果缓存 |
| person | person:{personId} | 180天 | 个人数据缓存 |
| verification | (未使用) | - | 验证结果缓存 |

### 5.2 搜索哈希生成 (searchProcessorV3.ts)

```typescript
function generateSearchHash(name: string, title: string, state: string): string {
  const normalized = `${name.toLowerCase().trim()}|${title.toLowerCase().trim()}|${state.toLowerCase().trim()}`;
  return crypto.createHash('md5').update(normalized).digest('hex');
}
```

**示例**:
- 输入: name="John", title="CEO", state="California"
- 标准化: "john|ceo|california"
- 输出: MD5 哈希值

### 5.3 缓存检查流程 (searchProcessorV3.ts)

```typescript
// 检查缓存
const cacheKey = `apify:${searchHash}`;
const cached = await getCacheByKey(cacheKey);

if (cached) {
  // 缓存命中
  addLog(`✨ 命中全局缓存！`, 'success', 'apify', '✨');
  apifyResults = cached.data as LeadPerson[];
  stats.apifyReturned = apifyResults.length;
  addLog(`📦 缓存中有 ${apifyResults.length} 条记录可用`, 'info', 'apify', '');
  addLog(`⏭️ 跳过 Apify API 调用，节省时间和成本`, 'info', 'apify', '');
} else {
  // 缓存未命中，调用 API
  stats.apifyApiCalls++;
  const searchResult = await apifySearchPeople(...);
  
  // 缓存搜索结果 180天
  await setCache(cacheKey, 'search', apifyResults, 180);
  addLog(`💾 已缓存搜索结果 (180天有效)`, 'info', 'apify', '');
}
```

### 5.4 缓存数据库操作 (db.ts)

**获取缓存**:
```typescript
export async function getCacheByKey(cacheKey: string): Promise<GlobalCache | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  
  // 查询未过期的缓存
  const result = await db.select().from(globalCache)
    .where(and(
      eq(globalCache.cacheKey, cacheKey), 
      gte(globalCache.expiresAt, new Date())
    ))
    .limit(1);
  
  // 更新命中计数
  if (result.length > 0) {
    await db.update(globalCache)
      .set({ hitCount: sql`${globalCache.hitCount} + 1` })
      .where(eq(globalCache.cacheKey, cacheKey));
  }
  
  return result.length > 0 ? result[0] : undefined;
}
```

**设置缓存**:
```typescript
export async function setCache(
  cacheKey: string, 
  cacheType: "search" | "person" | "verification", 
  data: any, 
  ttlDays: number = 180
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  
  await db.insert(globalCache)
    .values({ cacheKey, cacheType, data, expiresAt })
    .onDuplicateKeyUpdate({ set: { data, expiresAt } });
}
```

### 5.5 缓存统计 (db.ts)

```typescript
export async function getCacheStats(): Promise<{
  totalEntries: number;
  searchCache: number;
  personCache: number;
  verificationCache: number;
  totalHits: number;
}> {
  // 统计各类型缓存数量和总命中次数
}
```

---

## 六、API 调用逻辑详解

### 6.1 Apify API 调用 (apify.ts)

**调用流程**:
```typescript
export async function searchPeople(
  searchName: string,
  searchTitle: string,
  searchState: string,
  limit: number = 100,
  userId?: number
): Promise<ApifySearchResult> {
  const token = await getApifyToken();
  const client = new ApifyClient({ token });
  
  // 构建 Actor 输入
  const actorInput = buildActorInput(searchName, searchTitle, searchState, limit);
  
  // 运行 Actor (最多等待5分钟)
  const run = await client.actor('code_crafter/leads-finder').call(actorInput, {
    waitSecs: 300,
  });
  
  // 获取结果数据
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  
  // 转换数据格式
  const people = items.map((item: any) => convertToLeadPerson(item as ApifyLeadRaw));
  
  return { success: true, people, totalCount: people.length };
}
```

**Actor 输入构建**:
```typescript
function buildActorInput(searchName, searchTitle, searchState, limit) {
  const input = {
    fetch_count: limit,
    file_name: `LeadHunter_${searchTitle}_${searchState}`,
  };
  
  if (searchTitle) {
    input.contact_job_title = [searchTitle.trim()];
  }
  
  if (searchState) {
    const apifyLocation = STATE_TO_APIFY_LOCATION[searchState.trim()] 
      || `${searchState.trim().toLowerCase()}, us`;
    input.contact_location = [apifyLocation];
  }
  
  return input;
}
```

### 6.2 Scrape.do 验证 API (scraper.ts)

**验证流程**:
```typescript
export async function verifyPhoneNumber(person: PersonToVerify, userId?: number): Promise<VerificationResult> {
  // 第一阶段：TruePeopleSearch 电话号码反向搜索
  const tpsResult = await verifyWithTruePeopleSearch(person, userId);
  
  // 如果 API 积分耗尽，立即返回
  if (tpsResult.apiError === 'INSUFFICIENT_CREDITS') {
    return tpsResult;
  }
  
  // 如果第一阶段验证成功（姓名匹配且分数>=60），直接返回
  if (tpsResult.verified && tpsResult.matchScore >= 60) {
    return { ...tpsResult, source: 'TruePeopleSearch' };
  }

  // 第二阶段：FastPeopleSearch 电话号码反向搜索
  const fpsResult = await verifyWithFastPeopleSearch(person, userId);
  
  if (fpsResult.verified && fpsResult.matchScore >= 60) {
    return { ...fpsResult, source: 'FastPeopleSearch' };
  }

  // 返回分数较高的结果
  return tpsResult.matchScore > fpsResult.matchScore ? tpsResult : fpsResult;
}
```

**TruePeopleSearch 调用**:
```typescript
export async function verifyWithTruePeopleSearch(person: PersonToVerify, userId?: number) {
  const token = await getScrapeDoToken();
  const cleanPhone = person.phone.replace(/\D/g, '');
  const targetUrl = `https://www.truepeoplesearch.com/resultphone?phoneno=${cleanPhone}`;

  const response = await axios.get(SCRAPE_DO_BASE, {
    params: { 
      token, 
      url: targetUrl, 
      super: true,      // 使用高级代理
      geoCode: 'us',    // 美国地区
      render: true      // 渲染 JavaScript
    },
    timeout: 90000,
  });

  return parseTruePeopleSearchReverseResult(response.data, person);
}
```

### 6.3 验证评分逻辑 (scraper.ts)

```typescript
function parseTruePeopleSearchReverseResult(html: string, person: PersonToVerify): VerificationResult {
  let score = 0;

  // 姓名匹配: +40分
  if (nameLower.includes(firstNameLower) && nameLower.includes(lastNameLower)) {
    nameMatched = true;
    score += 40;
  }

  // 年龄在范围内: +30分
  if (age >= minAge && age <= maxAge) {
    score += 30;
  }

  // 州匹配: +20分
  if (statePattern.test(html)) {
    score += 20;
  }

  // 城市匹配: +10分
  if (cityPattern.test(html)) {
    score += 10;
  }

  // 验证通过条件: 姓名匹配 且 分数 >= 70
  if (nameMatched && score >= 70) {
    result.verified = true;
  }

  return result;
}
```

---

## 七、数据库表结构

### 7.1 核心表

| 表名 | 说明 |
|------|------|
| users | 用户信息表 |
| search_tasks | 搜索任务表 |
| search_results | 搜索结果表 |
| global_cache | 全局缓存表 |
| credit_logs | 积分变动记录表 |
| recharge_orders | 充值订单表 |

### 7.2 搜索任务表 (search_tasks)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 主键 |
| taskId | varchar(32) | 任务唯一标识 |
| userId | int | 用户ID |
| searchHash | varchar(32) | 搜索条件哈希 |
| params | json | 搜索参数 |
| requestedCount | int | 请求数量 |
| actualCount | int | 实际结果数量 |
| creditsUsed | int | 消耗积分 |
| status | enum | 状态: pending/running/completed/failed/stopped |
| progress | int | 进度百分比 |
| logs | json | 执行日志 |

### 7.3 全局缓存表 (global_cache)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 主键 |
| cacheKey | varchar(100) | 缓存键 (唯一) |
| cacheType | enum | 类型: search/person/verification |
| data | json | 缓存数据 |
| hitCount | int | 命中次数 |
| expiresAt | timestamp | 过期时间 |

---

## 八、系统配置参数

| 配置键 | 值 | 说明 |
|--------|-----|------|
| SEARCH_CREDITS_PER_PERSON | 2 | 每条搜索结果消耗积分 |
| PREVIEW_CREDITS | 1 | 预览搜索消耗积分 |
| CREDITS_PER_USDT | 100 | 1 USDT = 100 积分 |
| MIN_RECHARGE_CREDITS | 100 | 最低充值积分数 |
| CACHE_TTL_DAYS | 180 | 缓存有效期(天) |
| ORDER_EXPIRE_MINUTES | 30 | 订单过期时间(分钟) |
| NEW_USER_BONUS | 0 | 新用户赠送积分 |
| USDT_RATE | 7.2 | USDT 兑人民币汇率 |

---

## 九、关键代码文件索引

| 文件路径 | 功能说明 |
|----------|----------|
| server/routers.ts | API 路由定义，包含所有 tRPC 接口 |
| server/db.ts | 数据库操作函数 |
| server/services/searchProcessorV3.ts | 搜索处理器核心逻辑 |
| server/services/apify.ts | Apify API 调用服务 |
| server/services/scraper.ts | Scrape.do 验证服务 |
| client/src/pages/Search.tsx | 前端搜索页面 |
| client/src/pages/SearchProgress.tsx | 前端搜索进度页面 |
| drizzle/schema.ts | 数据库表结构定义 |

---

## 十、运行逻辑总结

1. **用户发起搜索**: 前端收集搜索条件，验证积分是否充足
2. **创建搜索任务**: 后端创建任务记录，扣除搜索基础费用 (1积分)
3. **检查缓存**: 根据 searchHash 检查是否有缓存数据
4. **获取数据**: 缓存命中则使用缓存，否则调用 Apify API
5. **扣除数据费用**: 根据实际数据量一次性扣除 (数量 × 2积分)
6. **并发处理**: 分批并发处理数据，每批15条
7. **电话验证**: 调用 Scrape.do 进行二次验证
8. **保存结果**: 将验证结果保存到数据库
9. **积分退还**: 如有未处理数据，退还相应积分
10. **返回结果**: 更新任务状态，返回搜索结果
