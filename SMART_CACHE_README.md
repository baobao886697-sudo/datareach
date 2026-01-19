# 智能缓存系统说明

## 概述

智能缓存系统是 LeadHunter Pro 的核心功能之一，旨在：
1. **节省 API 调用成本** - 通过缓存复用减少 Apollo API 调用
2. **避免数据重复分配** - 确保不同用户获取不同的数据
3. **提高搜索效率** - 缓存命中时无需等待 API 响应

---

## 核心功能

### 1. 80% 覆盖率阈值

**配置项：** `CACHE_COVERAGE_THRESHOLD`（默认：80）

**逻辑：**
- 系统会先获取 Apollo API 返回的总数据量
- 然后检查缓存中的数据量
- 计算覆盖率 = 缓存数量 / Apollo 总数量 × 100%
- 只有当覆盖率 ≥ 阈值时，才使用缓存

**示例：**
```
Apollo 总量: 100,000 条
缓存数量: 85,000 条
覆盖率: 85% ≥ 80% (阈值)
结果: ✅ 使用缓存
```

```
Apollo 总量: 100,000 条
缓存数量: 50,000 条
覆盖率: 50% < 80% (阈值)
结果: ❌ 调用 API 获取新数据
```

### 2. 已分配记录排除（30天过期）

**配置项：** `ASSIGNED_RECORD_EXPIRE_DAYS`（默认：30）

**数据库表：** `assigned_records`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| searchHash | VARCHAR(64) | 搜索条件哈希 |
| apolloId | VARCHAR(100) | Apollo 记录 ID |
| userId | INT | 分配给的用户 ID |
| assignedAt | TIMESTAMP | 分配时间 |
| expiresAt | TIMESTAMP | 过期时间（30天后） |

**逻辑：**
- 每次从缓存获取数据时，会排除已分配给其他用户的记录
- 记录在 30 天后过期，过期后可重新分配
- 确保用户 A 和用户 B 搜索相同条件时，获取不同的数据

### 3. 混合获取策略

当缓存中的可用记录不足以满足用户请求时，系统会：
1. 先从缓存中获取所有可用记录
2. 计算还需要多少条记录
3. 调用 Apollo API 获取补充数据
4. 合并缓存数据和 API 数据返回

**示例：**
```
用户请求: 50 条
缓存可用: 40 条（已排除已分配记录）
API 补充: 10 条
最终返回: 50 条
```

---

## 数据流程图

```
用户搜索: William, Director, Texas, 请求50条
    │
    ▼
获取 Apollo 总数（API 调用，仅获取计数）
Apollo 返回: totalCount = 100,000
    │
    ▼
检查缓存: 找到 85,000 条记录
计算覆盖率: 85,000 / 100,000 = 85%
    │
    ├── 85% ≥ 80% ──▶ 使用缓存
    │                    │
    │                    ▼
    │              查询已分配记录表
    │              排除 30 天内已分配的 Apollo ID
    │                    │
    │                    ▼
    │              可用记录: 60,000 条
    │                    │
    │                    ├── 60,000 ≥ 50 ──▶ 随机选取 50 条
    │                    │                    记录到已分配表
    │                    │                    返回结果
    │                    │
    │                    └── < 50 ──▶ 混合获取
    │                                  缓存 + API 补充
    │
    └── < 80% ──▶ 调用 Apollo API 获取新数据
                       │
                       ▼
                  获取新数据并保存到缓存
                  记录到已分配表
                  返回结果
```

---

## 日志示例

### 缓存命中
```
⚙️ 智能缓存阈值: 80%
🔍 正在检查智能缓存...
✨ 智能缓存命中！
   覆盖率: 85.0% (阈值: 80%)
   从缓存获取 50 条记录
   已排除已分配记录，避免重复
⏱️ 响应时间: 0.3s
```

### 混合获取
```
⚙️ 智能缓存阈值: 80%
🔍 正在检查智能缓存...
🔄 混合获取模式
   覆盖率: 82.0% (阈值: 80%)
   缓存: 40 条 + API: 10 条
⏱️ 响应时间: 2.1s
```

### API 获取
```
⚙️ 智能缓存阈值: 80%
🔍 正在检查智能缓存...
🔍 从 Apollo API 获取数据
   缓存覆盖率 50.0% < 阈值 80%
   获取 100 条记录
⏱️ 响应时间: 3.5s
```

---

## 配置管理

### 查看当前配置
```sql
SELECT * FROM system_config WHERE configKey IN ('CACHE_COVERAGE_THRESHOLD', 'ASSIGNED_RECORD_EXPIRE_DAYS');
```

### 修改覆盖率阈值
```sql
UPDATE system_config SET configValue = '70' WHERE configKey = 'CACHE_COVERAGE_THRESHOLD';
```

### 修改过期天数
```sql
UPDATE system_config SET configValue = '60' WHERE configKey = 'ASSIGNED_RECORD_EXPIRE_DAYS';
```

---

## 统计查询

### 查看已分配记录统计
```sql
SELECT 
  searchHash,
  COUNT(*) as total_assigned,
  COUNT(CASE WHEN expiresAt > NOW() THEN 1 END) as active,
  COUNT(CASE WHEN expiresAt <= NOW() THEN 1 END) as expired
FROM assigned_records
GROUP BY searchHash;
```

### 清理过期记录
```sql
DELETE FROM assigned_records WHERE expiresAt <= NOW();
```

---

## 注意事项

1. **首次搜索** - 新的搜索条件没有缓存，会直接调用 Apollo API
2. **缓存有效期** - 搜索结果缓存 180 天，已分配记录 30 天后过期
3. **覆盖率计算** - 基于 Apollo 返回的总数，可能会随时间变化
4. **混合获取** - 可能导致同一次搜索中部分数据来自缓存，部分来自 API
