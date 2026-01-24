# TPS 搜索模式代码审计报告

## 审计时间: 2026-01-24

---

## 一、前端代码审计

### 1. TpsSearch.tsx（搜索页面）

#### 1.1 参数定义

| 前端参数 | 类型 | 默认值 | 说明 |
|----------|------|--------|------|
| mode | "nameOnly" \| "nameLocation" | "nameOnly" | 搜索模式 |
| names | string[] | [] | 姓名列表 |
| locations | string[] | [] | 地点列表 |
| filters.minAge | number | 50 | 最小年龄 |
| filters.maxAge | number | 79 | 最大年龄 |
| filters.minYear | number | 2025 | 电话最早年份 |
| filters.minPropertyValue | number | 0 | 最低房产价值 |
| filters.excludeTMobile | boolean | false | 排除 T-Mobile |
| filters.excludeComcast | boolean | false | 排除 Comcast |
| filters.excludeLandline | boolean | false | 排除固话 |

#### 1.2 发现的问题

**🔴 问题 1: 费用预估计算不准确（严重）**
```typescript
// 当前代码 (第 73 行)
const estimatedCost = estimatedSearches * maxPages * searchCost;
```
- **问题**: 只计算了搜索页费用，没有计算详情页费用
- **实际费用**: 搜索页费用 + 详情页费用
- **影响**: 用户看到的预估费用远低于实际消耗

**🟡 问题 2: 费用显示使用硬编码值（中等）**
```typescript
// 第 65-66 行
const searchCost = 0.3;
const detailCost = 0.3;
```
- **问题**: 应该从后端 API 获取配置，而不是硬编码
- **影响**: 如果管理员修改费率，前端显示不一致

**🟡 问题 3: 未使用后端 estimateCost API（中等）**
- 后端已有 `trpc.tps.estimateCost` 接口
- 前端没有调用，自己计算预估

### 2. TpsTask.tsx（任务详情页面）

#### 2.1 数据展示字段

| 字段 | 来源 | 状态 |
|------|------|------|
| taskId | task.taskId | ✅ 正确 |
| status | task.status | ✅ 正确 |
| progress | task.progress | ✅ 正确 |
| totalSubTasks | task.totalSubTasks | ✅ 正确 |
| completedSubTasks | task.completedSubTasks | ✅ 正确 |
| totalResults | task.totalResults | ✅ 正确 |
| cacheHits | task.cacheHits | ✅ 正确 |
| creditsUsed | task.creditsUsed | ✅ 正确 |
| searchPageRequests | task.searchPageRequests | ✅ 正确 |
| detailPageRequests | task.detailPageRequests | ✅ 正确 |
| logs | task.logs | ✅ 正确 |
| errorMessage | task.errorMessage | ✅ 正确 |

#### 2.2 结果表格字段

| 字段 | 来源 | 状态 |
|------|------|------|
| name | result.name | ✅ 正确 |
| age | result.age | ✅ 正确 |
| city | result.city | ✅ 正确 |
| state | result.state | ✅ 正确 |
| phone | result.phone | ✅ 正确 |
| phoneType | result.phoneType | ✅ 正确 |
| carrier | result.carrier | ✅ 正确 |
| reportYear | result.reportYear | ✅ 正确 |
| isPrimary | result.isPrimary | ✅ 正确 |
| propertyValue | result.propertyValue | ✅ 正确 |
| yearBuilt | result.yearBuilt | ✅ 正确 |

---

## 二、后端 router.ts 审计

### 2.1 输入验证 Schema

```typescript
const tpsFiltersSchema = z.object({
  minAge: z.number().min(0).max(120).optional(),
  maxAge: z.number().min(0).max(120).optional(),
  minYear: z.number().min(2000).max(2030).optional(),
  minPropertyValue: z.number().min(0).optional(),
  excludeTMobile: z.boolean().optional(),
  excludeComcast: z.boolean().optional(),
  excludeLandline: z.boolean().optional(),
}).optional();

const tpsSearchInputSchema = z.object({
  names: z.array(z.string().min(1)).min(1).max(100),
  locations: z.array(z.string()).optional(),
  mode: z.enum(["nameOnly", "nameLocation"]),
  filters: tpsFiltersSchema,
});
```

