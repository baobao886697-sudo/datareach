# LeadHunter Pro 系统配置参数

## 所有配置项

| 配置键 | 值 | 描述 | 更新者 |
|--------|-----|------|--------|
| APOLLO_API_KEY | c-QNZ1GCOrmJHw2vS5sYmg | Apollo API密钥 (优先使用环境变量) | 88888888 |
| CACHE_TTL_DAYS | 180 | 缓存有效期(天) | 88888888 |
| CREDIT_PRICE | 1 | 每积分价格(人民币) | - |
| CREDITS_PER_USDT | 100 | 1 USDT兑换积分数 | 88888888 |
| MIN_RECHARGE_CREDITS | 100 | 最低充值积分数 | 88888888 |
| NEW_USER_BONUS | 0 | 新用户赠送积分 | 88888888 |
| ORDER_EXPIRE_MINUTES | 30 | 订单过期时间(分钟) | 88888888 |
| PREVIEW_CREDITS | 1 | 预览搜索消耗积分 | 88888888 |
| SCRAPE_DO_API_KEY | c89c43afa84d40898eb979ae07c7cfac2bf0... | Scrape.do API密钥 | 88888888 |
| SEARCH_COST_PER_RESULT | 1 | 每条搜索结果消耗积分 | - |
| SEARCH_CREDITS_PER_PERSON | 2 | 每条搜索结果消耗积分 | 88888888 |
| USDT_RATE | 7.2 | USDT 兑人民币汇率 | - |
| USDT_WALLET_BEP20 | (未配置) | BEP20 USDT收款地址 | 88888888 |
| USDT_WALLET_ERC20 | (未配置) | ERC20 USDT收款地址 | 88888888 |
| USDT_WALLET_TRC20 | TEtRGZvdPqvUDhopMi1MEGCEiD9Ehdh1iZ | TRC20 USDT收款地址 | 88888888 |

## 关键配置说明

### 积分相关
- **SEARCH_CREDITS_PER_PERSON = 2**: 每条搜索结果消耗2积分
- **PREVIEW_CREDITS = 1**: 预览搜索消耗1积分
- **CREDITS_PER_USDT = 100**: 1 USDT = 100积分
- **MIN_RECHARGE_CREDITS = 100**: 最低充值100积分

### 缓存相关
- **CACHE_TTL_DAYS = 180**: 缓存有效期180天

### API密钥
- **APOLLO_API_KEY**: Apollo API密钥
- **SCRAPE_DO_API_KEY**: Scrape.do 验证API密钥
