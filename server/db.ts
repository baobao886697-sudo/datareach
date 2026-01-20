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
  errorLogs, ErrorLog
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

export async function createUser(email: string, passwordHash: string): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const openId = crypto.randomBytes(16).toString('hex');
  // 注册赠送100积分
  const REGISTER_BONUS_CREDITS = 100;
  await db.insert(users).values({ openId, email, passwordHash, credits: REGISTER_BONUS_CREDITS });
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

export async function getAllUsers(page: number = 1, limit: number = 20, search?: string): Promise<{ users: User[]; total: number }> {
  const db = await getDb();
  if (!db) return { users: [], total: 0 };
  const offset = (page - 1) * limit;
  let query = db.select().from(users);
  let countQuery = db.select({ count: sql<number>`count(*)` }).from(users);
  if (search) {
    const cond = or(like(users.email, `%${search}%`), like(users.name, `%${search}%`));
    query = query.where(cond) as typeof query;
    countQuery = countQuery.where(cond) as typeof countQuery;
  }
  const result = await query.orderBy(desc(users.createdAt)).limit(limit).offset(offset);
  const countResult = await countQuery;
  return { users: result, total: countResult[0]?.count || 0 };
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

export async function deductCredits(userId: number, amount: number, type: "search" | "admin_deduct", description: string, relatedTaskId?: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const user = await getUserById(userId);
  if (!user || user.credits < amount) return false;
  const newBalance = user.credits - amount;
  await db.update(users).set({ credits: newBalance }).where(eq(users.id, userId));
  await db.insert(creditLogs).values({ userId, amount: -amount, balanceAfter: newBalance, type, description, relatedTaskId });
  return true;
}

export async function addCredits(userId: number, amount: number, type: "recharge" | "admin_add" | "refund", description: string, relatedOrderId?: string): Promise<{ success: boolean; newBalance?: number }> {
  const db = await getDb();
  if (!db) return { success: false };
  const user = await getUserById(userId);
  if (!user) return { success: false };
  const newBalance = user.credits + amount;
  await db.update(users).set({ credits: newBalance }).where(eq(users.id, userId));
  await db.insert(creditLogs).values({ userId, amount, balanceAfter: newBalance, type, description, relatedOrderId });
  return { success: true, newBalance };
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

export async function updateSearchTaskStatus(taskId: string, status: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(searchTasks).set({ status, updatedAt: new Date() }).where(eq(searchTasks.taskId, taskId));
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

export async function getSearchStats(): Promise<{ todaySearches: number; todayCreditsUsed: number; totalSearches: number; cacheHitRate: number }> {
  const db = await getDb();
  if (!db) return { todaySearches: 0, todayCreditsUsed: 0, totalSearches: 0, cacheHitRate: 0 };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayResult = await db.select({ count: sql<number>`count(*)`, credits: sql<number>`COALESCE(SUM(creditsUsed), 0)` }).from(searchTasks).where(gte(searchTasks.createdAt, today));
  const totalResult = await db.select({ count: sql<number>`count(*)` }).from(searchTasks);
  return { todaySearches: todayResult[0]?.count || 0, todayCreditsUsed: todayResult[0]?.credits || 0, totalSearches: totalResult[0]?.count || 0, cacheHitRate: 0 };
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
  searches: { todaySearches: number; todayCreditsUsed: number; totalSearches: number; cacheHitRate: number };
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
}> {
  const db = await getDb();
  if (!db) return { daily: [], summary: { totalCalls: 0, totalSuccess: 0, totalErrors: 0, totalCredits: 0, avgResponseTime: 0 } };
  
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
  
  return { daily, summary };
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
