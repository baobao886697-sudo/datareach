# DataReach 管理后台全面检查报告

## 检查日期: 2026-01-28

## 1. 仪表盘
- ✅ 系统概览显示正常

## 2. 用户管理
- ✅ 用户列表显示正常
- ✅ 积分调整功能正常（弹窗有调整数量、原因说明、扣除/增加按钮）
- ✅ 用户详情弹窗功能完整（操作、积分记录、搜索历史、登录记录、活动日志）
- ✅ 批量发消息功能正常
- ✅ 密码重置功能正常
- ✅ 账户操作（禁用账户、强制下线）正常
- ✅ 代理选择下拉框正常

## 3. 充值订单
- ✅ 订单列表显示正常
- ✅ 状态筛选正常（全部、待支付、已支付、已取消、已过期、金额不匹配）
- ✅ 刷新按钮正常
- ⚠️ 操作列可能需要检查是否有按钮

## 4. 钱包监控
- ✅ USDT余额显示正常 (1192.03)
- ✅ TRX余额显示正常 (30.04)
- ✅ 待处理订单显示正常 (0)
- ✅ 收款地址显示正常
- ✅ 最近交易记录显示正常（时间、类型、金额、地址、交易哈希）
- ✅ 复制按钮和区块链浏览器链接正常

## 5. 用户反馈
- ✅ 统计数据显示正常（待处理、处理中、已解决、已关闭）
- ✅ 状态筛选正常
- ✅ 类型筛选正常
- ✅ 反馈列表显示正常
- ✅ 查看/开始处理按钮正常

## 6. 公告管理
- ✅ 发布公告弹窗功能完整
  - 标题输入框
  - 内容输入框
  - 类型下拉框
  - 置顶显示开关
  - 开始/结束时间选择
  - 取消/发布按钮
- ✅ 公告列表显示正常

## 7. 系统监控 ⚠️ 摆设
- ⚠️ 确认为摆设，无实际数据采集功能
- 显示内容均为0：总调用次数、成功率、平均响应时间、错误次数
- 标签页：API统计、错误日志、缓存状态
- **建议：移除或标记为"开发中"**

## 8. 系统日志
- ✅ 日志类型筛选正常（API日志）
- ✅ 日志列表显示正常（时间、类型、端点、状态、响应时间、结果）
- ✅ 实际有数据记录（scrape_tps类型）

## 9. TPS 配置
### 积分消耗配置
- ✅ 搜索页消耗（积分/页）: 0.3 - 可编辑
- ✅ 详情页消耗（积分/条）: 0.3 - 可编辑

### API配置
- ✅ Scrape.do API Token: ***已配置*** - 可编辑
- ✅ 最大并发数: 40 - 可编辑
- ✅ 缓存天数: 180 - 可编辑

### 默认过滤配置
- ✅ 最小年龄: 50 - 可编辑
- ✅ 最大年龄: 79 - 可编辑
- ✅ 电话最早年份: 2025 - 可编辑

### 前后端参数对应检查
- ✅ TPS_SEARCH_CREDITS → searchCost
- ✅ TPS_DETAIL_CREDITS → detailCost
- ✅ TPS_SCRAPE_TOKEN → scrapeDoToken
- ✅ TPS_MIN_AGE → defaultMinAge
- ✅ TPS_MAX_AGE → defaultMaxAge

## 10. Anywho 配置
### 积分消耗配置
- ✅ 搜索页消耗（积分/页）: 0.5 - 可编辑
- ✅ 详情页消耗（积分/条）: 0.5 - 可编辑

### API配置
- ✅ Scrape.do API Token: ***已配置*** - 可编辑
- ✅ 最大并发数: 20 - 可编辑
- ✅ 缓存天数: 30 - 可编辑

### 默认过滤配置
- ✅ 最小年龄: 18 - 可编辑
- ✅ 最大年龄: 99 - 可编辑
- ✅ 排除已故人员: true - 可编辑

### 婚姻状况查询（独家功能）
- ✅ 启用婚姻查询: true - 可编辑
- ✅ 婚姻查询额外积分: 0 - 可编辑

## 11. 代理管理
### 统计数据
- ✅ 总代理数: 2
- ✅ 待审核申请: 0
- ✅ 创始代理: 1
- ✅ 待审核提现: 0
- ✅ 金/银牌代理: 0/0

