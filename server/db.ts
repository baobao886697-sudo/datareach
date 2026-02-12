import { sql, eq, desc, and, gte, lte, like, or, isNull, ne, asc, count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { 
  users, InsertUser, User,
  systemConfigs, SystemConfig,
  rechargeOrders, RechargeOrder,
  searchTasks, SearchTask,
  searchResults, SearchResult,
  globalCache, GlobalCache,
  creditLogs, CreditLog,
  searchLogs, SearchLog,
  adminLogs, AdminLog,
  loginLogs, LoginLog,
  apiLogs, ApiLog,
  announcements, Announcement, InsertAnnouncement,
  userMessages, UserMessage, InsertUserMessage,
  userActivityLogs, UserActivityLog, InsertUserActivityLog,
  apiStats, ApiStat,
  errorLogs, ErrorLog,
  userFeedbacks, UserFeedback, InsertUserFeedback
} from "../drizzle/schema";
import { ENV } from './_core/env';
import crypto from 'crypto';

let _db: ReturnType<typeof drizzle> | null = null;

// 导出数据库实例用于直接SQL操作
export function getDbSync() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ============ 用户相关 ============

export async function createUser(email: string, passwordHash: string, name?: string, inviterId?: number): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const openId = crypto.randomBytes(16).toString('hex');
  // 注册赠送100积分
  const REGISTER_BONUS_CREDITS = 100;
  await db.insert(users).values({ 
    openId, 
    email, 
    passwordHash, 
    credits: REGISTER_BONUS_CREDITS, 
    name: name || null,
    inviterId: inviterId || null,
  });
  return getUserByEmail(email);
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateUserLastSignIn(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, userId));
}

export async function updateUserDevice(userId: number, deviceId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ currentDeviceId: deviceId, currentDeviceLoginAt: new Date(), lastSignedIn: new Date() }).where(eq(users.id, userId));
}

export async function checkUserDevice(userId: number, deviceId: string): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user) return false;
  if (!user.currentDeviceId) return true;
  return user.currentDeviceId === deviceId;
}

export async function clearUserDevice(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ currentDeviceId: null, currentDeviceLoginAt: null }).where(eq(users.id, userId));
}

export async function getAllUsers(page: number = 1, limit: number = 20, search?: string): Promise<{ users: (User & { agentEmail?: string | null })[]; total: number }> {
  const db = await getDb();
  if (!db) return { users: [], total: 0 };
  const offset = (page - 1) * limit;
  
  // 使用参数化查询防止 SQL 注入
  let result;
  let countResult;
  
  if (search) {
    // 使用参数化查询处理搜索条件
    const searchPattern = `%${search}%`;
    result = await db.execute(sql`
      SELECT u.*, 
             (SELECT a.email FROM users a WHERE a.id = u.inviterId) as agentEmail
      FROM users u
      WHERE u.email LIKE ${searchPattern} OR u.name LIKE ${searchPattern}
      ORDER BY u.createdAt DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    
    countResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM users u 
      WHERE u.email LIKE ${searchPattern} OR u.name LIKE ${searchPattern}
    `);
  } else {
    result = await db.execute(sql`
      SELECT u.*, 
             (SELECT a.email FROM users a WHERE a.id = u.inviterId) as agentEmail
      FROM users u
      ORDER BY u.createdAt DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    
    countResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM users u
    `);
  }
  
  return { 
    users: (result[0] as any[]).map(u => ({
      ...u,
      agentEmail: u.agentEmail || null,
    })), 
    total: (countResult[0] as any[])[0]?.count || 0 
  };
}

export async function updateUserStatus(userId: number, status: "active" | "disabled"): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ status }).where(eq(users.id, userId));
}

// ============ 积分相关 ============

export async function getUserCredits(userId: number): Promise<number> {
  const user = await getUserById(userId);
  return user?.credits || 0;
}

export async function deductCredits(userId: number, amount: number, type: "search" | "admin_deduct" | "refund", description: string, relatedTaskId?: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const user = await getUserById(userId);
  if (!user) return false;
  
  // 支持负数金额（退款）
  if (amount > 0 && user.credits < amount) return false;
  
  const newBalance = user.credits - amount; // 负数amount会增加余额
  await db.update(users).set({ credits: newBalance }).where(eq(users.id, userId));
  await db.insert(creditLogs).values({ userId, amount: -amount, balanceAfter: newBalance, type, description, relatedTaskId });
  return true;
}

export async function addCredits(userId: number, amount: number, type: "recharge" | "admin_add" | "refund", description: string, relatedOrderId?: string, relatedTaskId?: string): Promise<{ success: boolean; newBalance?: number }> {
  const db = await getDb();
  if (!db) return { success: false };
  const user = await getUserById(userId);
  if (!user) return { success: false };
  const newBalance = user.credits + amount;
  await db.update(users).set({ credits: newBalance }).where(eq(users.id, userId));
  await db.insert(creditLogs).values({ userId, amount, balanceAfter: newBalance, type, description, relatedOrderId, relatedTaskId });
  return { success: true, newBalance };
}

// ==================== LinkedIn搜索预扣费机制 ====================

/**
 * 预扣积分（冻结）- LinkedIn搜索
 * 
 * 任务开始前预扣最大预估费用，确保任务能够完整执行
 * 预扣成功后，任务必定完整执行并返回结果
 */
export async function freezeCreditsLinkedIn(
  userId: number, 
  amount: number, 
  taskId: string
): Promise<{ success: boolean; frozenAmount: number; currentBalance: number; message: string }> {
  const db = await getDb();
  if (!db) return { success: false, frozenAmount: 0, currentBalance: 0, message: '数据库连接失败' };
  
  const user = await getUserById(userId);
  if (!user) return { success: false, frozenAmount: 0, currentBalance: 0, message: '用户不存在' };
  
  const roundedAmount = Math.ceil(amount * 10) / 10;
  
  // 检查余额是否足够
  if (user.credits < roundedAmount) {
    return {
      success: false,
      frozenAmount: 0,
      currentBalance: user.credits,
      message: `积分不足，需要 ${roundedAmount} 积分，当前余额 ${user.credits} 积分`,
    };
  }
  
  // 预扣积分
  const newBalance = user.credits - roundedAmount;
  await db.update(users).set({ credits: newBalance }).where(eq(users.id, userId));
  
  // 记录预扣日志
  await db.insert(creditLogs).values({
    userId,
    amount: -roundedAmount,
    balanceAfter: newBalance,
    type: "search",
    description: `LinkedIn搜索预扣 [${taskId.slice(0, 8)}] - 预估最大消耗`,
    relatedTaskId: taskId,
  });
  
  return {
    success: true,
    frozenAmount: roundedAmount,
    currentBalance: newBalance,
    message: `已预扣 ${roundedAmount} 积分`,
  };
}

/**
 * 结算积分（退还多扣的部分）- LinkedIn搜索
 * 
 * 任务完成后，计算实际消耗，退还多扣的积分
 */
export async function settleCreditsLinkedIn(
  userId: number,
  frozenAmount: number,
  actualCost: number,
  taskId: string
): Promise<{ refundAmount: number; actualCost: number; newBalance: number }> {
  const db = await getDb();
  if (!db) return { refundAmount: 0, actualCost, newBalance: 0 };
  
  const roundedActualCost = Math.ceil(actualCost * 10) / 10;
  const roundedFrozenAmount = Math.ceil(frozenAmount * 10) / 10;
  const refundAmount = Math.max(0, roundedFrozenAmount - roundedActualCost);
  
  const user = await getUserById(userId);
  if (!user) return { refundAmount: 0, actualCost: roundedActualCost, newBalance: 0 };
  
  let currentBalance = user.credits;
  
  if (refundAmount > 0) {
    // 退还多扣的积分
    currentBalance += refundAmount;
    await db.update(users).set({ credits: currentBalance }).where(eq(users.id, userId));
    
    // 记录退还日志
    await db.insert(creditLogs).values({
      userId,
      amount: refundAmount,
      balanceAfter: currentBalance,
      type: "refund",
      description: `LinkedIn搜索结算退还 [${taskId.slice(0, 8)}] - 预扣 ${roundedFrozenAmount} 实际 ${roundedActualCost}`,
      relatedTaskId: taskId,
    });
  }
  
  return {
    refundAmount,
    actualCost: roundedActualCost,
    newBalance: currentBalance,
  };
}

export async function getCreditLogs(userId: number, page: number = 1, limit: number = 20): Promise<{ logs: CreditLog[]; total: number }> {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };
  const offset = (page - 1) * limit;
  const result = await db.select().from(creditLogs).where(eq(creditLogs.userId, userId)).orderBy(desc(creditLogs.createdAt)).limit(limit).offset(offset);
  const countResult = await db.select({ count: sql<number>`count(*)` }).from(creditLogs).where(eq(creditLogs.userId, userId));
  return { logs: result, total: countResult[0]?.count || 0 };
}

