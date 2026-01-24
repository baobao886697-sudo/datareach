/**
 * TruePeopleSearch 数据库操作
 */

import { getDb } from "../db";
import { 
  tpsConfig, 
  tpsDetailCache, 
  tpsSearchTasks, 
  tpsSearchResults,
  users,
  creditLogs,
  apiLogs,
} from "../../drizzle/schema";
import { eq, and, inArray, desc, sql, gte } from "drizzle-orm";
import crypto from "crypto";

// 获取数据库实例的辅助函数
async function db() {
  const database = await getDb();
  if (!database) {
    throw new Error("数据库连接失败");
  }
  return database;
}

// ==================== 配置相关 ====================

/**
 * 获取 TPS 配置
 */
export async function getTpsConfig() {
  const database = await db();
  const configs = await database.select().from(tpsConfig).limit(1);
  const config = configs[0];
  
  if (!config) {
    // 返回默认配置
    return {
      id: 0,
      searchCost: "0.3",
      detailCost: "0.3",
      maxConcurrent: 40,
      cacheDays: 30,
      scrapeDoToken: process.env.TPS_SCRAPE_DO_TOKEN || null,
      maxPages: 25,
      batchDelay: 200,
      enabled: true,
    };
  }
  
  return config;
}

/**
 * 更新 TPS 配置
 */
export async function updateTpsConfig(data: {
  searchCost?: string;
  detailCost?: string;
  maxConcurrent?: number;
  cacheDays?: number;
  scrapeDoToken?: string;
  maxPages?: number;
  batchDelay?: number;
  enabled?: boolean;
}) {
  const database = await db();
  const existing = await database.select().from(tpsConfig).limit(1);
  
  if (existing[0]) {
    await database.update(tpsConfig).set(data).where(eq(tpsConfig.id, existing[0].id));
  } else {
    await database.insert(tpsConfig).values({
      ...data,
      searchCost: data.searchCost || "0.3",
      detailCost: data.detailCost || "0.3",
    });
  }
}

// ==================== 搜索任务相关 ====================

/**
 * 创建搜索任务
 */
export async function createTpsSearchTask(data: {
  userId: number;
  mode: "nameOnly" | "nameLocation";
  names: string[];
  locations: string[];
  filters: any;
  maxPages: number;
}) {
  const database = await db();
  const taskId = crypto.randomBytes(16).toString("hex");
  
  const result = await database.insert(tpsSearchTasks).values({
    taskId,
    userId: data.userId,
    mode: data.mode,
    names: data.names,
    locations: data.locations,
    filters: data.filters,
    status: "pending",
    logs: [],
  });
  
  return {
    id: Number(result[0].insertId),
    taskId,
  };
}

/**
 * 获取搜索任务
 */
export async function getTpsSearchTask(taskId: string) {
  const database = await db();
  const tasks = await database
    .select()
    .from(tpsSearchTasks)
    .where(eq(tpsSearchTasks.taskId, taskId));
  
  return tasks[0];
}

/**
 * 更新搜索任务进度
 */
export async function updateTpsSearchTaskProgress(
  taskDbId: number,
  data: {
    status?: "pending" | "running" | "completed" | "failed" | "cancelled" | "insufficient_credits";
    totalSubTasks?: number;
    completedSubTasks?: number;
    progress?: number;
    totalResults?: number;
    searchPageRequests?: number;
    detailPageRequests?: number;
    cacheHits?: number;
    logs?: Array<{ timestamp: string; message: string }>;
  }
) {
  const database = await db();
  const updateData: any = {};
  
  if (data.status !== undefined) updateData.status = data.status;
  if (data.totalSubTasks !== undefined) updateData.totalSubTasks = data.totalSubTasks;
  if (data.completedSubTasks !== undefined) updateData.completedSubTasks = data.completedSubTasks;
  if (data.progress !== undefined) updateData.progress = data.progress;
  if (data.totalResults !== undefined) updateData.totalResults = data.totalResults;
  if (data.searchPageRequests !== undefined) updateData.searchPageRequests = data.searchPageRequests;
  if (data.detailPageRequests !== undefined) updateData.detailPageRequests = data.detailPageRequests;
  if (data.cacheHits !== undefined) updateData.cacheHits = data.cacheHits;
  if (data.logs !== undefined) updateData.logs = data.logs;
  
  if (data.status === "running" && !updateData.startedAt) {
    updateData.startedAt = new Date();
  }
  
  await database.update(tpsSearchTasks).set(updateData).where(eq(tpsSearchTasks.id, taskDbId));
}

