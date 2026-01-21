# LeadHunter Pro 扣分机制详细分析

## 一、积分费用常量定义

### 1.1 后端常量 (searchProcessorV3.ts)

```typescript
// 积分费用常量
const SEARCH_CREDITS = 1;           // 搜索基础费用（每次搜索固定扣除）
const PHONE_CREDITS_PER_PERSON = 2; // 每条数据费用
const VERIFY_CREDITS_PER_PHONE = 0; // 验证费用（目前免费，预留扩展）
```

### 1.2 前端常量 (Search.tsx)

```typescript
// 积分费用常量
const SEARCH_COST = 1;              // 搜索基础费用
const PHONE_COST_PER_PERSON = 2;    // 每条数据费用
```

---

## 二、扣分时机与流程

### 2.1 扣分时间线

```
搜索开始
    │
    ├─[阶段2] 扣除搜索基础费用: 1 积分
    │         └─ deductCredits(userId, 1, 'search', ...)
    │
    ├─[阶段4] 扣除数据费用: 实际数量 × 2 积分
    │         └─ deductCredits(userId, actualCount × 2, 'search', ...)
    │
    ├─[阶段6] 如有未处理数据，退还积分
    │         └─ db.update(users).set({ credits: sql\`credits + ${refundCredits}\` })
    │
搜索结束
```

### 2.2 第一次扣分：搜索基础费用

**位置**: searchProcessorV3.ts 阶段2

```typescript
// ========== 阶段2: 检查缓存或调用 Apify ==========
addLog(`🔍 开始搜索数据...`, 'info', 'apify', '');

// 扣除搜索积分
const searchDeducted = await deductCredits(
  userId, 
  SEARCH_CREDITS,  // 固定 1 积分
  'search', 
  `搜索: ${searchName} | ${searchTitle} | ${searchState}`, 
  task.taskId
);

if (!searchDeducted) {
  throw new Error('扣除搜索积分失败');
}

stats.creditsUsed += SEARCH_CREDITS;
addLog(`💰 已扣除搜索积分: ${SEARCH_CREDITS}`, 'info', 'apify', '');
```

**特点**:
- 固定扣除 1 积分
- 无论搜索是否成功都会扣除
- 在调用 Apify API 之前扣除

### 2.3 第二次扣分：数据费用

**位置**: searchProcessorV3.ts 阶段4

```typescript
// ========== 阶段4: 计算并扣除数据费用 ==========
// 计算实际可处理数量
const actualCount = Math.min(apifyResults.length, requestedCount);

// 计算数据费用
const dataCreditsNeeded = actualCount * PHONE_CREDITS_PER_PERSON;

addLog(`📊 实际可处理: ${actualCount} 条，需要积分: ${dataCreditsNeeded}`, 'info', 'process', '');

// 检查积分是否充足
const currentCredits = await getUserCredits(userId);
if (currentCredits < dataCreditsNeeded) {
  // 积分不足，计算最大可处理数量
  const maxAffordable = Math.floor(currentCredits / PHONE_CREDITS_PER_PERSON);
  if (maxAffordable <= 0) {
    throw new Error(`积分不足，需要 ${dataCreditsNeeded} 积分，当前余额 ${currentCredits} 积分`);
  }
  
  // 调整处理数量
  actualCount = maxAffordable;
  dataCreditsNeeded = actualCount * PHONE_CREDITS_PER_PERSON;
  addLog(`⚠️ 积分不足，调整为处理 ${actualCount} 条`, 'warning', 'process', '');
}

// 一次性扣除数据费用
const dataDeducted = await deductCredits(
  userId, 
  dataCreditsNeeded, 
  'search', 
  `数据费用: ${actualCount} 条 × ${PHONE_CREDITS_PER_PERSON} 积分`, 
  task.taskId
);

if (!dataDeducted) {
  throw new Error('扣除数据积分失败');
}

stats.creditsUsed += dataCreditsNeeded;
addLog(`💰 已扣除数据积分: ${dataCreditsNeeded}`, 'info', 'process', '');
```

**特点**:
- 按实际数据量计算：数量 × 2 积分
- 一次性扣除，不是逐条扣除
- 如果积分不足，会自动调整处理数量

---

## 三、积分退还机制

### 3.1 退还场景

| 场景 | 触发条件 | 退还计算 |
|------|----------|----------|
| API 积分耗尽 | Scrape.do 返回 INSUFFICIENT_CREDITS | 未处理数量 × 2 |
| 搜索被停止 | 用户手动停止搜索 | 未处理数量 × 2 |
| 处理异常 | 处理过程中发生错误 | 未处理数量 × 2 |

### 3.2 退还代码逻辑

```typescript
// 检查是否需要退还积分
if (apiCreditsExhausted || task.status === 'stopped') {
  const processedCount = stats.processedCount;
  const unprocessedCount = actualCount - processedCount;
  
  if (unprocessedCount > 0) {
    const refundCredits = unprocessedCount * PHONE_CREDITS_PER_PERSON;
    
    // 执行退还
    await db.update(users)
      .set({ credits: sql`credits + ${refundCredits}` })
      .where(eq(users.id, userId));
    
    // 记录积分变动
    await db.insert(creditLogs).values({
      userId,
      amount: refundCredits,
      balanceAfter: currentCredits + refundCredits,
      type: 'refund',
      description: `搜索退款: ${unprocessedCount} 条未处理 × ${PHONE_CREDITS_PER_PERSON} 积分`,
      relatedTaskId: task.taskId,
    });
    
    stats.creditsRefunded += refundCredits;
    addLog(`💰 已退还积分: ${refundCredits} (${unprocessedCount} 条未处理)`, 'info', 'done', '');
  }
}
```