// ============ 系统配置相关 ============

const configCache = new Map<string, { value: string; expireAt: number }>();

export async function getConfig(key: string): Promise<string | null> {
  const cached = configCache.get(key);
  if (cached && cached.expireAt > Date.now()) return cached.value;
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(systemConfigs).where(eq(systemConfigs.key, key)).limit(1);
  if (result.length === 0) return null;
  configCache.set(key, { value: result[0].value, expireAt: Date.now() + 5 * 60 * 1000 });
  return result[0].value;
}

export async function setConfig(key: string, value: string, adminUsername: string, description?: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(systemConfigs).where(eq(systemConfigs.key, key)).limit(1);
  if (existing.length > 0) {
    await db.update(systemConfigs).set({ value, updatedBy: adminUsername }).where(eq(systemConfigs.key, key));
  } else {
    await db.insert(systemConfigs).values({ key, value, description, updatedBy: adminUsername });
  }
  configCache.delete(key);
}

export async function getAllConfigs(): Promise<SystemConfig[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(systemConfigs).orderBy(systemConfigs.key);
}

export async function deleteConfig(key: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(systemConfigs).where(eq(systemConfigs.key, key));
  configCache.delete(key);
}

// ============ 充值订单相关 ============

export async function createRechargeOrder(userId: number, credits: number, amount: string, walletAddress: string, network: string = "TRC20"): Promise<RechargeOrder | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const orderId = crypto.randomBytes(8).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await db.insert(rechargeOrders).values({ orderId, userId, credits, amount, walletAddress, network, expiresAt });
  return getRechargeOrder(orderId);
}

// 创建带唯一尾数的充值订单
export async function createRechargeOrderWithUniqueAmount(userId: number, credits: number, baseAmount: number, walletAddress: string, network: string = "TRC20"): Promise<RechargeOrder | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  
  // 获取所有活跃订单的尾数
  const activeOrders = await getPendingOrders();
  const usedDecimals = new Set(
    activeOrders
      .filter(o => Math.floor(parseFloat(o.amount)) === Math.floor(baseAmount))
      .map(o => Math.round((parseFloat(o.amount) % 1) * 100))
  );
  
  // 生成未使用的尾数 (01-99)
  let decimal = 1;
  for (let i = 1; i <= 99; i++) {
    if (!usedDecimals.has(i)) {
      decimal = i;
      break;
    }
  }
  
  const uniqueAmount = (baseAmount + decimal / 100).toFixed(2);
  const orderId = crypto.randomBytes(8).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  
  await db.insert(rechargeOrders).values({ orderId, userId, credits, amount: uniqueAmount, walletAddress, network, expiresAt });
  return getRechargeOrder(orderId);
}

export async function getRechargeOrder(orderId: string): Promise<RechargeOrder | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(rechargeOrders).where(eq(rechargeOrders.orderId, orderId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserRechargeOrders(userId: number, page: number = 1, limit: number = 20): Promise<{ orders: RechargeOrder[]; total: number }> {
  const db = await getDb();
  if (!db) return { orders: [], total: 0 };
  const offset = (page - 1) * limit;
  const result = await db.select().from(rechargeOrders).where(eq(rechargeOrders.userId, userId)).orderBy(desc(rechargeOrders.createdAt)).limit(limit).offset(offset);
  const countResult = await db.select({ count: sql<number>`count(*)` }).from(rechargeOrders).where(eq(rechargeOrders.userId, userId));
  return { orders: result, total: countResult[0]?.count || 0 };
}

export async function getPendingOrders(): Promise<RechargeOrder[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(rechargeOrders).where(and(eq(rechargeOrders.status, "pending"), gte(rechargeOrders.expiresAt, new Date())));
}

export async function confirmRechargeOrder(orderId: string, txId: string, receivedAmount?: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const order = await getRechargeOrder(orderId);
  if (!order || order.status !== "pending") return false;
  await db.update(rechargeOrders).set({ status: "paid", txId, receivedAmount, paidAt: new Date() }).where(eq(rechargeOrders.orderId, orderId));
  await addCredits(order.userId, order.credits, "recharge", `充值订单 ${orderId}`, orderId);
  
  // 计算并创建代理佣金
  try {
    const { calculateAndCreateCommission } = await import("./agentDb");
    const orderAmount = parseFloat(order.amount);
    await calculateAndCreateCommission(orderId, order.userId, orderAmount);
  } catch (error) {
    console.error("[代理佣金] 计算失败:", error);
    // 佣金计算失败不影响订单确认
  }
  
  return true;
}

export async function getAllRechargeOrders(page: number = 1, limit: number = 20, status?: string): Promise<{ orders: RechargeOrder[]; total: number }> {
  const db = await getDb();
  if (!db) return { orders: [], total: 0 };
  const offset = (page - 1) * limit;
  let query = db.select().from(rechargeOrders);
  let countQuery = db.select({ count: sql<number>`count(*)` }).from(rechargeOrders);
  if (status) {
    query = query.where(eq(rechargeOrders.status, status as any)) as typeof query;
    countQuery = countQuery.where(eq(rechargeOrders.status, status as any)) as typeof countQuery;
  }
  const result = await query.orderBy(desc(rechargeOrders.createdAt)).limit(limit).offset(offset);
  const countResult = await countQuery;
  return { orders: result, total: countResult[0]?.count || 0 };
}

// 更新订单状态
export async function updateRechargeOrderStatus(orderId: string, status: "pending" | "paid" | "cancelled" | "expired" | "mismatch", adminNote?: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const order = await getRechargeOrder(orderId);
  if (!order) return false;
  await db.update(rechargeOrders).set({ status, adminNote }).where(eq(rechargeOrders.orderId, orderId));
  return true;
}

// 取消订单
export async function cancelRechargeOrder(orderId: string, reason?: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const order = await getRechargeOrder(orderId);
  if (!order || order.status !== "pending") return false;
  await db.update(rechargeOrders).set({ status: "cancelled", adminNote: reason }).where(eq(rechargeOrders.orderId, orderId));
  return true;
}

// 标记为金额不匹配
export async function markOrderMismatch(orderId: string, receivedAmount: string, txId: string, adminNote?: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const order = await getRechargeOrder(orderId);
  if (!order) return false;
  await db.update(rechargeOrders).set({ status: "mismatch", receivedAmount, txId, adminNote }).where(eq(rechargeOrders.orderId, orderId));
  return true;
}

// 处理金额不匹配订单 - 按实际金额发放积分
export async function resolveMismatchOrder(orderId: string, actualCredits: number, adminNote?: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const order = await getRechargeOrder(orderId);
  if (!order || order.status !== "mismatch") return false;
  await db.update(rechargeOrders).set({ status: "paid", credits: actualCredits, adminNote, paidAt: new Date() }).where(eq(rechargeOrders.orderId, orderId));
  await addCredits(order.userId, actualCredits, "recharge", `充值订单 ${orderId} (金额调整)`, orderId);
  return true;
}

// 过期未支付订单
export async function expireOldOrders(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.update(rechargeOrders)
    .set({ status: "expired" })
    .where(and(eq(rechargeOrders.status, "pending"), lte(rechargeOrders.expiresAt, new Date())));
  return (result as any).affectedRows || 0;
}

// ============ 搜索任务相关 ============

export async function createSearchTask(userId: number, searchHash: string, params: any, requestedCount: number): Promise<SearchTask | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const taskId = crypto.randomBytes(8).toString('hex');
  await db.insert(searchTasks).values({ taskId, userId, searchHash, params, requestedCount, logs: [] });
  return getSearchTask(taskId);
}

export async function getSearchTask(taskId: string): Promise<SearchTask | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(searchTasks).where(eq(searchTasks.taskId, taskId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateSearchTask(taskId: string, updates: Partial<SearchTask>): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error('[DB] updateSearchTask: Database not available');
    return;
  }
  
  // 重试机制
  const maxRetries = 3;
  let lastError: any;
  
  // 处理 logs 字段，截断过长的日志
  const processedUpdates = { ...updates };
  if (processedUpdates.logs && Array.isArray(processedUpdates.logs)) {
    if (processedUpdates.logs.length > 100) {
      processedUpdates.logs = processedUpdates.logs.slice(-100);
    }
  }
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 分离 logs 字段，单独处理
      const { logs, ...otherUpdates } = processedUpdates;
      
      // 先更新非 JSON 字段
      if (Object.keys(otherUpdates).length > 0) {
        await db.update(searchTasks).set(otherUpdates as any).where(eq(searchTasks.taskId, taskId));
      }
      
      // 如果有 logs，使用原生 SQL 更新
      if (logs) {
        const logsJson = JSON.stringify(logs);
        await db.execute(sql`UPDATE search_tasks SET logs = ${logsJson} WHERE taskId = ${taskId}`);
      }
      
      return; // 成功则返回
    } catch (error: any) {
      lastError = error;
      console.error(`[DB] updateSearchTask attempt ${attempt}/${maxRetries} failed:`, error.message);
      
      // 如果失败，尝试只更新非 logs 字段
      if (attempt === 2) {
        console.warn('[DB] Retrying without logs field...');
        const { logs, ...updatesWithoutLogs } = processedUpdates;
        try {
          if (Object.keys(updatesWithoutLogs).length > 0) {
            await db.update(searchTasks).set(updatesWithoutLogs as any).where(eq(searchTasks.taskId, taskId));
            console.log('[DB] Update succeeded without logs field');
            return;
          }
        } catch (e) {
          // 继续重试
        }
      }
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)));
      }
    }
  }
  
  console.error('[DB] updateSearchTask failed after all retries:', lastError?.message);
}

