import { eq, and, gte, lte, desc, sql, like, or } from "drizzle-orm";
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
  apiLogs, ApiLog
} from "../drizzle/schema";
import { ENV } from './_core/env';
import crypto from 'crypto';

let _db: ReturnType<typeof drizzle> | null = null;

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
  await db.insert(users).values({ openId, email, passwordHash, credits: 0 });
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
  if (!db) return;
  await db.update(searchTasks).set(updates as any).where(eq(searchTasks.taskId, taskId));
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

export async function saveSearchResult(taskId: number, apolloId: string, data: any, verified: boolean = false, verificationScore?: number, verificationDetails?: any): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(searchResults).values({ taskId, apolloId, data, verified, verificationScore, verificationDetails });
}

export async function getSearchResults(taskId: number): Promise<SearchResult[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(searchResults).where(eq(searchResults.taskId, taskId)).orderBy(desc(searchResults.createdAt));
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

export async function logApi(apiType: "apollo_search" | "apollo_enrich" | "scrape_tps" | "scrape_fps", endpoint: string, requestParams: any, responseStatus: number, responseTime: number, success: boolean, errorMessage?: string, creditsUsed: number = 0, userId?: number): Promise<void> {
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
