# LeadHunter Pro 缓存命中机制详细分析

## 一、缓存系统概述

LeadHunter Pro 使用数据库表 `global_cache` 实现全局缓存系统，主要用于缓存 Apify 搜索结果，减少重复 API 调用，提高响应速度并节省成本。

---

## 二、缓存表结构

### 2.1 global_cache 表定义 (schema.ts)

```typescript
export const globalCache = mysqlTable("global_cache", {
  id: int("id").autoincrement().primaryKey(),
  cacheKey: varchar("cacheKey", { length: 100 }).notNull().unique(),
  cacheType: mysqlEnum("cacheType", ["search", "person", "verification"]).notNull(),
  data: json("data").notNull(),
  hitCount: int("hitCount").default(0),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
```

### 2.2 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 自增主键 |
| cacheKey | varchar(100) | 缓存键，唯一索引 |
| cacheType | enum | 缓存类型：search/person/verification |
| data | json | 缓存的数据内容 |
| hitCount | int | 缓存命中次数 |
| expiresAt | timestamp | 过期时间 |
| createdAt | timestamp | 创建时间 |

---

## 三、缓存键生成

### 3.1 搜索哈希生成函数 (searchProcessorV3.ts)

```typescript
function generateSearchHash(name: string, title: string, state: string): string {
  // 标准化输入：转小写并去除首尾空格
  const normalized = `${name.toLowerCase().trim()}|${title.toLowerCase().trim()}|${state.toLowerCase().trim()}`;
  
  // 生成 MD5 哈希
  return crypto.createHash('md5').update(normalized).digest('hex');
}
```

### 3.2 缓存键格式

| 缓存类型 | 键格式 | 示例 |
|----------|--------|------|
| 搜索缓存 | apify:{searchHash} | apify:a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6 |
| 个人缓存 | person:{personId} | person:abc123def456 |
| 验证缓存 | verify:{phoneHash} | verify:1234567890 |

### 3.3 哈希生成示例

```
输入:
  name = "John Smith"
  title = "CEO"
  state = "California"

标准化:
  "john smith|ceo|california"

输出:
  MD5 哈希值（32位十六进制字符串）
```

---

## 四、缓存操作函数

### 4.1 获取缓存 (db.ts)

```typescript
export async function getCacheByKey(cacheKey: string): Promise<GlobalCache | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  
  try {
    // 查询未过期的缓存
    const result = await db.select().from(globalCache)
      .where(and(
        eq(globalCache.cacheKey, cacheKey), 
        gte(globalCache.expiresAt, new Date())  // 过期时间 >= 当前时间
      ))
      .limit(1);
    
    // 如果找到缓存，更新命中计数
    if (result.length > 0) {
      await db.update(globalCache)
        .set({ hitCount: sql`${globalCache.hitCount} + 1` })
        .where(eq(globalCache.cacheKey, cacheKey));
    }
    
    return result.length > 0 ? result[0] : undefined;
  } catch (error) {
    console.error('获取缓存失败:', error);
    return undefined;
  }
}
```

**关键点**:
- 自动过滤已过期的缓存
- 每次命中自动增加 hitCount
- 返回完整的缓存对象

### 4.2 设置缓存 (db.ts)

```typescript
export async function setCache(
  cacheKey: string, 
  cacheType: "search" | "person" | "verification", 
  data: any, 
  ttlDays: number = 180
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  try {
    // 计算过期时间
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    
    // 插入或更新缓存
    await db.insert(globalCache)
      .values({ 
        cacheKey, 
        cacheType, 
        data, 
        expiresAt,
        hitCount: 0 
      })
      .onDuplicateKeyUpdate({ 
        set: { 
          data, 
          expiresAt,
          // 注意：更新时不重置 hitCount
        } 
      });
  } catch (error) {
    console.error('设置缓存失败:', error);
  }
}
```

**关键点**:
- 默认 TTL 为 180 天
- 使用 upsert 模式（插入或更新）
- 更新时保留原有的 hitCount

### 4.3 删除缓存 (db.ts)