export async function updateSearchTaskStatus(taskId: string, status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'insufficient_credits'): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(searchTasks).set({ status }).where(eq(searchTasks.taskId, taskId));
}

export async function getUserSearchTasks(userId: number, page: number = 1, limit: number = 20): Promise<{ tasks: SearchTask[]; total: number }> {
  const db = await getDb();
  if (!db) return { tasks: [], total: 0 };
  const offset = (page - 1) * limit;
  const result = await db.select().from(searchTasks).where(eq(searchTasks.userId, userId)).orderBy(desc(searchTasks.createdAt)).limit(limit).offset(offset);
  const countResult = await db.select({ count: sql<number>`count(*)` }).from(searchTasks).where(eq(searchTasks.userId, userId));
  return { tasks: result, total: countResult[0]?.count || 0 };
}

// ============ 搜索结果相关 ============

export async function saveSearchResult(taskId: number, apolloId: string, data: any, verified: boolean = false, verificationScore?: number, verificationDetails?: any): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.insert(searchResults).values({ taskId, apolloId, data, verified, verificationScore, verificationDetails });
    return true;
  } catch (error) {
    console.error('[DB] saveSearchResult error:', error);
    return false;
  }
}

export async function getSearchResults(taskId: number): Promise<SearchResult[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(searchResults).where(eq(searchResults.taskId, taskId)).orderBy(desc(searchResults.createdAt));
}

export async function updateSearchResult(resultId: number, updates: Partial<{ data: any; verified: boolean; verificationScore: number; verificationDetails: any }>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(searchResults).set(updates).where(eq(searchResults.id, resultId));
}

export async function updateSearchResultByApolloId(taskId: string, apolloId: string, dataUpdates: Record<string, any>): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.log(`[DB] updateSearchResultByApolloId: No database connection`);
    return;
  }
  
  // 先获取任务ID
  const task = await getSearchTask(taskId);
  if (!task) {
    console.log(`[DB] updateSearchResultByApolloId: Task not found for taskId ${taskId}`);
    return;
  }
  
  console.log(`[DB] updateSearchResultByApolloId: Looking for apolloId ${apolloId} in task ${task.id}`);
  
  // 查找对应的搜索结果
  const results = await db.select().from(searchResults).where(
    and(
      eq(searchResults.taskId, task.id),
      eq(searchResults.apolloId, apolloId)
    )
  ).limit(1);
  
  if (results.length === 0) {
    console.log(`[DB] updateSearchResultByApolloId: No result found for apolloId ${apolloId}`);
    return;
  }
  
  const result = results[0];
  const existingData = result.data as Record<string, any> || {};
  
  // 合并更新数据
  const newData = { ...existingData, ...dataUpdates };
  
  console.log(`[DB] updateSearchResultByApolloId: Updating result ${result.id} with phone: ${dataUpdates.phone}`);
  
  // 更新记录
  await db.update(searchResults).set({
    data: newData,
    verified: dataUpdates.verified !== undefined ? dataUpdates.verified : result.verified,
    verificationScore: dataUpdates.verificationScore !== undefined ? dataUpdates.verificationScore : result.verificationScore,
    verificationDetails: dataUpdates.verificationDetails !== undefined ? dataUpdates.verificationDetails : result.verificationDetails
  }).where(eq(searchResults.id, result.id));
  
  console.log(`[DB] updateSearchResultByApolloId: Successfully updated result ${result.id}`);
}

export async function getSearchResultsByTaskId(taskId: string): Promise<SearchResult[]> {
  const db = await getDb();
  if (!db) return [];
  
  const task = await getSearchTask(taskId);
  if (!task) return [];
  
  return db.select().from(searchResults).where(eq(searchResults.taskId, task.id)).orderBy(desc(searchResults.createdAt));
}

// 删除搜索结果（用于年龄筛选排除）
export async function deleteSearchResult(taskId: string, apolloId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  const task = await getSearchTask(taskId);
  if (!task) return false;
  
  try {
    await db.delete(searchResults).where(
      and(
        eq(searchResults.taskId, task.id),
        eq(searchResults.apolloId, apolloId)
      )
    );
    return true;
  } catch (error) {
    console.error('[DB] Error deleting search result:', error);
    return false;
  }
}

// ============ 全局缓存相关 ============

export async function getCacheByKey(cacheKey: string): Promise<GlobalCache | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(globalCache).where(and(eq(globalCache.cacheKey, cacheKey), gte(globalCache.expiresAt, new Date()))).limit(1);
  if (result.length > 0) {
    await db.update(globalCache).set({ hitCount: sql`${globalCache.hitCount} + 1` }).where(eq(globalCache.cacheKey, cacheKey));
  }
  return result.length > 0 ? result[0] : undefined;
}

export async function setCache(cacheKey: string, cacheType: "search" | "person" | "verification", data: any, ttlDays: number = 180): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  await db.insert(globalCache).values({ cacheKey, cacheType, data, expiresAt }).onDuplicateKeyUpdate({ set: { data, expiresAt } });
}

export async function getCacheStats(): Promise<{ totalEntries: number; searchCache: number; personCache: number; verificationCache: number; totalHits: number }> {
  const db = await getDb();
  if (!db) return { totalEntries: 0, searchCache: 0, personCache: 0, verificationCache: 0, totalHits: 0 };
  
  const totalResult = await db.select({ count: sql<number>`count(*)`, hits: sql<number>`COALESCE(SUM(hitCount), 0)` }).from(globalCache);
  const searchResult = await db.select({ count: sql<number>`count(*)` }).from(globalCache).where(eq(globalCache.cacheType, "search"));
  const personResult = await db.select({ count: sql<number>`count(*)` }).from(globalCache).where(eq(globalCache.cacheType, "person"));
  const verificationResult = await db.select({ count: sql<number>`count(*)` }).from(globalCache).where(eq(globalCache.cacheType, "verification"));
  
  return {
    totalEntries: totalResult[0]?.count || 0,
    searchCache: searchResult[0]?.count || 0,
    personCache: personResult[0]?.count || 0,
    verificationCache: verificationResult[0]?.count || 0,
    totalHits: totalResult[0]?.hits || 0
  };
}

// ============ 日志相关 ============

// 注意：apollo_search 和 apollo_enrich 保留用于历史日志兼容
export async function logApi(apiType: "apollo_search" | "apollo_enrich" | "apify_search" | "scrape_tps" | "scrape_fps", endpoint: string, requestParams: any, responseStatus: number, responseTime: number, success: boolean, errorMessage?: string, creditsUsed: number = 0, userId?: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(apiLogs).values({ userId, apiType, endpoint, requestParams, responseStatus, responseTime, success, errorMessage, creditsUsed });
  
  // 同时更新API统计（用于系统监控面板）
  try {
    await updateApiStats(apiType, success, creditsUsed, responseTime);
  } catch (e) {
    // 统计更新失败不影响主流程
    console.error('[logApi] Failed to update API stats:', e);
  }
}

export async function getApiLogs(page: number = 1, limit: number = 50, apiType?: string): Promise<{ logs: ApiLog[]; total: number }> {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };
  const offset = (page - 1) * limit;
  let query = db.select().from(apiLogs);
  let countQuery = db.select({ count: sql<number>`count(*)` }).from(apiLogs);
  if (apiType) {
    query = query.where(eq(apiLogs.apiType, apiType as any)) as typeof query;
    countQuery = countQuery.where(eq(apiLogs.apiType, apiType as any)) as typeof countQuery;
  }
  const result = await query.orderBy(desc(apiLogs.createdAt)).limit(limit).offset(offset);
  const countResult = await countQuery;
  return { logs: result, total: countResult[0]?.count || 0 };
}