/**
 * 完成搜索任务
 */
export async function completeTpsSearchTask(
  taskDbId: number,
  data: {
    totalResults: number;
    searchPageRequests: number;
    detailPageRequests: number;
    cacheHits: number;
    creditsUsed: number;
    logs: Array<{ timestamp: string; message: string }>;
  }
) {
  const database = await db();
  await database.update(tpsSearchTasks).set({
    status: "completed",
    progress: 100,
    totalResults: data.totalResults,
    searchPageRequests: data.searchPageRequests,
    detailPageRequests: data.detailPageRequests,
    cacheHits: data.cacheHits,
    creditsUsed: data.creditsUsed.toString(),
    logs: data.logs,
    completedAt: new Date(),
  }).where(eq(tpsSearchTasks.id, taskDbId));
}

/**
 * 标记任务失败
 */
export async function failTpsSearchTask(
  taskDbId: number,
  errorMessage: string,
  logs: Array<{ timestamp: string; message: string }>
) {
  const database = await db();
  await database.update(tpsSearchTasks).set({
    status: "failed",
    errorMessage,
    logs,
    completedAt: new Date(),
  }).where(eq(tpsSearchTasks.id, taskDbId));
}

/**
 * 获取用户搜索历史
 */
export async function getUserTpsSearchTasks(
  userId: number,
  page: number = 1,
  pageSize: number = 20
) {
  const database = await db();
  const offset = (page - 1) * pageSize;
  
  const [tasks, countResult] = await Promise.all([
    database
      .select()
      .from(tpsSearchTasks)
      .where(eq(tpsSearchTasks.userId, userId))
      .orderBy(desc(tpsSearchTasks.createdAt))
      .limit(pageSize)
      .offset(offset),
    database
      .select({ count: sql<number>`count(*)` })
      .from(tpsSearchTasks)
      .where(eq(tpsSearchTasks.userId, userId)),
  ]);
  
  return {
    data: tasks,
    total: countResult[0]?.count || 0,
  };
}

// ==================== 搜索结果相关 ====================

/**
 * 保存搜索结果
 * 
 * 类型已修复：与 scraper.ts 中的 TpsDetailResult 类型匹配
 * 所有字段都是可选的，避免运行时错误
 */
export async function saveTpsSearchResults(
  taskDbId: number,
  subTaskIndex: number,
  searchName: string,
  searchLocation: string,
  results: Array<{
    name: string;
    age?: number;           // 可选，与 scraper.ts 类型匹配
    city?: string;          // 可选
    state?: string;         // 可选
    location?: string;      // 可选
    phone?: string;         // 可选
    phoneType?: string;     // 可选
    carrier?: string;       // 可选
    reportYear?: number | null;
    isPrimary?: boolean;    // 可选
    propertyValue?: number; // 可选
    yearBuilt?: number | null;
    detailLink?: string;    // 可选，从 scraper.ts 传入
  }>
) {
  if (results.length === 0) return;
  
  const database = await db();
  const values = results.map(r => ({
    taskId: taskDbId,
    subTaskIndex,
    searchName,
    searchLocation,
    name: r.name || '',
    age: r.age ?? null,
    city: r.city || '',
    state: r.state || '',
    location: r.location || '',
    phone: r.phone || '',
    phoneType: r.phoneType || '',
    carrier: r.carrier || '',
    reportYear: r.reportYear ?? null,
    isPrimary: r.isPrimary ?? false,
    propertyValue: r.propertyValue ?? 0,
    yearBuilt: r.yearBuilt ?? null,
    detailLink: r.detailLink || '',
  }));
  
  await database.insert(tpsSearchResults).values(values);
}

