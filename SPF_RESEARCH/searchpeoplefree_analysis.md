# SearchPeopleFree 网站分析

## 网站基本信息
- **URL**: https://www.searchpeoplefree.com/
- **特点**: 完全免费的人员搜索服务

## 搜索方式
1. **姓名搜索** (Name) - 主要搜索方式
2. **电话反查** (Phone Lookup) - /phone-lookup
3. **地址查询** (Address Lookup) - /address
4. **位置搜索** (Location Lookup) - /location
5. **邮箱查询** (Email Lookup) - /email

## 返回的数据字段
根据网站介绍，搜索结果包含：
- Full name (全名)
- Age (年龄)
- Current and former addresses (当前和历史地址)
- Current and former phone numbers (当前和历史电话)
- Likely relatives and associates (可能的亲属和关联人)
- Corporations or businesses (关联的公司或企业)

## 详情页面数据
点击"More Free Details"可获取更深入的公开数据，包括：
- 完整背景报告
- 犯罪记录
- 破产记录
- 止赎记录等

## URL 结构推测
- 搜索页面: /find/{name}/{city-state}
- 详情页面: /find/{firstname}-{lastname}/{city}-{state}/{id}

## 与 TPS/FPS 的对比
| 特性 | TPS | FPS | SPF |
|------|-----|-----|-----|
| 免费 | ✅ | ✅ | ✅ |
| 姓名搜索 | ✅ | ✅ | ✅ |
| 电话反查 | ✅ | ✅ | ✅ |
| 地址查询 | ✅ | ✅ | ✅ |
| 邮箱查询 | ❌ | ❌ | ✅ |
| 位置搜索 | ❌ | ❌ | ✅ |
| 企业关联 | ❌ | ❌ | ✅ |

## 潜在亮点
1. **邮箱查询功能** - TPS/FPS没有
2. **位置搜索** - 可按地理位置搜索
3. **企业关联信息** - 显示关联的公司/企业
4. **无需账户** - 完全无需注册
5. **无搜索限制** - 不限制搜索次数

## 需要进一步测试
1. 实际搜索结果的数据结构
2. 详情页面的完整字段
3. 与TPS/FPS数据的重合度
4. 数据更新频率和准确性
