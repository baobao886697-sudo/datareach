# SearchPeopleFree (SPF) 模块架构设计

## 模块概述

SPF 模块是 DataReach 系统的第三个人员搜索模块，与 TPS 和 Anywho 并列。
其独特亮点包括：电子邮件信息、电话类型标注、婚姻状态、数据确认日期等。

## 文件结构

```
server/
└── spf/
    ├── db.ts          # 数据库操作
    ├── router.ts      # API 路由
    └── scraper.ts     # 网页抓取逻辑

client/src/
└── components/
    └── spf/
        ├── SpfSearch.tsx      # 搜索页面
        ├── SpfProgress.tsx    # 进度页面
        └── SpfResults.tsx     # 结果展示

drizzle/
└── schema.ts          # 添加 SPF 相关表
```

## 数据库表设计

### 1. spf_config - SPF 配置表
```sql
CREATE TABLE spf_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  search_cost DECIMAL(10,2) DEFAULT 0.3,     -- 每搜索页积分
  detail_cost DECIMAL(10,2) DEFAULT 0.3,     -- 每详情页积分
  max_concurrent INT DEFAULT 40,              -- 最大并发数
  cache_days INT DEFAULT 180,                 -- 缓存天数
  scrape_do_token VARCHAR(100),               -- Scrape.do API Token
  max_pages INT DEFAULT 25,                   -- 最大搜索页数
  batch_delay INT DEFAULT 200,                -- 批次间延迟(ms)
  enabled BOOLEAN DEFAULT TRUE,               -- 是否启用
  default_min_age INT DEFAULT 50,             -- 默认最小年龄
  default_max_age INT DEFAULT 79,             -- 默认最大年龄
  updated_at TIMESTAMP DEFAULT NOW() ON UPDATE NOW()
);
```

### 2. spf_detail_cache - SPF 详情页缓存表
```sql
CREATE TABLE spf_detail_cache (
  id INT AUTO_INCREMENT PRIMARY KEY,
  detail_link VARCHAR(500) NOT NULL UNIQUE,
  data JSON,                                  -- 详情数据
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);
```

### 3. spf_search_tasks - SPF 搜索任务表
```sql
CREATE TABLE spf_search_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id VARCHAR(32) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  mode ENUM('nameOnly', 'nameLocation') DEFAULT 'nameOnly',
  names JSON NOT NULL,                        -- 搜索姓名列表
  locations JSON,                             -- 搜索地点列表
  filters JSON,                               -- 过滤条件
  total_sub_tasks INT DEFAULT 0,
  completed_sub_tasks INT DEFAULT 0,
  total_results INT DEFAULT 0,
  search_page_requests INT DEFAULT 0,
  detail_page_requests INT DEFAULT 0,
  cache_hits INT DEFAULT 0,
  credits_used DECIMAL(10,2) DEFAULT 0,
  status ENUM('pending','running','completed','failed','cancelled','insufficient_credits') DEFAULT 'pending',
  progress INT DEFAULT 0,
  logs JSON,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);
```

### 4. spf_search_results - SPF 搜索结果表（包含独特字段）
```sql
CREATE TABLE spf_search_results (
  id INT AUTO_INCREMENT PRIMARY KEY,
  task_id INT NOT NULL,
  sub_task_index INT DEFAULT 0,
  
  -- 基础字段
  name VARCHAR(200),
  search_name VARCHAR(200),
  search_location VARCHAR(200),
  age INT,
  birth_year VARCHAR(20),                     -- ★ 出生年份 "1976 or 1975"
  city VARCHAR(100),
  state VARCHAR(50),
  location VARCHAR(200),
  
  -- 电话信息（独特：电话类型）
  phone VARCHAR(50),
  phone_type VARCHAR(50),                     -- ★ "Home/LandLine" / "Wireless"
  carrier VARCHAR(100),
  report_year INT,
  
  -- ★ SPF 独特字段
  email VARCHAR(200),                         -- ★ 电子邮件
  marital_status VARCHAR(50),                 -- ★ 婚姻状态
  spouse_name VARCHAR(200),                   -- ★ 配偶姓名
  spouse_link VARCHAR(500),                   -- ★ 配偶链接
  employment VARCHAR(200),                    -- ★ 就业状态
  confirmed_date DATE,                        -- ★ 数据确认日期
  latitude DECIMAL(10,6),                     -- ★ 纬度
  longitude DECIMAL(10,6),                    -- ★ 经度
  
  -- 其他字段
  is_primary BOOLEAN DEFAULT FALSE,
  property_value INT DEFAULT 0,
  year_built INT,
  detail_link VARCHAR(500),
  from_cache BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMP DEFAULT NOW()
);
```

## 数据字段映射

### 从 HTML 解析的字段

| HTML 元素 | 数据库字段 | 说明 |
|-----------|------------|------|
| `<header><p>John Smith</p></header>` | name | 姓名 |
| `Age 50` | age | 年龄 |
| `(1976 or 1975)` | birth_year | 出生年份范围 |
| `jh*****r@epix.net` | email | 电子邮件 |
| `Married to Jennifer A Smith` | marital_status, spouse_name | 婚姻状态 |
| `[No known employment]` | employment | 就业状态 |
| `(901) 465-1839` | phone | 电话号码 |
| `Home/LandLine Phone` | phone_type | 电话类型 |
| `Confirmed on January 27, 2026` | confirmed_date | 确认日期 |
| `41.388416,-81.793122` | latitude, longitude | 地理坐标 |

## 积分计算

与 TPS 模块保持一致：
- 搜索页消耗：0.3 积分/页
- 详情页消耗：0.3 积分/条
- 总消耗 = 搜索页数 × 0.3 + 详情数 × 0.3

## 前端设计要点

### 七彩鎏金色主题
- 主色调：金色渐变 (#FFD700 → #FFA500)
- 强调色：彩虹渐变效果
- 卡片背景：深色配金色边框

### 独特数据展示
1. **电子邮件** - 显眼位置，带邮件图标
2. **电话类型** - 手机图标/座机图标区分
3. **婚姻状态** - 心形图标+配偶链接
4. **数据确认日期** - 显示数据新鲜度
5. **地图定位** - 可选显示地图

## API 端点设计

```
POST /api/spf/search          # 创建搜索任务
GET  /api/spf/task/:taskId    # 获取任务状态
GET  /api/spf/results/:taskId # 获取搜索结果
GET  /api/spf/export/:taskId  # 导出 CSV
GET  /api/spf/history         # 搜索历史
```

## 实现顺序

1. 添加数据库表到 schema.ts
2. 创建 server/spf/db.ts
3. 创建 server/spf/scraper.ts
4. 创建 server/spf/router.ts
5. 更新主路由 routers.ts
6. 创建前端组件
7. 添加管理后台配置
8. 测试和优化
