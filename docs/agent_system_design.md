# DataReach Pro 代理系统技术方案

## 一、系统概述

### 1.1 核心功能
- 两级代理体系（一级代理 + 二级代理）
- 创始代理特权（前100名永久高佣金）
- 实时佣金计算与结算
- 代理专属后台（高大上UI设计）
- 佣金提现系统
- 管理员代理管理

### 1.2 佣金结构

| 代理等级 | 一级佣金 | 二级佣金 | 获得条件 |
|---------|---------|---------|---------|
| 创始代理 | 15% | 5% | 前100名注册的代理 |
| 金牌代理 | 12% | 4% | 月业绩 ≥5000 USDT |
| 银牌代理 | 10% | 3% | 月业绩 ≥1000 USDT |
| 普通代理 | 8% | 2% | 默认等级 |

### 1.3 额外激励
- 首充奖励：下级用户首次充值，额外 +3%
- 开业活动：首月所有佣金 +3%（限时）

---

## 二、数据库设计

### 2.1 用户表扩展 (users)
```sql
ALTER TABLE users ADD COLUMN inviterId INT DEFAULT NULL;           -- 邀请人ID
ALTER TABLE users ADD COLUMN inviteCode VARCHAR(20) UNIQUE;        -- 邀请码
ALTER TABLE users ADD COLUMN isAgent BOOLEAN DEFAULT FALSE;        -- 是否是代理
ALTER TABLE users ADD COLUMN agentLevel ENUM('normal', 'silver', 'gold', 'founder') DEFAULT 'normal';
ALTER TABLE users ADD COLUMN agentAppliedAt TIMESTAMP;             -- 申请成为代理时间
ALTER TABLE users ADD COLUMN agentApprovedAt TIMESTAMP;            -- 审核通过时间
```

### 2.2 代理佣金记录表 (agent_commissions)
```sql
CREATE TABLE agent_commissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agentId INT NOT NULL,                    -- 代理ID
  fromUserId INT NOT NULL,                 -- 来源用户ID
  orderId VARCHAR(32) NOT NULL,            -- 关联充值订单
  orderAmount DECIMAL(10,2) NOT NULL,      -- 订单金额(USDT)
  commissionLevel ENUM('level1', 'level2') NOT NULL, -- 一级/二级
  commissionRate DECIMAL(5,2) NOT NULL,    -- 佣金比例
  commissionAmount DECIMAL(10,2) NOT NULL, -- 佣金金额(USDT)
  bonusType VARCHAR(20),                   -- 额外奖励类型: first_charge, activity
  bonusAmount DECIMAL(10,2) DEFAULT 0,     -- 额外奖励金额
  status ENUM('pending', 'settled', 'withdrawn') DEFAULT 'pending',
  settledAt TIMESTAMP,                     -- 结算时间(7天后)
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent (agentId),
  INDEX idx_status (status),
  INDEX idx_created (createdAt)
);
```

### 2.3 代理提现申请表 (agent_withdrawals)
```sql
CREATE TABLE agent_withdrawals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  withdrawalId VARCHAR(32) NOT NULL UNIQUE,
  agentId INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,           -- 提现金额(USDT)
  walletAddress VARCHAR(100) NOT NULL,     -- 提现地址
  network VARCHAR(20) DEFAULT 'TRC20',
  status ENUM('pending', 'approved', 'rejected', 'paid') DEFAULT 'pending',
  adminNote TEXT,
  txId VARCHAR(100),                       -- 打款交易ID
  processedBy VARCHAR(50),
  processedAt TIMESTAMP,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent (agentId),
  INDEX idx_status (status)
);
```