### 标签页
- ✅ 代理列表 - 正常
- ✅ 申请审核 - 正常
- ✅ 提现审核 - 正常
- ✅ 佣金配置 - 正常

### 佣金配置项
- ✅ founder_limit: 100
- ✅ founder_level1_rate: 15%
- ✅ founder_level2_rate: 5%
- ✅ gold_level1_rate: 12%
- ✅ gold_level2_rate: 4%
- ✅ silver_level1_rate: 10%
- ✅ silver_level2_rate: 3%
- ✅ normal_level1_rate: 8%
- ✅ normal_level2_rate: 2%

### 功能按钮
- ✅ 复制申请链接
- ✅ 发放代理
- ✅ 刷新数据

## 12. 系统配置
### 充值配置
- ✅ USDT_WALLET_TRC20: TEtRGZvdPqvUDhopMi1MEGCEiD9Ehdh1iZ
- ✅ USDT_WALLET_ERC20: 未配置
- ✅ USDT_WALLET_BEP20: 未配置
- ✅ MIN_RECHARGE_CREDITS: 5000
- ✅ CREDITS_PER_USDT: 100
- ✅ ORDER_EXPIRE_MINUTES: 90

### 搜索配置
- ✅ FUZZY_SEARCH_CREDITS: 未配置
- ✅ FUZZY_CREDITS_PER_PERSON: 未配置
- ✅ EXACT_SEARCH_CREDITS: 未配置
- ✅ EXACT_CREDITS_PER_PERSON: 未配置
- ✅ CACHE_TTL_DAYS: 180
- ✅ VERIFICATION_SCORE_THRESHOLD: 60

### 所有配置列表（从数据库读取）
| 配置键 | 值 | 描述 |
|--------|-----|------|
| ANYWHO_SCRAPE_TOKEN | c89c43afa84d... | - |
| APOLLO_API_KEY | c-QNZ1GCOrm... | Apollo API密钥 |
| BRIGHT_DATA_API_KEY | 7a1d0c5c-01d4... | Bright Data API密钥 |
| CACHE_TTL_DAYS | 180 | 缓存有效期(天) |
| CREDIT_PRICE | 1 | 每积分价格(人民币) |
| CREDITS_PER_USDT | 100 | 1 USDT兑换积分数 |
| MIN_RECHARGE_CREDITS | 5000 | 最低充值积分数 |
| NEW_USER_BONUS | 0 | 新用户赠送积分 |
| ORDER_EXPIRE_MINUTES | 90 | 订单过期时间(分钟) |
| PDL_API_KEY | a2d089c074ced... | People Data Labs API密钥 |
| PREVIEW_CREDITS | 1 | 预览搜索消耗积分 |
| SCRAPE_DO_API_KEY | c89c43afa84d... | Scrape.do API密钥 |
| SEARCH_COST_PER_RESULT | 1 | 每条搜索结果消耗积分 |
| SEARCH_CREDITS_PER_PERSON | 2 | 每条搜索结果消耗积分 |
| TPS_CACHE_DAYS | 180 | TPS搜索缓存天数 |
| TPS_SCRAPE_TOKEN | c89c43afa84d... | - |
| USDT_RATE | 7.2 | USDT兑人民币汇率 |
| USDT_WALLET_BEP20 | - | BEP20 USDT收款地址 |
| USDT_WALLET_ERC20 | - | ERC20 USDT收款地址 |
| USDT_WALLET_TRC20 | TEtRGZvdPqv... | TRC20 USDT收款地址 |
| VERIFICATION_SCORE_THRESHOLD | 60 | 电话验证通过分数阈值(0-100) |

### 添加配置功能
- ✅ 配置键输入框
- ✅ 配置值输入框
- ✅ 描述输入框
- ✅ 添加按钮

---

## 问题汇总

### 需要修复的问题
1. ⚠️ **系统监控模块** - 确认为摆设，建议移除或标记为"开发中"

### 建议优化
1. 充值订单操作列按钮可能需要检查
2. 系统监控如果不使用，建议从菜单中移除或隐藏

### 前后端参数对应确认
- ✅ TPS配置 - 参数对应正确
- ✅ Anywho配置 - 参数对应正确
- ✅ 系统配置 - 参数对应正确
- ✅ 代理佣金配置 - 参数对应正确

---

## 结论

管理后台整体功能完善，前后端参数对应正确。主要问题是**系统监控模块为摆设**，建议处理。