---

## 四、积分扣除函数 (db.ts)

### 4.1 deductCredits 函数

```typescript
export async function deductCredits(
  userId: number, 
  amount: number, 
  type: 'search' | 'recharge' | 'admin_deduct' | 'refund' | 'admin_adjust' | 'bonus' = 'search',
  description?: string,
  relatedTaskId?: string
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  try {
    // 获取当前积分
    const user = await db.select({ credits: users.credits })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    
    if (!user.length || user[0].credits < amount) {
      return false;  // 积分不足
    }
    
    const newBalance = user[0].credits - amount;
    
    // 扣除积分
    await db.update(users)
      .set({ credits: newBalance })
      .where(eq(users.id, userId));
    
    // 记录积分变动
    await db.insert(creditLogs).values({
      userId,
      amount: -amount,  // 负数表示扣除
      balanceAfter: newBalance,
      type,
      description,
      relatedTaskId,
    });
    
    return true;
  } catch (error) {
    console.error('扣除积分失败:', error);
    return false;
  }
}
```

### 4.2 getUserCredits 函数

```typescript
export async function getUserCredits(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.select({ credits: users.credits })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  
  return result.length > 0 ? result[0].credits : 0;
}
```

---

## 五、前端积分预估

### 5.1 预估计算 (Search.tsx)

```typescript
const creditEstimate = useMemo(() => {
  const searchCost = SEARCH_COST;                         // 1
  const phoneCost = searchLimit * PHONE_COST_PER_PERSON;  // limit × 2
  const totalCost = searchCost + phoneCost;               // 1 + limit × 2
  const currentCredits = profile?.credits || 0;
  const remainingCredits = currentCredits - totalCost;
  const canAfford = currentCredits >= totalCost;
  const maxAffordable = Math.floor((currentCredits - SEARCH_COST) / PHONE_COST_PER_PERSON);
  
  return {
    searchCost,       // 搜索基础费用
    phoneCost,        // 数据费用
    totalCost,        // 总费用
    currentCredits,   // 当前积分
    remainingCredits, // 剩余积分
    canAfford,        // 是否能负担
    maxAffordable: Math.max(0, maxAffordable),  // 最大可负担数量
  };
}, [searchLimit, profile?.credits]);
```

### 5.2 预估示例

| 搜索数量 | 搜索费用 | 数据费用 | 总费用 |
|----------|----------|----------|--------|
| 100 | 1 | 200 | 201 |
| 500 | 1 | 1000 | 1001 |
| 1000 | 1 | 2000 | 2001 |
| 5000 | 1 | 10000 | 10001 |

---

## 六、积分变动记录表

### 6.1 表结构 (credit_logs)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 主键 |
| userId | int | 用户ID |
| amount | int | 变动金额（正数增加，负数减少） |
| balanceAfter | int | 变动后余额 |
| type | enum | 类型：recharge/search/admin_add/admin_deduct/refund/admin_adjust/bonus |
| description | text | 变动说明 |
| relatedOrderId | varchar | 关联订单ID |
| relatedTaskId | varchar | 关联任务ID |
| createdAt | timestamp | 创建时间 |

### 6.2 记录示例

| amount | type | description |
|--------|------|-------------|
| -1 | search | 搜索: John | CEO | California |
| -200 | search | 数据费用: 100 条 × 2 积分 |
| +50 | refund | 搜索退款: 25 条未处理 × 2 积分 |
| +100 | recharge | 充值订单: ORD123456 |

---

## 七、积分检查点

### 7.1 搜索前检查 (routers.ts)

```typescript
// 检查积分是否充足
const requiredCredits = 1 + input.limit * 2;  // 搜索费用 + 数据费用
const user = await db.select({ credits: users.credits })
  .from(users)
  .where(eq(users.id, ctx.user.id))
  .limit(1);

if (!user.length || user[0].credits < requiredCredits) {
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: `积分不足，需要 ${requiredCredits} 积分，当前余额 ${user[0]?.credits || 0} 积分`,
  });
}
```

### 7.2 处理中检查 (searchProcessorV3.ts)

```typescript
// 检查积分是否充足
const currentCredits = await getUserCredits(userId);
if (currentCredits < dataCreditsNeeded) {
  // 积分不足处理逻辑
}
```

---

## 八、总结

### 8.1 扣分公式

```
最终消耗积分 = 搜索基础费用 + 数据费用 - 退还积分
             = 1 + (实际处理数量 × 2) - 退还积分
```

### 8.2 关键特点

1. **预付费模式**: 先扣除积分，后提供服务
2. **一次性扣除**: 数据费用一次性扣除，不是逐条扣除
3. **自动退还**: 如有未处理数据，自动退还相应积分
4. **完整记录**: 所有积分变动都记录在 credit_logs 表中
5. **实时检查**: 搜索前和处理中都会检查积分余额
