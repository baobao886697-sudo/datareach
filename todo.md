# 云端寻踪 Pro 2.0 - 开发任务清单 (V6蓝图)

## 核心架构 (V6)

### 用户认证（Manus OAuth + 单设备锁定）
- [x] Manus OAuth用户认证
- [ ] 单设备锁定机制
- [ ] 新设备登录自动踢出旧设备
- [ ] 新用户初始积分为0

### 管理员认证（独立系统）
- [x] 独立管理员登录页面 /admin/login
- [x] 环境变量配置管理员账户（ADMIN_USERNAME, ADMIN_PASSWORD）
- [x] 管理员JWT生成和验证（24小时过期）
- [x] adminProcedure中间件（x-admin-token验证）
- [x] 管理员登出功能

### 数据库Schema
- [x] users表（含credits、status、role）
- [x] users表添加currentDeviceId、currentDeviceLoginAt字段
- [x] systemConfigs表（系统配置）
- [x] rechargeOrders表（含mismatch状态）
- [x] searchTasks表
- [x] searchResults表
- [x] globalCache表（180天全局缓存）
- [x] searchLogs表
- [x] adminLogs表
- [x] creditLogs表
- [x] loginLogs表
- [x] apiLogs表

### 系统配置管理
- [ ] TRC20_WALLET_ADDRESS配置
- [ ] MIN_RECHARGE_CREDITS配置（默认100）
- [ ] CREDITS_PER_USDT配置（默认100）
- [ ] CACHE_TTL_DAYS配置（默认180）
- [ ] ORDER_EXPIRE_MINUTES配置（默认30）
- [ ] 配置读取（带5分钟内存缓存）
- [ ] 配置更新（管理员操作日志）

### 前端UI重构（加密货币科技风格）
- [x] 深色主题 + 霓虹蓝紫渐变
- [x] 玻璃拟态(Glassmorphism)效果
- [x] 动态粒子/网格背景
- [x] 科技感数据可视化
- [x] 登录/注册页面重设计
- [x] 仪表盘重设计
- [x] 搜索页面重设计
- [x] 充值页面重设计
- [x] 管理后台重设计

### 搜索功能
- [x] 姓名+职位+州搜索
- [x] 预览搜索结果总数（扣1积分）
- [x] 自定义获取数量
- [ ] 智能分页分配（避免重复数据）
- [x] 实时任务进度显示
- [x] 详细处理日志

### 验证功能
- [x] Scrape.do电话验证
- [x] 多维度匹配计算（姓名、地区、年龄）
- [x] 验证结果缓存

### 充值系统
- [x] USDT-TRC20充值
- [x] 唯一尾数生成
- [ ] 从系统配置读取收款地址
- [ ] 从系统配置读取最低充值限制
- [ ] 异常订单处理（金额不匹配）
- [ ] 管理员手动确认到账

### 管理员后台
- [x] /admin/login - 独立登录页
- [x] /admin - 仪表盘（系统概览）
- [x] /admin/users - 用户管理
- [ ] /admin/orders - 充值订单管理
- [ ] /admin/orders/mismatch - 异常订单处理
- [ ] /admin/logs - 日志查看
- [ ] /admin/settings - 系统配置
- [ ] /admin/cache - 缓存管理

### CSV导出
- [x] 40+字段完整导出
- [x] 验证信息导出

### 日志系统
- [x] 搜索日志
- [x] 积分变动日志
- [ ] 管理员操作日志
- [ ] 登录日志

## 部署准备
- [ ] 环境变量配置文档
- [ ] 独立部署指南


## Railway独立部署改造

### 移除Manus OAuth依赖
- [ ] 修改server/_core/context.ts移除OAuth依赖
- [ ] 实现独立的JWT用户认证
- [ ] 实现邮箱+密码注册功能
- [ ] 实现邮箱+密码登录功能
- [ ] 更新routers.ts中的认证路由
- [ ] 更新前端Login.tsx使用独立登录
- [ ] 更新前端Register.tsx使用独立注册
- [ ] 推送代码到GitHub
- [ ] 重新部署Railway
- [ ] 测试验证所有功能
