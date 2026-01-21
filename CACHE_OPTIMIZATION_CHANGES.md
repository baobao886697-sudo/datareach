# LeadHunter Pro 缓存优化修改说明

## 一、修改概述

本次修改优化了搜索缓存命中机制，实现了以下功能：

1. **精确一对一匹配**：缓存键 = `name + title + state + limit` 的精确组合
2. **80% 数据充足率阈值**：只有当缓存数据量 / Apify 返回总量 >= 80% 时才命中缓存
3. **随机提取**：命中缓存后，从缓存数据中随机提取用户请求的数量
4. **全局共享**：所有用户共享同一缓存池

## 二、修改的文件

### `server/services/searchProcessorV3.ts`

#### 2.1 新增缓存数据结构类型

```typescript
/**
 * 缓存数据结构
 * 存储搜索结果和元数据，用于精确的缓存命中判断
 */
export interface SearchCacheData {
  data: LeadPerson[];           // 实际数据
  totalAvailable: number;       // Apify 返回的总量（数据库中符合条件的估计值）
  requestedCount: number;       // 用户请求的数量
  searchParams: {               // 搜索参数（用于验证）
    name: string;
    title: string;
    state: string;
    limit: number;
  };
  createdAt: string;            // 缓存创建时间
}
```

#### 2.2 修改缓存键生成函数

```typescript
/**
 * 生成搜索哈希（精确一对一匹配）
 * 缓存键 = name + title + state + limit 的精确组合
 * 每个搜索组合完全独立，不会交叉命中
 */
function generateSearchHash(name: string, title: string, state: string, limit: number): string {
  const normalized = `${name.toLowerCase().trim()}|${title.toLowerCase().trim()}|${state.toLowerCase().trim()}|${limit}`;
  return crypto.createHash('md5').update(normalized).digest('hex');
}
```

#### 2.3 修改缓存存储逻辑

存储时使用新的缓存数据结构，包含 `totalAvailable` 字段：

```typescript
const cacheData: SearchCacheData = {
  data: apifyResults,
  totalAvailable: apifyResults.length,  // Apify 返回的总量作为数据库估计值
  requestedCount: requestedCount,
  searchParams: {
    name: searchName,
    title: searchTitle,
    state: searchState,
    limit: requestedCount
  },
  createdAt: new Date().toISOString()
};
await setCache(cacheKey, 'search', cacheData, 180);
```

#### 2.4 修改缓存命中逻辑

```typescript
// 计算缓存数据充足率
const fulfillmentRate = cachedSearchData.data.length / cachedSearchData.totalAvailable;

if (fulfillmentRate >= CACHE_FULFILLMENT_THRESHOLD) {  // 0.8 = 80%
  // 缓存数据充足（>= 80%），使用缓存并随机提取
  const shuffledCache = shuffleArray([...cachedSearchData.data]);
  apifyResults = shuffledCache.slice(0, Math.min(requestedCount, shuffledCache.length));
} else {
  // 缓存数据不足（< 80%），需要重新调用 Apify API
  // ... 调用 Apify API
}
```

## 三、缓存命中示例

### 示例 1：缓存命中

```
搜索条件: John + CEO + California + 100
缓存数据: 90 条
Apify 数据库估计: 100 条
充足率: 90/100 = 90% >= 80%
结果: 命中缓存，随机提取 90 条
```

### 示例 2：缓存不命中

```
搜索条件: John + CEO + California + 100
缓存数据: 80,000 条
Apify 数据库估计: 110,000 条
充足率: 80,000/110,000 = 72.7% < 80%
结果: 不命中，重新调用 Apify API
```

### 示例 3：不同搜索条件不会交叉命中

```
搜索 A: John + CEO + California + 100  → 缓存键 A
搜索 B: John + CEO + Texas + 100       → 缓存键 B
搜索 C: John + CEO + California + 500  → 缓存键 C

三个搜索条件使用完全不同的缓存键，互不影响
```

## 四、向后兼容

代码支持新旧两种缓存格式：

- **旧格式**：直接存储 `LeadPerson[]` 数组
- **新格式**：存储 `SearchCacheData` 对象

当读取旧格式缓存时，会自动转换为新格式进行处理。

## 五、常量定义

```typescript
const CACHE_FULFILLMENT_THRESHOLD = 0.8; // 缓存数据充足率阈值（80%）
```

## 六、部署注意事项

1. 修改后需要重新部署后端服务
2. 旧缓存数据会自动兼容，无需清理
3. 新的缓存数据会使用新格式存储

## 七、测试建议

1. 测试相同搜索条件的缓存命中
2. 测试不同搜索条件的缓存隔离
3. 测试缓存充足率低于 80% 时的重新获取
4. 测试随机提取的数据分布