export async function logAdmin(adminUsername: string, action: string, targetType?: string, targetId?: string, details?: any, ipAddress?: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(adminLogs).values({ adminUsername, action, targetType, targetId, details, ipAddress });
}

export async function getAdminLogs(page: number = 1, limit: number = 50): Promise<{ logs: AdminLog[]; total: number }> {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };
  const offset = (page - 1) * limit;
  const result = await db.select().from(adminLogs).orderBy(desc(adminLogs.createdAt)).limit(limit).offset(offset);
  const countResult = await db.select({ count: sql<number>`count(*)` }).from(adminLogs);
  return { logs: result, total: countResult[0]?.count || 0 };
}

export async function logLogin(userId: number, deviceId: string | null, ipAddress: string | null, userAgent: string | null, success: boolean, failReason?: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(loginLogs).values({ userId, deviceId, ipAddress, userAgent, success, failReason });
}

export async function getLoginLogs(page: number = 1, limit: number = 50, userId?: number): Promise<{ logs: LoginLog[]; total: number }> {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };
  const offset = (page - 1) * limit;
  let query = db.select().from(loginLogs);
  let countQuery = db.select({ count: sql<number>`count(*)` }).from(loginLogs);
  if (userId) {
    query = query.where(eq(loginLogs.userId, userId)) as typeof query;
    countQuery = countQuery.where(eq(loginLogs.userId, userId)) as typeof countQuery;
  }
  const result = await query.orderBy(desc(loginLogs.createdAt)).limit(limit).offset(offset);
  const countResult = await countQuery;
  return { logs: result, total: countResult[0]?.count || 0 };
}

// ============ 统计相关 ============

export async function getSearchStats(): Promise<{ 
  todaySearches: number; 
  todayCreditsUsed: number; 
  totalSearches: number; 
  cacheHitRate: number;
  fuzzySearches: number;
  exactSearches: number;
  todayFuzzySearches: number;
  todayExactSearches: number;
}> {
  const db = await getDb();
  if (!db) return { 
    todaySearches: 0, 
    todayCreditsUsed: 0, 
    totalSearches: 0, 
    cacheHitRate: 0,
    fuzzySearches: 0,
    exactSearches: 0,
    todayFuzzySearches: 0,
    todayExactSearches: 0
  };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  
  // 基础统计
  const todayResult = await db.select({ count: sql<number>`count(*)`, credits: sql<number>`COALESCE(SUM(creditsUsed), 0)` }).from(searchTasks).where(gte(searchTasks.createdAt, today));
  const totalResult = await db.select({ count: sql<number>`count(*)` }).from(searchTasks);
  
  // 模式统计 - 通过 params JSON 字段中的 mode 字段统计
  const fuzzyResult = await db.select({ count: sql<number>`count(*)` }).from(searchTasks).where(sql`JSON_EXTRACT(params, '$.mode') = 'fuzzy' OR JSON_EXTRACT(params, '$.mode') IS NULL`);
  const exactResult = await db.select({ count: sql<number>`count(*)` }).from(searchTasks).where(sql`JSON_EXTRACT(params, '$.mode') = 'exact'`);
  const todayFuzzyResult = await db.select({ count: sql<number>`count(*)` }).from(searchTasks).where(and(gte(searchTasks.createdAt, today), sql`JSON_EXTRACT(params, '$.mode') = 'fuzzy' OR JSON_EXTRACT(params, '$.mode') IS NULL`));
  const todayExactResult = await db.select({ count: sql<number>`count(*)` }).from(searchTasks).where(and(gte(searchTasks.createdAt, today), sql`JSON_EXTRACT(params, '$.mode') = 'exact'`));
  
  return { 
    todaySearches: todayResult[0]?.count || 0, 
    todayCreditsUsed: todayResult[0]?.credits || 0, 
    totalSearches: totalResult[0]?.count || 0, 
    cacheHitRate: 0,
    fuzzySearches: fuzzyResult[0]?.count || 0,
    exactSearches: exactResult[0]?.count || 0,
    todayFuzzySearches: todayFuzzyResult[0]?.count || 0,
    todayExactSearches: todayExactResult[0]?.count || 0
  };
}

export async function getUserStats(): Promise<{ total: number; active: number; newToday: number; newThisWeek: number }> {
  const db = await getDb();
  if (!db) return { total: 0, active: 0, newToday: 0, newThisWeek: 0 };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const totalResult = await db.select({ count: sql<number>`count(*)` }).from(users);
  const activeResult = await db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.status, "active"));
  const todayResult = await db.select({ count: sql<number>`count(*)` }).from(users).where(gte(users.createdAt, today));
  const weekResult = await db.select({ count: sql<number>`count(*)` }).from(users).where(gte(users.createdAt, weekAgo));
  return { total: totalResult[0]?.count || 0, active: activeResult[0]?.count || 0, newToday: todayResult[0]?.count || 0, newThisWeek: weekResult[0]?.count || 0 };
}

export async function getRechargeStats(): Promise<{ pendingCount: number; todayCount: number; todayAmount: number; monthAmount: number }> {
  const db = await getDb();
  if (!db) return { pendingCount: 0, todayCount: 0, todayAmount: 0, monthAmount: 0 };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const pendingResult = await db.select({ count: sql<number>`count(*)` }).from(rechargeOrders).where(eq(rechargeOrders.status, "pending"));
  const todayResult = await db.select({ count: sql<number>`count(*)`, amount: sql<number>`COALESCE(SUM(CAST(amount AS DECIMAL(10,2))), 0)` }).from(rechargeOrders).where(and(eq(rechargeOrders.status, "paid"), gte(rechargeOrders.paidAt, today)));
  const monthResult = await db.select({ amount: sql<number>`COALESCE(SUM(CAST(amount AS DECIMAL(10,2))), 0)` }).from(rechargeOrders).where(and(eq(rechargeOrders.status, "paid"), gte(rechargeOrders.paidAt, monthStart)));
  return { pendingCount: pendingResult[0]?.count || 0, todayCount: todayResult[0]?.count || 0, todayAmount: todayResult[0]?.amount || 0, monthAmount: monthResult[0]?.amount || 0 };
}

// 获取完整的管理员仪表盘统计
export async function getAdminDashboardStats(): Promise<{
  users: { total: number; active: number; newToday: number; newThisWeek: number };
  orders: { pendingCount: number; todayCount: number; todayAmount: number; monthAmount: number };
  searches: { todaySearches: number; todayCreditsUsed: number; totalSearches: number; cacheHitRate: number; fuzzySearches: number; exactSearches: number; todayFuzzySearches: number; todayExactSearches: number };
  cache: { totalEntries: number; searchCache: number; personCache: number; verificationCache: number; totalHits: number };
}> {
  const [userStats, rechargeStats, searchStats, cacheStats] = await Promise.all([
    getUserStats(),
    getRechargeStats(),
    getSearchStats(),
    getCacheStats()
  ]);
  
  return {
    users: userStats,
    orders: rechargeStats,
    searches: searchStats,
    cache: cacheStats
  };
}

// OAuth兼容
export async function upsertUser(user: Partial<InsertUser> & { openId: string }): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await getUserByOpenId(user.openId);
  if (existing) {
    await db.update(users).set({ lastSignedIn: new Date(), ...(user.name && { name: user.name }), ...(user.email && { email: user.email }) }).where(eq(users.openId, user.openId));
  } else {
    await db.insert(users).values({ openId: user.openId, email: user.email || `${user.openId}@oauth.local`, passwordHash: crypto.randomBytes(32).toString('hex'), name: user.name, credits: 0, role: user.openId === ENV.ownerOpenId ? 'admin' : 'user' });
  }
}


// ============ 缺失的函数补充 ============

export async function verifyUserEmail(token: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  // For now, we'll use a simple token-based verification
  // In production, you'd have a separate email_verification_tokens table
  const result = await db.select().from(users).where(eq(users.resetToken, token)).limit(1);
  if (result.length === 0) return false;
  await db.update(users).set({ emailVerified: true, resetToken: null }).where(eq(users.id, result[0].id));
  return true;
}

export async function createPasswordResetToken(email: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const user = await getUserByEmail(email);
  if (!user) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await db.update(users).set({ resetToken: token, resetTokenExpires: expires }).where(eq(users.id, user.id));
  return token;
}

export async function resetPassword(token: string, newPasswordHash: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.select().from(users).where(and(eq(users.resetToken, token), gte(users.resetTokenExpires, new Date()))).limit(1);
  if (result.length === 0) return false;
  await db.update(users).set({ passwordHash: newPasswordHash, resetToken: null, resetTokenExpires: null }).where(eq(users.id, result[0].id));
  return true;
}