```typescript
export async function deleteCache(cacheKey: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  try {
    await db.delete(globalCache)
      .where(eq(globalCache.cacheKey, cacheKey));
  } catch (error) {
    console.error('删除缓存失败:', error);
  }
}
```

### 4.4 清理过期缓存 (db.ts)

```typescript
export async function cleanExpiredCache(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  try {
    const result = await db.delete(globalCache)
      .where(lt(globalCache.expiresAt, new Date()));
    
    return result.rowsAffected || 0;
  } catch (error) {
    console.error('清理过期缓存失败:', error);
    return 0;
  }
}
```

---

## 五、缓存命中流程

### 5.1 搜索缓存检查 (searchProcessorV3.ts)

```typescript
// ========== 阶段2: 检查缓存或调用 Apify ==========
addLog(`🔍 开始搜索数据...`, 'info', 'apify', '');

// 生成搜索哈希
const searchHash = generateSearchHash(searchName, searchTitle, searchState);
const cacheKey = `apify:${searchHash}`;

// 检查缓存
const cached = await getCacheByKey(cacheKey);

if (cached) {
  // ===== 缓存命中 =====
  addLog(`✨ 命中全局缓存！`, 'success', 'apify', '✨');
  
  // 使用缓存数据
  apifyResults = cached.data as LeadPerson[];
  stats.apifyReturned = apifyResults.length;
  stats.cacheHit = true;
  
  addLog(`📦 缓存中有 ${apifyResults.length} 条记录可用`, 'info', 'apify', '');
  addLog(`⏭️ 跳过 Apify API 调用，节省时间和成本`, 'info', 'apify', '');
  
} else {
  // ===== 缓存未命中 =====
  addLog(`🌐 未命中缓存，调用 Apify API...`, 'info', 'apify', '');
  
  // 调用 Apify API
  stats.apifyApiCalls++;
  const searchResult = await apifySearchPeople(
    searchName, 
    searchTitle, 
    searchState, 
    requestedCount, 
    userId
  );
  
  if (!searchResult.success) {
    throw new Error(searchResult.error || 'Apify 搜索失败');
  }
  
  apifyResults = searchResult.people;
  stats.apifyReturned = apifyResults.length;
  
  addLog(`📥 Apify 返回 ${apifyResults.length} 条记录`, 'info', 'apify', '');
  
  // 缓存搜索结果
  if (apifyResults.length > 0) {
    await setCache(cacheKey, 'search', apifyResults, 180);
    addLog(`💾 已缓存搜索结果 (180天有效)`, 'info', 'apify', '');
  }
}
```

### 5.2 流程图

```
开始搜索
    │
    ▼
生成 searchHash
    │
    ▼
构建 cacheKey = "apify:{searchHash}"
    │
    ▼
调用 getCacheByKey(cacheKey)
    │
    ├─── 缓存存在且未过期 ───┐
    │                        │
    ▼                        ▼
调用 Apify API          使用缓存数据
    │                        │
    ▼                        │
缓存结果 (180天)              │
    │                        │
    └────────────────────────┘
                │
                ▼
           继续处理数据
```

---

## 六、缓存配置

### 6.1 系统配置 (system_configs)

| 配置键 | 默认值 | 说明 |
|--------|--------|------|
| CACHE_TTL_DAYS | 180 | 缓存有效期（天） |

### 6.2 代码中的默认值

```typescript
// db.ts
export async function setCache(
  cacheKey: string, 
  cacheType: "search" | "person" | "verification", 
  data: any, 
  ttlDays: number = 180  // 默认 180 天
): Promise<void>
```

---

## 七、缓存统计

### 7.1 统计函数 (db.ts)

