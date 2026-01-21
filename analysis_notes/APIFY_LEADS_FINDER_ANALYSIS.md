# Apify Leads Finder 数据返回机制分析

## 一、核心参数

### 1.1 fetch_count 参数

```
参数名: fetch_count
类型: integer
默认值: 50000
说明: 留空则抓取所有符合条件的数据
```

**关键发现**：
- `fetch_count` 是用户**请求**的数量上限
- 如果 Apify 数据库中符合条件的数据少于 `fetch_count`，则返回实际可用数量
- 如果数据库中数据多于 `fetch_count`，则返回 `fetch_count` 条

### 1.2 搜索条件参数

| 参数 | 类型 | 说明 |
|------|------|------|
| contact_job_title | array | 职位筛选 |
| contact_location | string[] | 地区筛选 (州/国家) |
| contact_city | array | 城市筛选 |
| company_keywords | array | 公司关键词 |
| company_industry | string[] | 行业筛选 |
| size | string[] | 公司规模 |
| seniority_level | string[] | 资历级别 |

## 二、数据返回机制

### 2.1 返回数据量的决定因素

```
实际返回量 = min(fetch_count, 数据库中符合条件的总量)
```

**示例**：
- 搜索条件: CEO + California
- 数据库中符合条件: 110,000 条
- 用户请求 fetch_count: 100 条
- 实际返回: 100 条

### 2.2 数据库总量的不确定性

Apify Leads Finder 的数据来源是其内部数据库，该数据库：
- 数据量会随时间变化（新增/删除）
- 不同搜索条件对应不同的数据池
- 无法预先知道某个搜索条件对应多少数据

## 三、缓存策略设计建议

### 3.1 用户需求理解

用户的需求是：
> "缓存有80000，Apify搜索返回的数据有110000，没有超过80%不使用缓存"

这意味着：
- 缓存数据量 / Apify 数据库总量 >= 80% 才能使用缓存
- 但问题是：**如何知道 Apify 数据库总量？**

### 3.2 可行方案

**方案 A: 在缓存时记录 Apify 返回的总量**

当首次调用 Apify 时，请求一个较大的数量（如 requestedCount * 2），
然后记录实际返回的数量作为"该搜索条件的数据库总量估计值"。

```typescript
// 缓存数据结构
interface CacheData {
  data: LeadPerson[];           // 实际数据
  totalAvailable: number;       // Apify 返回的总量（估计值）
  requestedCount: number;       // 用户请求的数量
  createdAt: string;            // 缓存创建时间
}

// 缓存命中条件
const fulfillmentRate = cachedData.data.length / cachedData.totalAvailable;
if (fulfillmentRate >= 0.8) {
  // 使用缓存
}
```

**方案 B: 每次都先调用 Apify 获取最新数据量**

这会增加 API 调用成本，不推荐。

**方案 C: 基于用户请求数量的简化策略**

```typescript
// 缓存命中条件：缓存数据量 >= 用户请求数量的 80%
const fulfillmentRate = cachedData.length / requestedCount;
if (fulfillmentRate >= 0.8) {
  // 使用缓存，随机提取 requestedCount 条
}
```

## 四、当前代码中的调用方式

```typescript
// searchProcessorV3.ts 第 529 行
const searchResult = await apifySearchPeople(
  searchName, 
  searchTitle, 
  searchState, 
  requestedCount * 2,  // 请求 2 倍数量
  userId
);
```

这意味着：
- 用户请求 100 条，实际向 Apify 请求 200 条
- Apify 返回的数量可以作为"数据库总量估计值"

## 五、结论

根据当前代码逻辑，可以实现用户的需求：

1. **缓存键**: `name + title + state + limit` 精确匹配
2. **缓存时记录**: 存储 Apify 返回的总量作为 `totalAvailable`
3. **缓存命中条件**: `缓存数据量 / totalAvailable >= 80%`
4. **命中后处理**: 从缓存中随机提取用户请求的数量