export async function updateUserRole(userId: number, role: "user" | "admin"): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

export async function getCreditTransactions(userId: number, page: number = 1, limit: number = 20): Promise<{ transactions: CreditLog[]; total: number }> {
  return getCreditLogs(userId, page, limit).then(r => ({ transactions: r.logs, total: r.total }));
}


// ============ 用户管理增强功能 ============

// 获取用户详情（包含统计信息）
export async function getUserDetail(userId: number): Promise<{
  user: User | null;
  stats: {
    totalOrders: number;
    totalSpent: number;
    totalSearches: number;
    totalCreditsUsed: number;
    lastLoginAt: Date | null;
    loginCount: number;
  };
} | null> {
  const db = await getDb();
  if (!db) return null;
  
  const user = await getUserById(userId);
  if (!user) return null;
  
  // 获取订单统计
  const orderStats = await db.select({
    count: sql<number>`count(*)`,
    total: sql<number>`COALESCE(SUM(CAST(amount AS DECIMAL(10,2))), 0)`
  }).from(rechargeOrders).where(and(eq(rechargeOrders.userId, userId), eq(rechargeOrders.status, 'paid')));
  
  // 获取搜索统计
  const searchStats = await db.select({
    count: sql<number>`count(*)`,
    credits: sql<number>`COALESCE(SUM(creditsUsed), 0)`
  }).from(searchTasks).where(eq(searchTasks.userId, userId));
  
  // 获取登录统计
  const loginStats = await db.select({
    count: sql<number>`count(*)`,
    lastLogin: sql<Date>`MAX(createdAt)`
  }).from(loginLogs).where(and(eq(loginLogs.userId, userId), eq(loginLogs.success, true)));
  
  return {
    user,
    stats: {
      totalOrders: orderStats[0]?.count || 0,
      totalSpent: orderStats[0]?.total || 0,
      totalSearches: searchStats[0]?.count || 0,
      totalCreditsUsed: searchStats[0]?.credits || 0,
      lastLoginAt: loginStats[0]?.lastLogin || null,
      loginCount: loginStats[0]?.count || 0
    }
  };
}

// 重置用户密码（管理员操作）
export async function adminResetPassword(userId: number, newPasswordHash: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  const result = await db.update(users)
    .set({ passwordHash: newPasswordHash, resetToken: null, resetTokenExpires: null })
    .where(eq(users.id, userId));
  
  return true;
}