### 2.4 代理统计表 (agent_stats) - 按月汇总
```sql
CREATE TABLE agent_stats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agentId INT NOT NULL,
  month VARCHAR(7) NOT NULL,               -- YYYY-MM
  totalUsers INT DEFAULT 0,                -- 本月新增用户
  totalRecharge DECIMAL(12,2) DEFAULT 0,   -- 本月团队充值
  level1Commission DECIMAL(10,2) DEFAULT 0, -- 一级佣金
  level2Commission DECIMAL(10,2) DEFAULT 0, -- 二级佣金
  bonusCommission DECIMAL(10,2) DEFAULT 0,  -- 额外奖励
  totalCommission DECIMAL(10,2) DEFAULT 0,  -- 总佣金
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_agent_month (agentId, month)
);
```

### 2.5 代理配置表 (agent_settings)
```sql
CREATE TABLE agent_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  settingKey VARCHAR(50) NOT NULL UNIQUE,
  settingValue TEXT NOT NULL,
  description TEXT,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 默认配置
INSERT INTO agent_settings (settingKey, settingValue, description) VALUES
('founder_limit', '100', '创始代理名额限制'),
('founder_level1_rate', '15', '创始代理一级佣金比例'),
('founder_level2_rate', '5', '创始代理二级佣金比例'),
('gold_level1_rate', '12', '金牌代理一级佣金比例'),
('gold_level2_rate', '4', '金牌代理二级佣金比例'),
('silver_level1_rate', '10', '银牌代理一级佣金比例'),
('silver_level2_rate', '3', '银牌代理二级佣金比例'),
('normal_level1_rate', '8', '普通代理一级佣金比例'),
('normal_level2_rate', '2', '普通代理二级佣金比例'),
('first_charge_bonus', '3', '首充额外奖励比例'),
('min_withdrawal', '50', '最低提现金额(USDT)'),
('settlement_days', '7', '佣金结算冻结天数'),
('activity_bonus', '3', '开业活动额外奖励'),
('activity_end_date', '2026-02-28', '开业活动结束日期');
```

---

## 三、API设计

### 3.1 代理公开接口
```typescript
agent: router({
  // 获取代理规则说明
  rules: publicProcedure.query(),
  
  // 申请成为代理
  apply: protectedProcedure.mutation(),
  
  // 获取代理信息
  info: protectedProcedure.query(),
  
  // 获取邀请链接/二维码
  inviteLink: protectedProcedure.query(),
  
  // 获取下级用户列表
  teamUsers: protectedProcedure.query(),
  
  // 获取下级代理列表
  teamAgents: protectedProcedure.query(),
  
  // 获取佣金明细
  commissions: protectedProcedure.query(),
  
  // 获取统计数据
  stats: protectedProcedure.query(),
  
  // 申请提现
  withdraw: protectedProcedure.mutation(),
  
  // 获取提现记录
  withdrawals: protectedProcedure.query(),
})
```

### 3.2 管理员接口
```typescript
adminAgent: router({
  // 获取所有代理列表
  list: adminProcedure.query(),
  
  // 审核代理申请
  approve: adminProcedure.mutation(),
  
  // 调整代理等级
  setLevel: adminProcedure.mutation(),
  
  // 处理提现申请
  processWithdrawal: adminProcedure.mutation(),
  
  // 获取代理统计报表
  report: adminProcedure.query(),
  
  // 更新佣金配置
  updateSettings: adminProcedure.mutation(),
})
```

---

## 四、前端页面设计

### 4.1 代理后台页面 (/agent)
```
📊 代理中心
├── 数据概览（今日/本周/本月业绩卡片）
├── 收益趋势图（折线图）
├── 团队概况（用户数、代理数）
└── 快捷操作（复制邀请链接、申请提现）

👥 我的团队
├── 下级用户列表（头像、昵称、注册时间、充值总额）
├── 下级代理列表
├── 搜索/筛选功能
└── 导出功能

💰 佣金明细
├── 佣金记录列表（时间、来源、金额、状态）
├── 筛选：全部/待结算/已结算/已提现
└── 统计汇总

💳 提现中心
├── 可提现余额
├── 冻结中金额（7天解冻）
├── 提现表单（金额、钱包地址）
├── 提现记录
└── 提现说明

📋 推广中心
├── 我的邀请码（大字显示+一键复制）
├── 邀请链接（带二维码）
├── 推广素材下载
└── 佣金规则说明

⚙️ 代理设置
├── 收款地址管理
└── 通知设置
```