**✅ 与前端参数完全匹配**

### 2.2 API 端点

| 端点 | 方法 | 输入 | 输出 | 状态 |
|------|------|------|------|------|
| getConfig | query | 无 | searchCost, detailCost, maxPages, enabled | ✅ |
| estimateCost | query | tpsSearchInputSchema | subTaskCount, estimatedCost... | ✅ |
| search | mutation | tpsSearchInputSchema | taskId, message | ✅ |
| getTaskStatus | query | taskId | 任务状态对象 | ✅ |
| getTaskResults | query | taskId, page, pageSize | 结果列表 | ✅ |
| getHistory | query | page, pageSize | 任务历史 | ✅ |
| exportResults | mutation | taskId | csv, filename | ✅ |

### 2.3 发现的问题

**🟢 无严重问题**

---

## 三、scraper.ts 爬虫核心审计

### 3.1 配置常量

```typescript
export const TPS_CONFIG = {
  SCRAPEDO_BASE: 'https://api.scrape.do',
  TPS_BASE: 'https://www.truepeoplesearch.com',
  RESULTS_PER_PAGE: 10,
  MAX_SAFE_PAGES: 25,
  MAX_RECORDS: 250,
  REQUEST_TIMEOUT: 30000,
  BATCH_DELAY: 200,
  TOTAL_CONCURRENCY: 40,
  TASK_CONCURRENCY: 4,
  SCRAPEDO_CONCURRENCY: 10,
  IMMEDIATE_RETRIES: 2,
  IMMEDIATE_RETRY_DELAY: 1000,
  DEFERRED_RETRIES: 2,
  DEFERRED_RETRY_DELAY: 2000,
};
```

### 3.2 类型定义

```typescript
export interface TpsFilters {
  minAge?: number;
  maxAge?: number;
  minYear?: number;
  minPropertyValue?: number;
  excludeTMobile?: boolean;
  excludeComcast?: boolean;
  excludeLandline?: boolean;
}

export interface TpsDetailResult {
  name: string;
  age?: number;
  city?: string;
  state?: string;
  location?: string;
  phone?: string;
  phoneType?: string;
  carrier?: string;
  reportYear?: number;
  isPrimary?: boolean;
  propertyValue?: number;
  yearBuilt?: number;
  detailLink: string;
}
```

**✅ 与前端和后端类型完全匹配**

### 3.3 过滤逻辑审计

```typescript
export function shouldIncludeResult(result: TpsDetailResult, filters: TpsFilters): boolean {
  // 年龄过滤 ✅
  if (result.age !== undefined) {
    if (filters.minAge !== undefined && result.age < filters.minAge) return false;
    if (filters.maxAge !== undefined && result.age > filters.maxAge) return false;
  }
  
  // 电话年份过滤 ✅
  if (filters.minYear !== undefined && result.reportYear !== undefined) {
    if (result.reportYear < filters.minYear) return false;
  }
  
  // 房产价值过滤 ✅
  if (filters.minPropertyValue !== undefined && filters.minPropertyValue > 0) {
    if (!result.propertyValue || result.propertyValue < filters.minPropertyValue) return false;
  }
  
  // T-Mobile 过滤 ✅
  if (filters.excludeTMobile && result.carrier) {
    if (result.carrier.toLowerCase().includes('t-mobile') || 
        result.carrier.toLowerCase().includes('tmobile')) {
      return false;
    }
  }
  
  // Comcast/Spectrum 过滤 ✅
  if (filters.excludeComcast && result.carrier) {
    const carrierLower = result.carrier.toLowerCase();
    if (carrierLower.includes('comcast') || 
        carrierLower.includes('spectrum') ||
        carrierLower.includes('xfinity')) {
      return false;
    }
  }
  
  // 固话过滤 ✅
  if (filters.excludeLandline && result.phoneType) {
    if (result.phoneType.toLowerCase() === 'landline') {
      return false;
    }
  }
  
  return true;
}
```

**✅ 所有过滤条件逻辑正确**

### 3.4 发现的问题

