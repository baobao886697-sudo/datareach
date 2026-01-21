# 缓存机制优化方案设计

## 一、当前问题分析

### 1.1 现有缓存机制

当前缓存键生成逻辑：
```typescript
function generateSearchHash(name: string, title: string, state: string): string {
  const normalized = `${name.toLowerCase().trim()}|${title.toLowerCase().trim()}|${state.toLowerCase().trim()}`;
  return crypto.createHash('md5').update(normalized).digest('hex');
}
```

**问题**：
1. 缓存键不包含搜索数量（limit），导致不同数量的搜索共享同一缓存
2. 无论 Apify 返回多少数据都会被缓存，即使数据量很少
3. 用户可以反复搜索相同条件获取相同数据

### 1.2 用户需求

1. 缓存必须按搜索条件精确匹配（包含搜索数量）
2. 只有当 Apify 返回数据量 >= 请求数量的 80% 时才缓存
3. 所有用户共享高质量缓存

---

## 二、优化方案设计

### 2.1 新的缓存键生成

将搜索数量纳入缓存键计算：

```typescript
function generateSearchHash(name: string, title: string, state: string, limit: number): string {
  // 将 limit 规范化到固定档位，避免缓存碎片化
  const normalizedLimit = normalizeLimit(limit);
  const normalized = `${name.toLowerCase().trim()}|${title.toLowerCase().trim()}|${state.toLowerCase().trim()}|${normalizedLimit}`;
  return crypto.createHash('md5').update(normalized).digest('hex');
}

// 规范化搜索数量到固定档位
function normalizeLimit(limit: number): number {
  // 将搜索数量规范化到固定档位：100, 500, 1000, 5000
  if (limit <= 100) return 100;
  if (limit <= 500) return 500;
  if (limit <= 1000) return 1000;
  return 5000;
}
```

### 2.2 数据充足率检查（80%阈值）

只有当 Apify 返回的数据量达到请求数量的 80% 时，才将结果存入缓存：

```typescript
const CACHE_THRESHOLD = 0.8;  // 80% 数据充足率阈值

// 在获取 Apify 数据后
const dataFulfillmentRate = apifyResults.length / requestedCount;

if (dataFulfillmentRate >= CACHE_THRESHOLD) {
  // 数据充足，存入缓存
  await setCache(cacheKey, 'search', apifyResults, 180);
  addLog(`💾 数据充足率 ${(dataFulfillmentRate * 100).toFixed(0)}%，已缓存结果`, 'success', 'apify', '');
} else {
  // 数据不足，不缓存
  addLog(`⚠️ 数据充足率 ${(dataFulfillmentRate * 100).toFixed(0)}% < 80%，不缓存此结果`, 'warning', 'apify', '');
}
```

### 2.3 缓存命中时的数据充足率验证

即使命中缓存，也要检查缓存数据是否满足当前请求：

```typescript
if (cached) {
  const cachedData = cached.data as LeadPerson[];
  const cacheDataFulfillmentRate = cachedData.length / requestedCount;
  
  if (cacheDataFulfillmentRate >= CACHE_THRESHOLD) {
    // 缓存数据充足，使用缓存
    addLog(`✨ 命中缓存！数据充足率 ${(cacheDataFulfillmentRate * 100).toFixed(0)}%`, 'success', 'apify', '');
    apifyResults = cachedData;
  } else {
    // 缓存数据不足，重新调用 API
    addLog(`⚠️ 缓存数据不足 (${cachedData.length}/${requestedCount})，重新获取`, 'warning', 'apify', '');
    // 调用 Apify API...
  }
}
```

### 2.4 缓存元数据增强

在缓存中存储更多元数据，便于精确匹配：

```typescript
interface CacheMetadata {
  searchParams: {
    name: string;
    title: string;
    state: string;
    limit: number;
  };
  dataCount: number;
  fulfillmentRate: number;
  createdAt: string;
}

// 存储时
const cacheData = {
  metadata: {
    searchParams: { name: searchName, title: searchTitle, state: searchState, limit: requestedCount },
    dataCount: apifyResults.length,
    fulfillmentRate: apifyResults.length / requestedCount,
    createdAt: new Date().toISOString(),
  },
  data: apifyResults,
};

await setCache(cacheKey, 'search', cacheData, 180);
```

---

## 三、实现步骤

### 3.1 修改 searchProcessorV3.ts

1. 更新 `generateSearchHash` 函数，加入 limit 参数
2. 添加 `normalizeLimit` 函数
3. 添加 `CACHE_THRESHOLD` 常量
4. 修改缓存存储逻辑，加入充足率检查
5. 修改缓存命中逻辑，验证数据充足率

### 3.2 修改 previewSearch 函数

更新预览搜索中的缓存检查逻辑，使用新的缓存键格式。

### 3.3 日志增强

添加更详细的缓存相关日志，让用户了解缓存状态。

---

## 四、代码修改清单

| 文件 | 修改内容 |
|------|----------|
| server/services/searchProcessorV3.ts | 1. 修改 generateSearchHash 函数<br>2. 添加 normalizeLimit 函数<br>3. 添加 CACHE_THRESHOLD 常量<br>4. 修改缓存存储逻辑<br>5. 修改缓存命中逻辑 |

---

## 五、预期效果

1. **精确匹配**: 不同搜索数量的请求使用不同的缓存
2. **高质量缓存**: 只缓存数据充足率 >= 80% 的结果
3. **全局共享**: 所有用户共享高质量缓存
4. **透明日志**: 用户可以看到缓存命中/未命中的原因
