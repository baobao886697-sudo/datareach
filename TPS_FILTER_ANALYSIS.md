# TPS 过滤条件详细分析报告

## 一、前端过滤条件分析

### 1.1 默认值设置（TpsSearch.tsx 第 42-50 行）

```typescript
const [filters, setFilters] = useState({
  minAge: 50,          // ✅ 默认最小年龄 50
  maxAge: 79,          // ✅ 默认最大年龄 79
  minYear: 2025,       // ✅ 默认最小号码年份 2025
  minPropertyValue: 0, // 默认最小房产价值 0
  excludeTMobile: false,     // 默认不排除 T-Mobile
  excludeComcast: false,     // 默认不排除 Comcast
  excludeLandline: false,    // 默认不排除座机
});
```

### 1.2 过滤条件传递逻辑（TpsSearch.tsx 第 116-122 行）

```typescript
searchMutation.mutate({
  names,
  locations: mode === "nameLocation" ? locations : undefined,
  mode,
  filters: showFilters ? filters : undefined,  // ⚠️ 问题：只有展开过滤器时才传递！
});
```

### 🔴 问题 1：默认过滤条件未生效

**问题描述：**
- 前端设置了默认值 `minAge: 50, maxAge: 79, minYear: 2025`
- 但只有当用户展开过滤器面板（`showFilters = true`）时才会传递 `filters`
- 如果用户不展开过滤器，`filters` 为 `undefined`，默认过滤条件不会生效！

**影响：**
- 用户期望默认过滤 50-79 岁、2025 年号码
- 但实际上如果不点击"高级过滤"，这些条件都不会应用

---

## 二、后端过滤条件分析

### 2.1 过滤条件 Schema（router.ts 第 50-58 行）

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
```

### 2.2 过滤条件传递（router.ts 第 182、474、603 行）

```typescript
// 创建任务时
filters: input.filters || {},

// 调用 searchOnly 时
input.filters || {},

// 调用 fetchDetailsInBatch 时
input.filters || {},
```

### ✅ 后端处理正确

后端正确地将 `undefined` 转换为空对象 `{}`，然后传递给 scraper。

---

## 三、Scraper 过滤实现分析

### 3.1 过滤函数一览

| 函数名 | 位置 | 作用 | 调用时机 |
|--------|------|------|----------|
| `preFilterByAge()` | 第 150-171 行 | 搜索页年龄初筛 | 搜索阶段 |
| `shouldIncludeResult()` | 第 392-433 行 | 详情页完整过滤 | 详情阶段 |

### 3.2 preFilterByAge() - 搜索页年龄初筛

```typescript
export function preFilterByAge(results: TpsSearchResult[], filters: TpsFilters): TpsSearchResult[] {
  if (!filters.minAge && !filters.maxAge) {
    return results;  // ⚠️ 如果没有设置年龄过滤，直接返回
  }
  
  const filtered = results.filter(r => {
    if (r.age === undefined) return true;  // 没有年龄的保留
    
    // 宽松过滤（允许 ±5 岁误差）
    if (filters.minAge !== undefined && r.age < filters.minAge - 5) return false;
    if (filters.maxAge !== undefined && r.age > filters.maxAge + 5) return false;
    
    return true;
  });
  
  return filtered;
}
```

**分析：**
- ✅ 年龄过滤逻辑正确
- ✅ 宽松过滤（±5 岁）合理
- ⚠️ 但如果 `filters` 是空对象 `{}`，`filters.minAge` 和 `filters.maxAge` 都是 `undefined`，函数直接返回，不做任何过滤

### 3.3 shouldIncludeResult() - 详情页完整过滤

```typescript
export function shouldIncludeResult(result: TpsDetailResult, filters: TpsFilters): boolean {
  // 1. 年龄过滤
  if (result.age !== undefined) {
    if (filters.minAge !== undefined && result.age < filters.minAge) return false;
    if (filters.maxAge !== undefined && result.age > filters.maxAge) return false;
  }
  
  // 2. 电话年份过滤
  if (filters.minYear !== undefined && result.reportYear !== undefined) {
    if (result.reportYear < filters.minYear) return false;
  }
  
  // 3. 房产价值过滤
  if (filters.minPropertyValue !== undefined && filters.minPropertyValue > 0) {
    if (!result.propertyValue || result.propertyValue < filters.minPropertyValue) return false;
  }
  
  // 4. T-Mobile 过滤
  if (filters.excludeTMobile && result.carrier) {
    const carrierLower = result.carrier.toLowerCase();
    if (carrierLower.includes('t-mobile') || carrierLower.includes('tmobile')) {
      return false;
    }
  }
  
  // 5. Comcast/Spectrum 过滤
  if (filters.excludeComcast && result.carrier) {
    const carrierLower = result.carrier.toLowerCase();
    if (carrierLower.includes('comcast') || carrierLower.includes('spectrum') || carrierLower.includes('xfinity')) {
      return false;
    }
  }
  
  // 6. 固话过滤
  if (filters.excludeLandline && result.phoneType) {
    if (result.phoneType.toLowerCase() === 'landline') {
      return false;
    }
  }
  
  return true;
}
```

**分析：**
- ✅ 所有过滤条件逻辑正确
- ⚠️ 但如果 `filters` 是空对象 `{}`，所有条件都是 `undefined` 或 `false`，函数直接返回 `true`，不做任何过滤

---

## 四、问题总结

### 🔴 核心问题：默认过滤条件未传递

| 环节 | 期望行为 | 实际行为 | 问题 |
|------|----------|----------|------|
| 前端 | 始终传递默认过滤条件 | 只有展开过滤器才传递 | ❌ |
| 后端 | 应用默认过滤条件 | 收到空对象，不过滤 | ❌ |
| Scraper | 应用默认过滤条件 | 收到空对象，不过滤 | ❌ |

### 🔴 具体影响

| 过滤条件 | 默认值 | 期望效果 | 实际效果 |
|----------|--------|----------|----------|
| minAge | 50 | 排除 <50 岁 | ❌ 不过滤 |
| maxAge | 79 | 排除 >79 岁 | ❌ 不过滤 |
| minYear | 2025 | 排除 <2025 年号码 | ❌ 不过滤 |
| minPropertyValue | 0 | 不过滤 | ✅ 正确 |
| excludeTMobile | false | 不过滤 | ✅ 正确 |
| excludeComcast | false | 不过滤 | ✅ 正确 |
| excludeLandline | false | 不过滤 | ✅ 正确 |

---

## 五、修复方案

### 方案 1：前端始终传递 filters（推荐）

修改 TpsSearch.tsx 第 116-122 行：

```typescript
// 修改前
filters: showFilters ? filters : undefined,