// 获取用户搜索历史
export async function getUserSearchHistory(userId: number, page: number = 1, limit: number = 20): Promise<{
  searches: SearchTask[];
  total: number;
}> {
  const db = await getDb();
  if (!db) return { searches: [], total: 0 };
  
  const offset = (page - 1) * limit;
  
  const [searches, countResult] = await Promise.all([
    db.select().from(searchTasks).where(eq(searchTasks.userId, userId)).orderBy(desc(searchTasks.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(searchTasks).where(eq(searchTasks.userId, userId))
  ]);
  
  return { searches, total: countResult[0]?.count || 0 };
}

// 获取用户积分变动记录
export async function getUserCreditHistory(userId: number, page: number = 1, limit: number = 20): Promise<{
  logs: CreditLog[];
  total: number;
}> {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };
  
  const offset = (page - 1) * limit;
  
  const [logs, countResult] = await Promise.all([
    db.select().from(creditLogs).where(eq(creditLogs.userId, userId)).orderBy(desc(creditLogs.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(creditLogs).where(eq(creditLogs.userId, userId))
  ]);
  
  return { logs, total: countResult[0]?.count || 0 };
}

// 获取用户登录记录
export async function getUserLoginHistory(userId: number, page: number = 1, limit: number = 20): Promise<{
  logs: LoginLog[];
  total: number;
}> {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };
  
  const offset = (page - 1) * limit;
  
  const [logs, countResult] = await Promise.all([
    db.select().from(loginLogs).where(eq(loginLogs.userId, userId)).orderBy(desc(loginLogs.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(loginLogs).where(eq(loginLogs.userId, userId))
  ]);
  
  return { logs, total: countResult[0]?.count || 0 };
}

// ============ 公告系统 ============

// 创建公告
export async function createAnnouncement(data: {
  title: string;
  content: string;
  type?: 'info' | 'warning' | 'success' | 'error';
  isPinned?: boolean;
  startTime?: Date;
  endTime?: Date;
  createdBy?: string;
}): Promise<Announcement | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.insert(announcements).values({
    title: data.title,
    content: data.content,
    type: data.type || 'info',
    isPinned: data.isPinned || false,
    startTime: data.startTime,
    endTime: data.endTime,
    createdBy: data.createdBy
  });
  
  const inserted = await db.select().from(announcements).where(eq(announcements.id, Number(result[0].insertId))).limit(1);
  return inserted[0] || null;
}

// 更新公告
export async function updateAnnouncement(id: number, data: Partial<{
  title: string;
  content: string;
  type: 'info' | 'warning' | 'success' | 'error';
  isPinned: boolean;
  isActive: boolean;
  startTime: Date | null;
  endTime: Date | null;
}>): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(announcements).set(data).where(eq(announcements.id, id));
  return true;
}

// 删除公告
export async function deleteAnnouncement(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.delete(announcements).where(eq(announcements.id, id));
  return true;
}

// 获取公告列表（管理员）
export async function getAnnouncementsAdmin(page: number = 1, limit: number = 20): Promise<{
  announcements: Announcement[];
  total: number;
}> {
  const db = await getDb();
  if (!db) return { announcements: [], total: 0 };
  
  const offset = (page - 1) * limit;
  
  const [list, countResult] = await Promise.all([
    db.select().from(announcements).orderBy(desc(announcements.isPinned), desc(announcements.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(announcements)
  ]);
  
  return { announcements: list, total: countResult[0]?.count || 0 };
}

// 获取活跃公告（用户端）
export async function getActiveAnnouncements(): Promise<Announcement[]> {
  const db = await getDb();
  if (!db) return [];
  
  const now = new Date();
  
  return db.select().from(announcements)
    .where(and(
      eq(announcements.isActive, true),
      or(
        sql`${announcements.startTime} IS NULL`,
        lte(announcements.startTime, now)
      ),
      or(
        sql`${announcements.endTime} IS NULL`,
        gte(announcements.endTime, now)
      )
    ))
    .orderBy(desc(announcements.isPinned), desc(announcements.createdAt))
    .limit(10);
}

// ============ 用户消息系统 ============

// 发送消息给用户
export async function sendMessageToUser(data: {
  userId: number;
  title: string;
  content: string;
  type?: 'system' | 'support' | 'notification' | 'promotion';
  createdBy?: string;
}): Promise<UserMessage | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.insert(userMessages).values({
    userId: data.userId,
    title: data.title,
    content: data.content,
    type: data.type || 'system',
    createdBy: data.createdBy
  });
  
  const inserted = await db.select().from(userMessages).where(eq(userMessages.id, Number(result[0].insertId))).limit(1);
  return inserted[0] || null;
}

// 批量发送消息
export async function sendMessageToUsers(userIds: number[], data: {
  title: string;
  content: string;
  type?: 'system' | 'support' | 'notification' | 'promotion';
  createdBy?: string;
}): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const values = userIds.map(userId => ({
    userId,
    title: data.title,
    content: data.content,
    type: data.type || 'system',
    createdBy: data.createdBy
  }));
  
  await db.insert(userMessages).values(values);
  return userIds.length;
}

// 获取用户消息
export async function getUserMessages(userId: number, page: number = 1, limit: number = 20): Promise<{
  messages: UserMessage[];
  total: number;
  unreadCount: number;
}> {
  const db = await getDb();
  if (!db) return { messages: [], total: 0, unreadCount: 0 };
  
  const offset = (page - 1) * limit;
  
  const [messages, countResult, unreadResult] = await Promise.all([
    db.select().from(userMessages).where(eq(userMessages.userId, userId)).orderBy(desc(userMessages.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(userMessages).where(eq(userMessages.userId, userId)),
    db.select({ count: sql<number>`count(*)` }).from(userMessages).where(and(eq(userMessages.userId, userId), eq(userMessages.isRead, false)))
  ]);
  
  return { 
    messages, 
    total: countResult[0]?.count || 0,
    unreadCount: unreadResult[0]?.count || 0
  };
}

// 标记消息已读
export async function markMessageAsRead(messageId: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(userMessages)
    .set({ isRead: true })
    .where(and(eq(userMessages.id, messageId), eq(userMessages.userId, userId)));
  return true;
}

// 标记所有消息已读
export async function markAllMessagesAsRead(userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(userMessages)
    .set({ isRead: true })
    .where(eq(userMessages.userId, userId));
  return true;
}

// 获取未读消息数量（优化版，不需要查询完整消息列表）
export async function getUnreadMessageCount(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db.select({ count: sql<number>`count(*)` })
    .from(userMessages)
    .where(and(eq(userMessages.userId, userId), eq(userMessages.isRead, false)));
  return result[0]?.count || 0;
}

// ============ 用户活动日志 ============

// 记录用户活动
export async function logUserActivity(data: {
  userId: number;
  action: string;
  details?: any;
  ipAddress?: string;
  userAgent?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  await db.insert(userActivityLogs).values({
    userId: data.userId,
    action: data.action,
    details: data.details,
    ipAddress: data.ipAddress,
    userAgent: data.userAgent
  });
}

// 获取用户活动日志
export async function getUserActivityLogs(userId: number, page: number = 1, limit: number = 50): Promise<{
  logs: UserActivityLog[];
  total: number;
}> {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };
  
  const offset = (page - 1) * limit;
  
  const [logs, countResult] = await Promise.all([
    db.select().from(userActivityLogs).where(eq(userActivityLogs.userId, userId)).orderBy(desc(userActivityLogs.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(userActivityLogs).where(eq(userActivityLogs.userId, userId))
  ]);
  
  return { logs, total: countResult[0]?.count || 0 };
}

// ============ 系统错误日志 ============

// 记录错误日志
export async function logError(data: {
  level?: 'error' | 'warn' | 'info';
  source?: string;
  message: string;
  stack?: string;
  userId?: number;
  requestPath?: string;
  requestBody?: any;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  await db.insert(errorLogs).values({
    level: data.level || 'error',
    source: data.source,
    message: data.message,
    stack: data.stack,
    userId: data.userId,
    requestPath: data.requestPath,
    requestBody: data.requestBody
  });
}

// 获取错误日志
export async function getErrorLogs(page: number = 1, limit: number = 50, level?: string, resolved?: boolean): Promise<{
  logs: ErrorLog[];
  total: number;
}> {
  const db = await getDb();
  if (!db) return { logs: [], total: 0 };
  
  const offset = (page - 1) * limit;
  
  let whereClause = sql`1=1`;
  if (level) {
    whereClause = and(whereClause, eq(errorLogs.level, level as any))!;
  }
  if (resolved !== undefined) {
    whereClause = and(whereClause, eq(errorLogs.resolved, resolved))!;
  }
  
  const [logs, countResult] = await Promise.all([
    db.select().from(errorLogs).where(whereClause).orderBy(desc(errorLogs.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(errorLogs).where(whereClause)
  ]);
  
  return { logs, total: countResult[0]?.count || 0 };
}

// 标记错误已解决
export async function resolveError(errorId: number, resolvedBy: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(errorLogs)
    .set({ resolved: true, resolvedBy, resolvedAt: new Date() })
    .where(eq(errorLogs.id, errorId));
  return true;
}

// ============ API统计 ============

// 更新API统计
export async function updateApiStats(apiName: string, success: boolean, creditsUsed: number = 0, responseTime: number = 0): Promise<void> {
  const db = await getDb();
  if (!db) return;
  
  const today = new Date().toISOString().split('T')[0];
  
  // 尝试更新现有记录
  const existing = await db.select().from(apiStats).where(and(eq(apiStats.date, today), eq(apiStats.apiName, apiName))).limit(1);
  
  if (existing.length > 0) {
    const current = existing[0];
    const newCallCount = (current.callCount || 0) + 1;
    const newSuccessCount = (current.successCount || 0) + (success ? 1 : 0);
    const newErrorCount = (current.errorCount || 0) + (success ? 0 : 1);
    const newTotalCredits = (current.totalCreditsUsed || 0) + creditsUsed;
    const newAvgResponseTime = Math.round(((current.avgResponseTime || 0) * (newCallCount - 1) + responseTime) / newCallCount);
    
    await db.update(apiStats)
      .set({
        callCount: newCallCount,
        successCount: newSuccessCount,
        errorCount: newErrorCount,
        totalCreditsUsed: newTotalCredits,
        avgResponseTime: newAvgResponseTime
      })
      .where(eq(apiStats.id, current.id));
  } else {
    await db.insert(apiStats).values({
      date: today,
      apiName,
      callCount: 1,
      successCount: success ? 1 : 0,
      errorCount: success ? 0 : 1,
      totalCreditsUsed: creditsUsed,
      avgResponseTime: responseTime
    });
  }
}

// 获取API统计
export async function getApiStatistics(days: number = 30): Promise<{
  daily: ApiStat[];
  summary: {
    totalCalls: number;
    totalSuccess: number;
    totalErrors: number;
    totalCredits: number;
    avgResponseTime: number;
  };
  // 新增：前端兼容字段
  totalCalls: number;
  successRate: number;
  avgResponseTime: number;
  errorCount: number;
  byEndpoint: Array<{
    endpoint: string;
    calls: number;
    success: number;
    errors: number;
    avgTime: number;
  }>;
}> {
  const db = await getDb();
  if (!db) return { 
    daily: [], 
    summary: { totalCalls: 0, totalSuccess: 0, totalErrors: 0, totalCredits: 0, avgResponseTime: 0 },
    totalCalls: 0,
    successRate: 0,
    avgResponseTime: 0,
    errorCount: 0,
    byEndpoint: []
  };
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startDateStr = startDate.toISOString().split('T')[0];
  
  const daily = await db.select().from(apiStats).where(gte(apiStats.date, startDateStr)).orderBy(desc(apiStats.date));
  
  const summary = daily.reduce((acc, stat) => ({
    totalCalls: acc.totalCalls + (stat.callCount || 0),
    totalSuccess: acc.totalSuccess + (stat.successCount || 0),
    totalErrors: acc.totalErrors + (stat.errorCount || 0),
    totalCredits: acc.totalCredits + (stat.totalCreditsUsed || 0),
    avgResponseTime: 0 // 计算后更新
  }), { totalCalls: 0, totalSuccess: 0, totalErrors: 0, totalCredits: 0, avgResponseTime: 0 });
  
  if (summary.totalCalls > 0) {
    const totalResponseTime = daily.reduce((sum, stat) => sum + (stat.avgResponseTime || 0) * (stat.callCount || 0), 0);
    summary.avgResponseTime = Math.round(totalResponseTime / summary.totalCalls);
  }
  
  // 按API名称分组统计
  const endpointMap = new Map<string, { calls: number; success: number; errors: number; totalTime: number }>();
  daily.forEach(stat => {
    const apiName = stat.apiName || 'unknown';
    const existing = endpointMap.get(apiName) || { calls: 0, success: 0, errors: 0, totalTime: 0 };
    existing.calls += stat.callCount || 0;
    existing.success += stat.successCount || 0;
    existing.errors += stat.errorCount || 0;
    existing.totalTime += (stat.avgResponseTime || 0) * (stat.callCount || 0);
    endpointMap.set(apiName, existing);
  });
  
  const byEndpoint = Array.from(endpointMap.entries()).map(([endpoint, data]) => ({
    endpoint,
    calls: data.calls,
    success: data.success,
    errors: data.errors,
    avgTime: data.calls > 0 ? Math.round(data.totalTime / data.calls) : 0
  })).sort((a, b) => b.calls - a.calls);
  
  // 计算成功率
  const successRate = summary.totalCalls > 0 
    ? Math.round((summary.totalSuccess / summary.totalCalls) * 100) 
    : 0;
  
  return { 
    daily, 
    summary,
    // 前端兼容字段
    totalCalls: summary.totalCalls,
    successRate,
    avgResponseTime: summary.avgResponseTime,
    errorCount: summary.totalErrors,
    byEndpoint
  };
}

// ============ 订单退款 ============

// 退款订单
export async function refundOrder(orderId: string, adminNote?: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  const order = await getRechargeOrder(orderId);
  if (!order || order.status !== 'paid') return false;
  
  // 扣除用户积分
  const deductResult = await deductCredits(order.userId, order.credits, 'admin_deduct', `订单退款: ${orderId}`);
  if (!deductResult) return false;
  
  // 更新订单状态
  await db.update(rechargeOrders)
    .set({ status: 'cancelled', adminNote: adminNote || '管理员退款' })
    .where(eq(rechargeOrders.orderId, orderId));
  
  return true;
}

// ============ 搜索订单 ============

// 搜索订单
export async function searchOrders(query: string, page: number = 1, limit: number = 20): Promise<{
  orders: RechargeOrder[];
  total: number;
}> {
  const db = await getDb();
  if (!db) return { orders: [], total: 0 };
  
  const offset = (page - 1) * limit;
  
  const whereClause = or(
    like(rechargeOrders.orderId, `%${query}%`),
    like(rechargeOrders.txId, `%${query}%`)
  );
  
  const [orders, countResult] = await Promise.all([
    db.select().from(rechargeOrders).where(whereClause).orderBy(desc(rechargeOrders.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(rechargeOrders).where(whereClause)
  ]);
  
  return { orders, total: countResult[0]?.count || 0 };
}


// ============ 用户反馈系统 ============

// 创建用户反馈
export async function createFeedback(data: {
  userId: number;
  type: 'question' | 'suggestion' | 'business' | 'custom_dev' | 'other';
  title: string;
  content: string;
  contactInfo?: string;
}): Promise<UserFeedback | null> {
  const db = await getDb();
  if (!db) return null;
  
  // 动态构建插入对象，只有当 contactInfo 有值时才包含该字段
  const insertValues: any = {
    userId: data.userId,
    type: data.type,
    title: data.title,
    content: data.content,
  };
  
  // 只有当 contactInfo 有实际内容时才添加到插入对象中
  if (data.contactInfo && data.contactInfo.trim()) {
    insertValues.contactInfo = data.contactInfo.trim();
  }
  
  const result = await db.insert(userFeedbacks).values(insertValues);
  
  const inserted = await db.select().from(userFeedbacks).where(eq(userFeedbacks.id, Number(result[0].insertId))).limit(1);
  return inserted[0] || null;
}

// 获取用户的反馈列表
export async function getUserFeedbacks(userId: number, page: number = 1, limit: number = 20): Promise<{
  feedbacks: UserFeedback[];
  total: number;
}> {
  const db = await getDb();
  if (!db) return { feedbacks: [], total: 0 };
  
  const offset = (page - 1) * limit;
  
  const [feedbacks, countResult] = await Promise.all([
    db.select().from(userFeedbacks).where(eq(userFeedbacks.userId, userId)).orderBy(desc(userFeedbacks.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(userFeedbacks).where(eq(userFeedbacks.userId, userId))
  ]);
  
  return { feedbacks, total: countResult[0]?.count || 0 };
}

// 获取所有反馈列表（管理员）
export async function getAllFeedbacks(
  page: number = 1, 
  limit: number = 20,
  status?: 'pending' | 'processing' | 'resolved' | 'closed',
  type?: 'question' | 'suggestion' | 'business' | 'custom_dev' | 'other'
): Promise<{
  feedbacks: (UserFeedback & { userEmail?: string })[];
  total: number;
  stats: {
    pending: number;
    processing: number;
    resolved: number;
    closed: number;
  };
}> {
  const db = await getDb();
  if (!db) return { feedbacks: [], total: 0, stats: { pending: 0, processing: 0, resolved: 0, closed: 0 } };
  
  const offset = (page - 1) * limit;
  
  // 构建查询条件
  const conditions = [];
  if (status) conditions.push(eq(userFeedbacks.status, status));
  if (type) conditions.push(eq(userFeedbacks.type, type));
  
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  
  // 获取反馈列表（关联用户邮箱）
  const feedbacksQuery = db.select({
    id: userFeedbacks.id,
    userId: userFeedbacks.userId,
    type: userFeedbacks.type,
    title: userFeedbacks.title,
    content: userFeedbacks.content,
    contactInfo: userFeedbacks.contactInfo,
    status: userFeedbacks.status,
    adminReply: userFeedbacks.adminReply,
    repliedBy: userFeedbacks.repliedBy,
    repliedAt: userFeedbacks.repliedAt,
    createdAt: userFeedbacks.createdAt,
    updatedAt: userFeedbacks.updatedAt,
    userEmail: users.email
  })
  .from(userFeedbacks)
  .leftJoin(users, eq(userFeedbacks.userId, users.id))
  .orderBy(desc(userFeedbacks.createdAt))
  .limit(limit)
  .offset(offset);
  
  if (whereClause) {
    feedbacksQuery.where(whereClause);
  }
  
  const feedbacks = await feedbacksQuery.then(rows => rows.map(row => ({
    ...row,
    userEmail: row.userEmail ?? undefined
  })));
  
  // 获取总数
  const countQuery = db.select({ count: sql<number>`count(*)` }).from(userFeedbacks);
  if (whereClause) {
    countQuery.where(whereClause);
  }
  const countResult = await countQuery;
  
  // 获取各状态统计
  const statsResult = await db.select({
    status: userFeedbacks.status,
    count: sql<number>`count(*)`
  }).from(userFeedbacks).groupBy(userFeedbacks.status);
  
  const stats = { pending: 0, processing: 0, resolved: 0, closed: 0 };
  statsResult.forEach(s => {
    if (s.status in stats) {
      stats[s.status as keyof typeof stats] = s.count;
    }
  });
  
  return { feedbacks, total: countResult[0]?.count || 0, stats };
}

// 回复用户反馈
export async function replyFeedback(
  feedbackId: number, 
  reply: string, 
  repliedBy: string,
  newStatus?: 'pending' | 'processing' | 'resolved' | 'closed'
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(userFeedbacks)
    .set({ 
      adminReply: reply, 
      repliedBy, 
      repliedAt: new Date(),
      status: newStatus || 'resolved'
    })
    .where(eq(userFeedbacks.id, feedbackId));
  
  return true;
}

// 更新反馈状态
export async function updateFeedbackStatus(
  feedbackId: number, 
  status: 'pending' | 'processing' | 'resolved' | 'closed'
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  
  await db.update(userFeedbacks)
    .set({ status })
    .where(eq(userFeedbacks.id, feedbackId));
  
  return true;
}

// 获取单个反馈详情
export async function getFeedbackById(feedbackId: number): Promise<(UserFeedback & { userEmail?: string }) | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select({
    id: userFeedbacks.id,
    userId: userFeedbacks.userId,
    type: userFeedbacks.type,
    title: userFeedbacks.title,
    content: userFeedbacks.content,
    contactInfo: userFeedbacks.contactInfo,
    status: userFeedbacks.status,
    adminReply: userFeedbacks.adminReply,
    repliedBy: userFeedbacks.repliedBy,
    repliedAt: userFeedbacks.repliedAt,
    createdAt: userFeedbacks.createdAt,
    updatedAt: userFeedbacks.updatedAt,
    userEmail: users.email
  })
  .from(userFeedbacks)
  .leftJoin(users, eq(userFeedbacks.userId, users.id))
  .where(eq(userFeedbacks.id, feedbackId))
  .limit(1);
  
  if (!result[0]) return null;
  return {
    ...result[0],
    userEmail: result[0].userEmail ?? undefined
  };
}


// ============ 积分报表系统（新增） ============

/**
 * 高级积分查询 - 支持多条件筛选
 * @param userId 用户ID
 * @param options 筛选选项
 */
export async function getAdvancedCreditLogs(
  userId: number,
  options: {
    page?: number;
    limit?: number;
    startDate?: Date;
    endDate?: Date;
    type?: string;
    minAmount?: number;
    maxAmount?: number;
  } = {}
): Promise<{
  logs: CreditLog[];
  total: number;
  stats: {
    totalIn: number;      // 总收入（正数）
    totalOut: number;     // 总支出（负数的绝对值）
    netChange: number;    // 净变动
    count: number;        // 记录数
  };
}> {
  const db = await getDb();
  if (!db) return { logs: [], total: 0, stats: { totalIn: 0, totalOut: 0, netChange: 0, count: 0 } };
  
  const { page = 1, limit = 50, startDate, endDate, type, minAmount, maxAmount } = options;
  const offset = (page - 1) * limit;
  
  // 构建查询条件
  let conditions: any[] = [eq(creditLogs.userId, userId)];
  
  if (startDate) {
    conditions.push(gte(creditLogs.createdAt, startDate));
  }
  if (endDate) {
    conditions.push(lte(creditLogs.createdAt, endDate));
  }
  if (type && type !== 'all') {
    conditions.push(eq(creditLogs.type, type as any));
  }
  if (minAmount !== undefined) {
    conditions.push(gte(creditLogs.amount, minAmount));
  }
  if (maxAmount !== undefined) {
    conditions.push(lte(creditLogs.amount, maxAmount));
  }
  
  const whereClause = and(...conditions);
  
  // 查询记录
  const [logs, countResult] = await Promise.all([
    db.select().from(creditLogs).where(whereClause).orderBy(desc(creditLogs.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(creditLogs).where(whereClause)
  ]);
  
  // 计算统计数据
  const statsResult = await db.select({
    totalIn: sql<number>`COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0)`,
    totalOut: sql<number>`COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0)`,
    netChange: sql<number>`COALESCE(SUM(amount), 0)`
  }).from(creditLogs).where(whereClause);
  
  return {
    logs,
    total: countResult[0]?.count || 0,
    stats: {
      totalIn: Number(statsResult[0]?.totalIn) || 0,
      totalOut: Number(statsResult[0]?.totalOut) || 0,
      netChange: Number(statsResult[0]?.netChange) || 0,
      count: countResult[0]?.count || 0
    }
  };
}

/**
 * 获取用户积分统计概览
 * @param userId 用户ID
 */
export async function getUserCreditStats(userId: number): Promise<{
  currentBalance: number;
  totalRecharge: number;    // 累计充值
  totalSearch: number;      // 累计搜索消费
  totalRefund: number;      // 累计退款
  totalBonus: number;       // 累计赠送
  totalAdminAdjust: number; // 管理员调整
  firstTransactionAt: Date | null;
  lastTransactionAt: Date | null;
  transactionCount: number;
}> {
  const db = await getDb();
  if (!db) return {
    currentBalance: 0, totalRecharge: 0, totalSearch: 0, totalRefund: 0,
    totalBonus: 0, totalAdminAdjust: 0, firstTransactionAt: null, lastTransactionAt: null, transactionCount: 0
  };
  
  // 获取用户当前余额
  const user = await db.select({ credits: users.credits }).from(users).where(eq(users.id, userId)).limit(1);
  const currentBalance = user[0]?.credits || 0;
  
  // 按类型统计积分变动
  const typeStats = await db.select({
    type: creditLogs.type,
    total: sql<number>`COALESCE(SUM(amount), 0)`
  }).from(creditLogs).where(eq(creditLogs.userId, userId)).groupBy(creditLogs.type);
  
  // 获取时间范围和总数
  const timeStats = await db.select({
    firstAt: sql<Date>`MIN(created_at)`,
    lastAt: sql<Date>`MAX(created_at)`,
    count: sql<number>`COUNT(*)`
  }).from(creditLogs).where(eq(creditLogs.userId, userId));
  
  // 整理统计数据
  const stats: Record<string, number> = {};
  typeStats.forEach(s => {
    stats[s.type] = Number(s.total) || 0;
  });
  
  return {
    currentBalance,
    totalRecharge: stats['recharge'] || 0,
    totalSearch: Math.abs(stats['search'] || 0),
    totalRefund: stats['refund'] || 0,
    totalBonus: stats['bonus'] || 0,
    totalAdminAdjust: (stats['admin_add'] || 0) + (stats['admin_deduct'] || 0) + (stats['admin_adjust'] || 0),
    firstTransactionAt: timeStats[0]?.firstAt || null,
    lastTransactionAt: timeStats[0]?.lastAt || null,
    transactionCount: Number(timeStats[0]?.count) || 0
  };
}

/**
 * 获取全局积分统计报表
 * @param days 统计天数
 */
export async function getGlobalCreditReport(days: number = 30): Promise<{
  daily: Array<{
    date: string;
    recharge: number;
    search: number;
    refund: number;
    bonus: number;
    netChange: number;
  }>;
  summary: {
    totalRecharge: number;
    totalSearch: number;
    totalRefund: number;
    totalBonus: number;
    netChange: number;
    activeUsers: number;
  };
}> {
  const db = await getDb();
  if (!db) return { daily: [], summary: { totalRecharge: 0, totalSearch: 0, totalRefund: 0, totalBonus: 0, netChange: 0, activeUsers: 0 } };
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  // 按日期和类型统计
  const dailyStats = await db.select({
    date: sql<string>`DATE(created_at)`,
    type: creditLogs.type,
    total: sql<number>`COALESCE(SUM(amount), 0)`
  })
  .from(creditLogs)
  .where(gte(creditLogs.createdAt, startDate))
  .groupBy(sql`DATE(created_at)`, creditLogs.type)
  .orderBy(sql`DATE(created_at)`);
  
  // 整理每日数据
  const dailyMap = new Map<string, { recharge: number; search: number; refund: number; bonus: number; netChange: number }>();
  
  dailyStats.forEach(stat => {
    const dateStr = String(stat.date);
    if (!dailyMap.has(dateStr)) {
      dailyMap.set(dateStr, { recharge: 0, search: 0, refund: 0, bonus: 0, netChange: 0 });
    }
    const day = dailyMap.get(dateStr)!;
    const amount = Number(stat.total) || 0;
    
    switch (stat.type) {
      case 'recharge':
        day.recharge += amount;
        break;
      case 'search':
        day.search += Math.abs(amount);
        break;
      case 'refund':
        day.refund += amount;
        break;
      case 'bonus':
        day.bonus += amount;
        break;
    }
    day.netChange += amount;
  });
  
  const daily = Array.from(dailyMap.entries()).map(([date, stats]) => ({ date, ...stats }));
  
  // 计算汇总
  const summary = {
    totalRecharge: daily.reduce((sum, d) => sum + d.recharge, 0),
    totalSearch: daily.reduce((sum, d) => sum + d.search, 0),
    totalRefund: daily.reduce((sum, d) => sum + d.refund, 0),
    totalBonus: daily.reduce((sum, d) => sum + d.bonus, 0),
    netChange: daily.reduce((sum, d) => sum + d.netChange, 0),
    activeUsers: 0
  };
  
  // 统计活跃用户数
  const activeUsersResult = await db.select({
    count: sql<number>`COUNT(DISTINCT user_id)`
  }).from(creditLogs).where(gte(creditLogs.createdAt, startDate));
  
  summary.activeUsers = Number(activeUsersResult[0]?.count) || 0;
  
  return { daily, summary };
}

/**
 * 导出用户积分记录为 CSV 格式
 * @param userId 用户ID
 * @param options 筛选选项
 */
export async function exportUserCreditLogs(
  userId: number,
  options: {
    startDate?: Date;
    endDate?: Date;
    type?: string;
  } = {}
): Promise<string> {
  const db = await getDb();
  if (!db) return '';
  
  const { startDate, endDate, type } = options;
  
  // 构建查询条件
  let conditions: any[] = [eq(creditLogs.userId, userId)];
  
  if (startDate) {
    conditions.push(gte(creditLogs.createdAt, startDate));
  }
  if (endDate) {
    conditions.push(lte(creditLogs.createdAt, endDate));
  }
  if (type && type !== 'all') {
    conditions.push(eq(creditLogs.type, type as any));
  }
  
  const whereClause = and(...conditions);
  
  // 查询所有符合条件的记录（不分页）
  const logs = await db.select().from(creditLogs).where(whereClause).orderBy(desc(creditLogs.createdAt));
  
  // 生成 CSV 内容
  const headers = ['ID', '时间', '类型', '变动金额', '变动后余额', '说明', '关联订单', '关联任务'];
  const typeLabels: Record<string, string> = {
    'recharge': '充值',
    'search': '搜索消费',
    'admin_add': '管理员增加',
    'admin_deduct': '管理员扣除',
    'refund': '退款',
    'admin_adjust': '管理员调整',
    'bonus': '赠送'
  };
  
  const rows = logs.map(log => [
    log.id,
    new Date(log.createdAt).toLocaleString('zh-CN'),
    typeLabels[log.type] || log.type,
    log.amount > 0 ? `+${log.amount}` : log.amount,
    log.balanceAfter,
    log.description || '',
    log.relatedOrderId || '',
    log.relatedTaskId || ''
  ]);
  
  // 组装 CSV
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  
  return csvContent;
}

/**
 * 获取积分异常检测报告
 * @param threshold 异常阈值（单次变动超过此值视为异常）
 */
export async function getCreditAnomalies(threshold: number = 1000): Promise<Array<{
  userId: number;
  userEmail: string;
  logId: number;
  amount: number;
  type: string;
  description: string | null;
  createdAt: Date;
}>> {
  const db = await getDb();
  if (!db) return [];
  
  // 查询大额变动记录
  const anomalies = await db.select({
    userId: creditLogs.userId,
    userEmail: users.email,
    logId: creditLogs.id,
    amount: creditLogs.amount,
    type: creditLogs.type,
    description: creditLogs.description,
    createdAt: creditLogs.createdAt
  })
  .from(creditLogs)
  .leftJoin(users, eq(creditLogs.userId, users.id))
  .where(or(
    gte(creditLogs.amount, threshold),
    lte(creditLogs.amount, -threshold)
  ))
  .orderBy(desc(creditLogs.createdAt))
  .limit(100);
  
  return anomalies.map(a => ({
    ...a,
    userEmail: a.userEmail || 'Unknown'
  }));
}