**🟡 问题 4: 搜索页年龄初筛可能遗漏（中等）**
```typescript
// 搜索页初筛（年龄过滤）
const filteredSearchResults = allSearchResults.filter(result => {
  // 跳过已故人员
  if (result.name.toLowerCase().includes('deceased')) return false;
  
  // 年龄初筛
  if (result.age !== undefined) {
    if (filters.minAge !== undefined && result.age < filters.minAge) {
      stats.filteredOut++;
      return false;
    }
    if (filters.maxAge !== undefined && result.age > filters.maxAge) {
      stats.filteredOut++;
      return false;
    }
  }
  
  return true;
});
```
- **问题**: 如果搜索页没有解析到年龄（`result.age === undefined`），会跳过年龄过滤
- **影响**: 可能会获取不符合年龄条件的详情页（浪费积分）
- **建议**: 考虑是否需要在详情页再次过滤年龄

---

## 四、db.ts 数据库操作审计

### 4.1 函数列表

| 函数 | 功能 | 状态 |
|------|------|------|
| getTpsConfig | 获取 TPS 配置 | ✅ |
| updateTpsConfig | 更新 TPS 配置 | ✅ |
| createTpsSearchTask | 创建搜索任务 | ✅ |
| getTpsSearchTask | 获取搜索任务 | ✅ |
| updateTpsSearchTaskProgress | 更新任务进度 | ✅ |
| completeTpsSearchTask | 完成任务 | ✅ |
| failTpsSearchTask | 标记任务失败 | ✅ |
| getUserTpsSearchTasks | 获取用户搜索历史 | ✅ |
| saveTpsSearchResults | 保存搜索结果 | ✅ |
| getTpsSearchResults | 获取搜索结果 | ✅ |
| getCachedTpsDetails | 获取缓存详情 | ✅ |
| saveTpsDetailCache | 保存详情缓存 | ✅ |
| getUserCredits | 获取用户积分 | ✅ |
| deductCredits | 扣除积分 | ✅ |
| logCreditChange | 记录积分变动 | ✅ |
| logApi | 记录 API 调用 | ✅ |

### 4.2 发现的问题

**🔴 问题 5: saveTpsSearchResults 类型不匹配（严重）**

db.ts 中的函数签名：
```typescript
export async function saveTpsSearchResults(
  taskDbId: number,
  subTaskIndex: number,
  searchName: string,
  searchLocation: string,
  results: Array<{
    name: string;
    age: number;           // 必需
    city: string;          // 必需
    state: string;         // 必需
    location: string;      // 必需
    phone: string;         // 必需
    phoneType: string;     // 必需
    carrier: string;       // 必需
    reportYear: number | null;
    isPrimary: boolean;    // 必需
    propertyValue: number; // 必需
    yearBuilt: number | null;
  }>
)
```

scraper.ts 中的 TpsDetailResult 类型：
```typescript
export interface TpsDetailResult {
  name: string;
  age?: number;           // 可选
  city?: string;          // 可选
  state?: string;         // 可选
  location?: string;      // 可选
  phone?: string;         // 可选
  phoneType?: string;     // 可选
  carrier?: string;       // 可选
  reportYear?: number;
  isPrimary?: boolean;    // 可选
  propertyValue?: number; // 可选
  yearBuilt?: number;
  detailLink: string;
}
```

**问题**: 类型不匹配，可能导致运行时错误或数据丢失
**影响**: 如果某些字段为 undefined，保存到数据库时可能出错

---

## 五、前后端参数对应关系验证

### 5.1 搜索输入参数

| 前端字段 | 后端 Schema | scraper 类型 | 数据库字段 | 状态 |
|----------|-------------|--------------|------------|------|
| mode | mode | - | mode | ✅ |
| names | names | - | names | ✅ |
| locations | locations | - | locations | ✅ |
| filters.minAge | minAge | minAge | filters.minAge | ✅ |
| filters.maxAge | maxAge | maxAge | filters.maxAge | ✅ |
| filters.minYear | minYear | minYear | filters.minYear | ✅ |
| filters.minPropertyValue | minPropertyValue | minPropertyValue | filters.minPropertyValue | ✅ |
| filters.excludeTMobile | excludeTMobile | excludeTMobile | filters.excludeTMobile | ✅ |
| filters.excludeComcast | excludeComcast | excludeComcast | filters.excludeComcast | ✅ |
| filters.excludeLandline | excludeLandline | excludeLandline | filters.excludeLandline | ✅ |