// 修改后
filters: filters,  // 始终传递，包含默认值
```

**优点：**
- 修改最小
- 默认值在前端定义，用户可以看到并修改
- 后端和 Scraper 代码不需要改动

### 方案 2：后端设置默认值

修改 router.ts，当 `filters` 为空时应用默认值：

```typescript
const defaultFilters: TpsFilters = {
  minAge: 50,
  maxAge: 79,
  minYear: 2025,
};

const effectiveFilters = {
  ...defaultFilters,
  ...(input.filters || {}),
};
```

**优点：**
- 后端控制默认值，更安全
- 前端可以不传递 filters

**缺点：**
- 需要修改多处代码
- 前端和后端默认值可能不一致

---

## 六、推荐修复

**采用方案 1**：前端始终传递 filters

这样：
1. 修改最小，只需改一行代码
2. 默认值在前端定义，用户可以在 UI 上看到
3. 后端和 Scraper 代码不需要改动
4. 保持代码一致性



---

## 七、发现的额外问题

### 🔴 问题 2：缓存只返回一条电话记录

**位置：** router.ts 第 434-443 行

```typescript
const getCachedDetails = async (links: string[]) => {
  const cached = await getCachedTpsDetails(links);
  const map = new Map<string, TpsDetailResult>();
  for (const item of cached) {
    if (item.data) {
      map.set(item.detailLink, item.data as TpsDetailResult);  // ⚠️ 相同 detailLink 会覆盖！
    }
  }
  return map;
};
```

**问题描述：**
- 一个人可能有多个电话号码
- 缓存中保存了多条记录（每个电话一条）
- 但 `Map` 使用 `detailLink` 作为 key，相同 `detailLink` 只保留最后一条
- 导致缓存命中时只返回一个电话号码

**影响：**
- 第一次搜索：返回所有电话号码（5 个）
- 第二次搜索（缓存命中）：只返回 1 个电话号码

**修复方案：**
将 `Map<string, TpsDetailResult>` 改为 `Map<string, TpsDetailResult[]>`

---

## 八、修复清单

| # | 问题 | 位置 | 修复方案 | 状态 |
|---|------|------|----------|------|
| 1 | 默认过滤条件未传递 | TpsSearch.tsx | 始终传递 filters | ✅ 已修复 |
| 2 | 缓存只返回一条记录 | router.ts | 改为返回数组 | 待修复 |