```typescript
export async function getCacheStats(): Promise<{
  totalEntries: number;
  searchCache: number;
  personCache: number;
  verificationCache: number;
  totalHits: number;
}> {
  const db = await getDb();
  if (!db) return { 
    totalEntries: 0, 
    searchCache: 0, 
    personCache: 0, 
    verificationCache: 0, 
    totalHits: 0 
  };
  
  try {
    // 统计各类型缓存数量
    const stats = await db.select({
      cacheType: globalCache.cacheType,
      count: sql<number>`COUNT(*)`,
      totalHits: sql<number>`SUM(${globalCache.hitCount})`,
    })
    .from(globalCache)
    .where(gte(globalCache.expiresAt, new Date()))  // 只统计未过期的
    .groupBy(globalCache.cacheType);
    
    const result = {
      totalEntries: 0,
      searchCache: 0,
      personCache: 0,
      verificationCache: 0,
      totalHits: 0,
    };
    
    for (const row of stats) {
      result.totalEntries += row.count;
      result.totalHits += row.totalHits || 0;
      
      switch (row.cacheType) {
        case 'search':
          result.searchCache = row.count;
          break;
        case 'person':
          result.personCache = row.count;
          break;
        case 'verification':
          result.verificationCache = row.count;
          break;
      }
    }
    
    return result;
  } catch (error) {
    console.error('获取缓存统计失败:', error);
    return { 
      totalEntries: 0, 
      searchCache: 0, 
      personCache: 0, 
      verificationCache: 0, 
      totalHits: 0 
    };
  }
}
```

### 7.2 管理后台显示

从管理后台截图可以看到：
- 缓存条目: 1,254 条

---

## 八、缓存命中的优势

### 8.1 性能优势

| 场景 | 无缓存 | 有缓存 |
|------|--------|--------|
| 响应时间 | 30-60秒 (Apify API) | <1秒 |
| API 调用 | 每次都调用 | 跳过调用 |
| 成本 | 消耗 Apify 积分 | 无额外成本 |

### 8.2 日志示例

**缓存命中时**:
```
✨ 命中全局缓存！
📦 缓存中有 500 条记录可用
⏭️ 跳过 Apify API 调用，节省时间和成本
```

**缓存未命中时**:
```
🌐 未命中缓存，调用 Apify API...
📥 Apify 返回 500 条记录
💾 已缓存搜索结果 (180天有效)
```

---

## 九、缓存键冲突处理

### 9.1 相同搜索条件

当两个用户使用相同的搜索条件（name + title + state）时：
- 生成的 searchHash 相同
- 第二个用户会命中第一个用户创建的缓存
- 这是预期行为，可以节省 API 调用

### 9.2 不同搜索数量

**注意**: 当前实现中，searchHash 不包含搜索数量（limit）。这意味着：
- 搜索 100 条和搜索 500 条会使用相同的缓存
- 如果缓存中只有 100 条数据，搜索 500 条时只能返回 100 条

```typescript
// 当前实现
const normalized = `${name}|${title}|${state}`;  // 不包含 limit

// 如果需要区分数量，可以改为：
const normalized = `${name}|${title}|${state}|${limit}`;
```

---

## 十、缓存清理策略

### 10.1 自动过期

缓存会在 `expiresAt` 时间后自动失效：
- 查询时自动过滤过期缓存
- 不会返回过期数据

### 10.2 手动清理

可以调用 `cleanExpiredCache()` 函数清理过期缓存：
```typescript
const deletedCount = await cleanExpiredCache();
console.log(`清理了 ${deletedCount} 条过期缓存`);
```

### 10.3 定期清理建议

建议设置定时任务，每天清理一次过期缓存：
```typescript
// 每天凌晨 3 点清理
cron.schedule('0 3 * * *', async () => {
  const count = await cleanExpiredCache();
  console.log(`定时清理: 删除了 ${count} 条过期缓存`);
});
```

---

## 十一、总结

### 11.1 缓存机制特点

1. **全局共享**: 所有用户共享缓存，相同搜索条件复用结果
2. **长期有效**: 默认 180 天有效期
3. **自动统计**: 记录命中次数，便于分析
4. **透明处理**: 对用户透明，自动判断是否使用缓存

### 11.2 缓存键组成

```
cacheKey = "apify:" + MD5(name + "|" + title + "|" + state)
```

### 11.3 缓存命中条件

1. cacheKey 存在于 global_cache 表
2. expiresAt >= 当前时间
3. data 字段包含有效的 JSON 数据