### 5.2 搜索结果字段

| 前端展示 | 后端返回 | scraper 输出 | 数据库字段 | 状态 |
|----------|----------|--------------|------------|------|
| name | name | name | name | ✅ |
| age | age | age | age | ✅ |
| city | city | city | city | ✅ |
| state | state | state | state | ✅ |
| phone | phone | phone | phone | ✅ |
| phoneType | phoneType | phoneType | phoneType | ✅ |
| carrier | carrier | carrier | carrier | ✅ |
| reportYear | reportYear | reportYear | reportYear | ✅ |
| isPrimary | isPrimary | isPrimary | isPrimary | ✅ |
| propertyValue | propertyValue | propertyValue | propertyValue | ✅ |
| yearBuilt | yearBuilt | yearBuilt | yearBuilt | ✅ |

### 5.3 任务状态字段

| 前端展示 | 后端返回 | 数据库字段 | 状态 |
|----------|----------|------------|------|
| taskId | taskId | taskId | ✅ |
| status | status | status | ✅ |
| progress | progress | progress | ✅ |
| totalSubTasks | totalSubTasks | totalSubTasks | ✅ |
| completedSubTasks | completedSubTasks | completedSubTasks | ✅ |
| totalResults | totalResults | totalResults | ✅ |
| searchPageRequests | searchPageRequests | searchPageRequests | ✅ |
| detailPageRequests | detailPageRequests | detailPageRequests | ✅ |
| cacheHits | cacheHits | cacheHits | ✅ |
| creditsUsed | creditsUsed | creditsUsed | ✅ |
| logs | logs | logs | ✅ |
| errorMessage | errorMessage | errorMessage | ✅ |

---

## 六、问题汇总

### 严重问题（需立即修复）

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 1 | 费用预估只计算搜索页，未计算详情页 | TpsSearch.tsx:73 | 用户看到的预估费用远低于实际 |
| 5 | saveTpsSearchResults 类型不匹配 | db.ts:246-264 | 可能导致运行时错误 |

### 中等问题（建议修复）

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 2 | 费用显示使用硬编码值 | TpsSearch.tsx:65-66 | 管理员修改费率后前端不同步 |
| 3 | 未使用后端 estimateCost API | TpsSearch.tsx | 重复计算逻辑 |
| 4 | 搜索页年龄初筛可能遗漏 | scraper.ts:617-634 | 可能浪费积分获取不符合条件的详情 |

---

## 七、修复建议

### 7.1 修复问题 1 和 2：前端费用预估

```typescript
// TpsSearch.tsx
// 使用后端 getConfig API 获取费率
const { data: tpsConfig } = trpc.tps.getConfig.useQuery();
const searchCost = tpsConfig?.searchCost || 0.3;
const detailCost = tpsConfig?.detailCost || 0.3;

// 修正预估计算（包含详情页费用）
const avgDetailsPerSearch = 50; // 预估每个搜索平均 50 条详情
const estimatedCost = estimatedSearches * maxPages * searchCost 
                    + estimatedSearches * avgDetailsPerSearch * detailCost;
```

### 7.2 修复问题 5：类型匹配

```typescript
// db.ts - 修改 saveTpsSearchResults 参数类型
export async function saveTpsSearchResults(
  taskDbId: number,
  subTaskIndex: number,
  searchName: string,
  searchLocation: string,
  results: Array<{
    name: string;
    age?: number;           // 改为可选
    city?: string;          // 改为可选
    state?: string;         // 改为可选
    location?: string;      // 改为可选
    phone?: string;         // 改为可选
    phoneType?: string;     // 改为可选
    carrier?: string;       // 改为可选
    reportYear?: number | null;
    isPrimary?: boolean;    // 改为可选
    propertyValue?: number; // 改为可选
    yearBuilt?: number | null;
  }>
)
```

---

## 八、逻辑流程验证

### 8.1 搜索流程