### 4.2 佣金规则说明页面 (/agent/rules)
```
🎯 DataReach 代理计划

💎 代理等级与佣金
├── 创始代理：15% + 5%（仅限前100名）
├── 金牌代理：12% + 4%
├── 银牌代理：10% + 3%
└── 普通代理：8% + 2%

🎁 额外奖励
├── 首充奖励：+3%
└── 开业活动：+3%（限时）

📝 结算规则
├── 佣金T+7结算
├── 最低提现50 USDT
└── 提现1-3工作日到账

❓ 常见问题
└── FAQ列表
```

---

## 五、核心业务逻辑

### 5.1 用户注册时绑定邀请人
```typescript
// 注册时检查邀请码
if (inviteCode) {
  const inviter = await findUserByInviteCode(inviteCode);
  if (inviter && inviter.isAgent) {
    newUser.inviterId = inviter.id;
  }
}
```

### 5.2 充值成功后计算佣金
```typescript
async function calculateCommission(order: RechargeOrder) {
  const user = await getUser(order.userId);
  if (!user.inviterId) return;
  
  // 一级代理佣金
  const level1Agent = await getUser(user.inviterId);
  if (level1Agent.isAgent) {
    const rate = getCommissionRate(level1Agent.agentLevel, 'level1');
    const bonus = isFirstCharge(user.id) ? getFirstChargeBonus() : 0;
    await createCommission(level1Agent.id, order, 'level1', rate, bonus);
  }
  
  // 二级代理佣金
  if (level1Agent.inviterId) {
    const level2Agent = await getUser(level1Agent.inviterId);
    if (level2Agent.isAgent) {
      const rate = getCommissionRate(level2Agent.agentLevel, 'level2');
      await createCommission(level2Agent.id, order, 'level2', rate, 0);
    }
  }
}
```

### 5.3 佣金结算（7天后）
```typescript
// 定时任务：每天检查待结算佣金
async function settleCommissions() {
  const pendingCommissions = await getPendingCommissions();
  for (const commission of pendingCommissions) {
    if (daysSinceCreated(commission) >= 7) {
      await settleCommission(commission.id);
    }
  }
}
```

---

## 六、UI设计风格

### 6.1 代理后台主题
- 深色科技风格（与主站一致）
- 金色/橙色强调色（代表财富）
- 数据卡片带渐变光效
- 图表使用 Chart.js 或 Recharts
- 动态粒子背景

### 6.2 关键视觉元素
- 代理等级徽章（创始/金牌/银牌）
- 佣金数字动态计数效果
- 邀请码大字体+复制动画
- 二维码生成与下载

---

## 七、开发计划

### Phase 1: 基础架构（Day 1）
- [ ] 数据库表创建和迁移
- [ ] 用户表字段扩展
- [ ] 基础API框架搭建

### Phase 2: 核心功能（Day 2-3）
- [ ] 邀请码生成和绑定
- [ ] 代理申请和审核
- [ ] 佣金计算逻辑
- [ ] 佣金结算定时任务

### Phase 3: 代理后台（Day 3-4）
- [ ] 代理中心页面
- [ ] 团队管理页面
- [ ] 佣金明细页面
- [ ] 提现功能

### Phase 4: 管理功能（Day 4-5）
- [ ] 管理员代理列表
- [ ] 提现审核
- [ ] 佣金配置
- [ ] 数据报表

### Phase 5: 优化上线（Day 5）
- [ ] UI美化
- [ ] 测试验证
- [ ] 部署上线