/**
 * 获取搜索结果
 */
export async function getTpsSearchResults(
  taskDbId: number,
  page: number = 1,
  pageSize: number = 50
) {
  const database = await db();
  const offset = (page - 1) * pageSize;
  
  const [results, countResult] = await Promise.all([
    database
      .select()
      .from(tpsSearchResults)
      .where(eq(tpsSearchResults.taskId, taskDbId))
      .orderBy(desc(tpsSearchResults.id))
      .limit(pageSize)
      .offset(offset),
    database
      .select({ count: sql<number>`count(*)` })
      .from(tpsSearchResults)
      .where(eq(tpsSearchResults.taskId, taskDbId)),
  ]);
  
  return {
    data: results,
    total: countResult[0]?.count || 0,
  };
}

// ==================== 缓存相关 ====================

/**
 * 获取缓存的详情页数据
 */
export async function getCachedTpsDetails(links: string[]) {
  if (links.length === 0) return [];
  
  const database = await db();
  const now = new Date();
  
  const cached = await database
    .select()
    .from(tpsDetailCache)
    .where(
      and(
        inArray(tpsDetailCache.detailLink, links),
        gte(tpsDetailCache.expiresAt, now)
      )
    );
  
  return cached;
}

/**
 * 保存详情页缓存
 */
export async function saveTpsDetailCache(
  items: Array<{ link: string; data: any }>,
  cacheDays: number = 30
) {
  if (items.length === 0) return;
  
  const database = await db();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + cacheDays);
  
  // 使用 upsert 逻辑
  for (const item of items) {
    try {
      await database.insert(tpsDetailCache).values({
        detailLink: item.link,
        data: item.data,
        expiresAt,
      }).onDuplicateKeyUpdate({
        set: {
          data: item.data,
          expiresAt,
        },
      });
    } catch (error) {
      // 忽略重复键错误
      console.error("缓存保存失败:", error);
    }
  }
}

// ==================== 积分相关 ====================

/**
 * 获取用户积分
 */
export async function getUserCredits(userId: number): Promise<number> {
  const database = await db();
  const result = await database.select({ credits: users.credits }).from(users).where(eq(users.id, userId));
  return result[0]?.credits || 0;
}

/**
 * 扣除积分
 */
export async function deductCredits(userId: number, amount: number, description: string) {
  const database = await db();
  await database.update(users).set({
    credits: sql`${users.credits} - ${Math.ceil(amount * 10) / 10}`,
  }).where(eq(users.id, userId));
}

/**
 * 记录积分变动
 */
export async function logCreditChange(
  userId: number,
  amount: number,
  type: "search" | "recharge" | "admin_add" | "admin_deduct" | "refund",
  description: string,
  relatedTaskId?: string
) {
  const database = await db();
  const result = await database.select({ credits: users.credits }).from(users).where(eq(users.id, userId));
  
  await database.insert(creditLogs).values({
    userId,
    amount: Math.round(amount * 10) / 10,
    balanceAfter: result[0]?.credits || 0,
    type,
    description,
    relatedTaskId,
  });
}

/**
 * 记录 API 调用
 */
export async function logApi(data: {
  userId: number;
  apiType: "scrape_tps" | "scrape_fps" | "apollo_search" | "apollo_enrich" | "apify_search";
  endpoint: string;
  requestParams?: any;
  responseStatus: number;
  success: boolean;
  errorMessage?: string;
  creditsUsed?: number;
}) {
  const database = await db();
  await database.insert(apiLogs).values({
    userId: data.userId,
    apiType: data.apiType,
    endpoint: data.endpoint,
    requestParams: data.requestParams,
    responseStatus: data.responseStatus,
    success: data.success,
    errorMessage: data.errorMessage,
    creditsUsed: data.creditsUsed || 0,
  });
}