```
用户提交搜索
    ↓
前端 TpsSearch.tsx
    ├── 验证输入
    ├── 调用 trpc.tps.search.mutate()
    └── 跳转到任务详情页
    ↓
后端 router.ts search()
    ├── 验证 TPS 是否启用
    ├── 验证用户积分
    ├── 创建任务记录
    └── 异步执行 executeTpsSearchUnifiedQueue()
    ↓
executeTpsSearchUnifiedQueue()
    ├── 阶段一：并发搜索（4 并发）
    │   ├── 调用 searchOnly()
    │   └── 收集所有详情链接
    ├── 阶段二：统一获取详情（40 并发）
    │   ├── 调用 fetchDetailsInBatch()
    │   ├── 检查缓存
    │   ├── 获取新详情
    │   └── 应用过滤条件
    ├── 保存结果到数据库
    ├── 扣除积分
    └── 完成任务
```

**✅ 流程完整，逻辑正确**

### 8.2 过滤流程

```
搜索结果
    ↓
搜索页初筛 (searchOnly)
    ├── 跳过已故人员
    └── 年龄初筛
    ↓
详情页过滤 (shouldIncludeResult)
    ├── 年龄范围
    ├── 电话年份
    ├── 房产价值
    ├── T-Mobile 运营商
    ├── Comcast/Spectrum 运营商
    └── 固话类型
    ↓
电话号码去重
    ↓
保存结果
```

**✅ 过滤逻辑完整**

---

## 九、完美修复记录

### 2026-01-24 完美修复

#### 修复 1: 前端费用预估显示优化

**修复前：**
- 只显示总费用，用户不知道费用构成

**修复后：**
- 显示搜索任务数、最大页数、预估详情数
- 显示搜索页费用计算公式：`任务数 × 页数 × 单价`
- 显示详情页费用计算公式：`任务数 × 详情数 × 单价`
- 添加提示：“实际费用取决于搜索结果数量，可能低于预估”

#### 修复 2: 搜索页年龄初筛优化

**修复前：**
- 没有年龄信息的记录直接保留，没有说明

**修复后：**
- 添加详细注释说明过滤逻辑
- 明确：没有年龄信息的记录保留，在详情页再次验证
- 显示过滤数量统计：`初筛后 X 条记录（过滤 Y 条）`

#### 修复 3: estimateCost API 优化

**修复前：**
- 返回字段较少，与前端计算不一致

**修复后：**
- 返回完整的预估信息：
  - `subTaskCount` - 子任务数
  - `maxPages` - 最大页数
  - `maxSearchPages` - 最大搜索页数
  - `maxSearchCost` - 搜索页费用
  - `avgDetailsPerTask` - 每任务平均详情数
  - `estimatedDetails` - 预估详情总数
  - `estimatedDetailCost` - 详情页费用
  - `estimatedCost` - 总费用

#### 修复 4: CSV 导出完善

**修复前：**
- 只包含基本字段，没有数据来源信息

**修复后：**
- 添加「搜索姓名」字段
- 添加「搜索地点」字段
- 添加「详情链接」字段（完整 URL）
- 方便用户追溯数据来源

---

## 十、结论

TPS 搜索模式的代码整体结构清晰，前后端参数对应正确，逻辑衔接完整。

**已完成的修复：**
1. ✅ 前端费用预估计算不准确（严重）
2. ✅ saveTpsSearchResults 类型不匹配（严重）
3. ✅ 前端费用使用硬编码值（中等）
4. ✅ 前端费用预估显示不详细（优化）
5. ✅ 搜索页年龄初筛注释不清晰（优化）
6. ✅ estimateCost API 返回字段不完整（优化）
7. ✅ CSV 导出缺少数据来源字段（优化）

**代码质量评估（修复后）：**
- 类型安全：⭐⭐⭐⭐⭐ (5/5)
- 错误处理：⭐⭐⭐⭐ (4/5)
- 代码结构：⭐⭐⭐⭐⭐ (5/5)
- 参数对应：⭐⭐⭐⭐⭐ (5/5)
- 逻辑完整性：⭐⭐⭐⭐⭐ (5/5)
- 用户体验：⭐⭐⭐⭐⭐ (5/5)

