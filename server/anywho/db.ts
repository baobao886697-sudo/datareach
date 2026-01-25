/**
 * Anywho 数据库操作
 * 独立模块，方便后期管理和修改
 */

import { getDb, getConfig } from "../db";
import { 
  anywhoConfig, 
  anywhoDetailCache, 
  anywhoSearchTasks, 
  anywhoSearchResults,
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
 * 获取 Anywho 配置
 */
export async function getAnywhoConfig() {
  const database = await db();
  
  // 尝试从 anywho_config 表获取配置
  let config: any = null;
  try {
    const configs = await database.select().from(anywhoConfig).limit(1);
    config = configs[0];
  } catch (error) {
    console.error('获取 anywho_config 表失败，使用默认配置:', error);
  }
  
  // 从 systemConfigs 表获取配置
  const [tokenFromSystemConfig, minAgeConfig, maxAgeConfig, searchCreditsConfig, detailCreditsConfig] = await Promise.all([
    getConfig('ANYWHO_SCRAPE_TOKEN'),
    getConfig('ANYWHO_MIN_AGE'),
    getConfig('ANYWHO_MAX_AGE'),
    getConfig('ANYWHO_SEARCH_CREDITS'),
    getConfig('ANYWHO_DETAIL_CREDITS'),
  ]);
  
  const defaultMinAge = minAgeConfig ? parseInt(minAgeConfig, 10) : 18;
  const defaultMaxAge = maxAgeConfig ? parseInt(maxAgeConfig, 10) : 99;
  const searchCost = searchCreditsConfig || "0.5";
  const detailCost = detailCreditsConfig || "0.5";
  
  if (!config) {
    return {
      id: 0,
      searchCost,
      detailCost,
      maxConcurrent: 20,
      cacheDays: 180,
      scrapeDoToken: tokenFromSystemConfig || process.env.ANYWHO_SCRAPE_DO_TOKEN || null,
      maxPages: 10,
      batchDelay: 300,
      enabled: true,
      defaultMinAge,
      defaultMaxAge,
    };
  }
  
  return {
    ...config,
    searchCost: searchCreditsConfig || config.searchCost,
    detailCost: detailCreditsConfig || config.detailCost,
    scrapeDoToken: config.scrapeDoToken || tokenFromSystemConfig || process.env.ANYWHO_SCRAPE_DO_TOKEN || null,
    defaultMinAge: minAgeConfig ? defaultMinAge : (config.defaultMinAge || 18),
    defaultMaxAge: maxAgeConfig ? defaultMaxAge : (config.defaultMaxAge || 99),
  };
}

/**
 * 更新 Anywho 配置
 */
export async function updateAnywhoConfig(data: {
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
  const existing = await database.select().from(anywhoConfig).limit(1);
  
  if (existing[0]) {
    await database.update(anywhoConfig).set(data).where(eq(anywhoConfig.id, existing[0].id));
  } else {
    await database.insert(anywhoConfig).values({
      ...data,
      searchCost: data.searchCost || "0.5",
      detailCost: data.detailCost || "0.5",
    });
  }
}

// ==================== 搜索任务相关 ====================

/**
 * 创建搜索任务
 */
export async function createAnywhoSearchTask(data: {
  userId: number;
  mode: "nameOnly" | "nameLocation";
  names: string[];
  locations: string[];
  filters: any;
  maxPages: number;
}) {
  const database = await db();
  const taskId = crypto.randomBytes(16).toString("hex");
  
  const result = await database.insert(anywhoSearchTasks).values({
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
 * 更新任务进度
 */
export async function updateAnywhoSearchTaskProgress(taskId: string, data: {
  status?: "pending" | "running" | "completed" | "failed" | "cancelled" | "insufficient_credits";
  progress?: number;
  totalSubTasks?: number;
  completedSubTasks?: number;
  totalResults?: number;
  searchPageRequests?: number;
  detailPageRequests?: number;
  cacheHits?: number;
  creditsUsed?: string;
  logs?: Array<{ timestamp: string; message: string }>;
}) {
  const database = await db();
  
  const updateData: any = { ...data };
  if (data.status === "running" && !updateData.startedAt) {
    updateData.startedAt = new Date();
  }
  
  await database.update(anywhoSearchTasks)
    .set(updateData)
    .where(eq(anywhoSearchTasks.taskId, taskId));
}

/**
 * 完成任务
 */
export async function completeAnywhoSearchTask(taskId: string, data: {
  totalResults: number;
  creditsUsed: string;
  searchPageRequests: number;
  detailPageRequests: number;
  cacheHits: number;
}) {
  const database = await db();
  
  await database.update(anywhoSearchTasks)
    .set({
      status: "completed",
      progress: 100,
      totalResults: data.totalResults,
      creditsUsed: data.creditsUsed,
      searchPageRequests: data.searchPageRequests,
      detailPageRequests: data.detailPageRequests,
      cacheHits: data.cacheHits,
      completedAt: new Date(),
    })
    .where(eq(anywhoSearchTasks.taskId, taskId));
}

/**
 * 任务失败
 */
export async function failAnywhoSearchTask(taskId: string, errorMessage: string) {
  const database = await db();
  
  await database.update(anywhoSearchTasks)
    .set({
      status: "failed",
      errorMessage,
      completedAt: new Date(),
    })
    .where(eq(anywhoSearchTasks.taskId, taskId));
}

/**
 * 保存搜索结果
 */
export async function saveAnywhoSearchResults(taskId: number, results: Array<{
  subTaskIndex: number;
  name: string;
  firstName?: string;
  lastName?: string;
  searchName: string;
  searchLocation?: string;
  age?: number | null;
  city?: string;
  state?: string;
  location?: string;
  currentAddress?: string;
  phone?: string;
  phoneType?: string;
  carrier?: string;
  allPhones?: string[];
  reportYear?: number | null;
  isPrimary?: boolean;
  marriageStatus?: string | null;
  marriageRecords?: string[];
  familyMembers?: string[];
  emails?: string[];
  isDeceased?: boolean;
  detailLink?: string;
  fromCache?: boolean;
}>) {
  if (results.length === 0) return;
  
  const database = await db();
  
  await database.insert(anywhoSearchResults).values(
    results.map(r => ({
      taskId,
      subTaskIndex: r.subTaskIndex,
      name: r.name,
      firstName: r.firstName,
      lastName: r.lastName,
      searchName: r.searchName,
      searchLocation: r.searchLocation,
      age: r.age,
      city: r.city,
      state: r.state,
      location: r.location,
      currentAddress: r.currentAddress,
      phone: r.phone,
      phoneType: r.phoneType,
      carrier: r.carrier,
      allPhones: r.allPhones || [],
      reportYear: r.reportYear,
      isPrimary: r.isPrimary ?? true,
      marriageStatus: r.marriageStatus,
      marriageRecords: r.marriageRecords || [],
      familyMembers: r.familyMembers || [],
      emails: r.emails || [],
      isDeceased: r.isDeceased || false,
      detailLink: r.detailLink,
      fromCache: r.fromCache || false,
    }))
  );
}

/**
 * 获取任务详情
 */
export async function getAnywhoSearchTask(taskId: string) {
  const database = await db();
  
  const tasks = await database.select()
    .from(anywhoSearchTasks)
    .where(eq(anywhoSearchTasks.taskId, taskId))
    .limit(1);
  
  return tasks[0] || null;
}

/**
 * 获取用户的搜索任务列表
 */
export async function getUserAnywhoSearchTasks(userId: number, page: number = 1, pageSize: number = 20) {
  const database = await db();
  
  const offset = (page - 1) * pageSize;
  
  const [tasks, countResult] = await Promise.all([
    database.select()
      .from(anywhoSearchTasks)
      .where(eq(anywhoSearchTasks.userId, userId))
      .orderBy(desc(anywhoSearchTasks.createdAt))
      .limit(pageSize)
      .offset(offset),
    database.select({ count: sql<number>`count(*)` })
      .from(anywhoSearchTasks)
      .where(eq(anywhoSearchTasks.userId, userId)),
  ]);
  
  return {
    tasks,
    total: countResult[0]?.count || 0,
    page,
    pageSize,
  };
}

/**
 * 获取任务的搜索结果
 */
export async function getAnywhoSearchResults(taskId: number, page: number = 1, pageSize: number = 50) {
  const database = await db();
  
  const offset = (page - 1) * pageSize;
  
  const [results, countResult] = await Promise.all([
    database.select()
      .from(anywhoSearchResults)
      .where(eq(anywhoSearchResults.taskId, taskId))
      .limit(pageSize)
      .offset(offset),
    database.select({ count: sql<number>`count(*)` })
      .from(anywhoSearchResults)
      .where(eq(anywhoSearchResults.taskId, taskId)),
  ]);
  
  return {
    results,
    total: countResult[0]?.count || 0,
    page,
    pageSize,
  };
}

// ==================== 缓存相关 ====================

/**
 * 获取缓存的详情
 */
export async function getCachedAnywhoDetails(detailLinks: string[]) {
  if (detailLinks.length === 0) return [];
  
  const database = await db();
  
  const cached = await database.select()
    .from(anywhoDetailCache)
    .where(
      and(
        inArray(anywhoDetailCache.detailLink, detailLinks),
        gte(anywhoDetailCache.expiresAt, new Date())
      )
    );
  
  return cached;
}

/**
 * 保存详情缓存
 */
export async function saveAnywhoDetailCache(details: Array<{
  detailLink: string;
  data: any;
  cacheDays?: number;
}>) {
  if (details.length === 0) return;
  
  const database = await db();
  const config = await getAnywhoConfig();
  const cacheDays = config.cacheDays || 180;
  
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + cacheDays);
  
  for (const detail of details) {
    try {
      await database.insert(anywhoDetailCache).values({
        detailLink: detail.detailLink,
        data: detail.data,
        expiresAt,
      });
    } catch (error: any) {
      // 忽略重复键错误
      if (!error.message?.includes('Duplicate')) {
        console.error('保存缓存失败:', error);
      }
    }
  }
}

// ==================== 积分相关 ====================

/**
 * 扣除用户积分
 */
export async function deductCredits(userId: number, amount: number) {
  const database = await db();
  
  await database.update(users)
    .set({
      credits: sql`credits - ${Math.ceil(amount)}`,
    })
    .where(eq(users.id, userId));
}

/**
 * 获取用户积分
 */
export async function getUserCredits(userId: number): Promise<number> {
  const database = await db();
  
  const result = await database.select({ credits: users.credits })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  
  return result[0]?.credits || 0;
}

/**
 * 记录积分变动
 */
export async function logCreditChange(data: {
  userId: number;
  amount: number;
  type: "search" | "recharge" | "refund" | "admin" | "tps_search" | "anywho_search";
  description: string;
  relatedId?: string;
}) {
  const database = await db();
  
  await database.insert(creditLogs).values({
    ...data,
    createdAt: new Date(),
  });
}

/**
 * 记录 API 调用日志
 */
export async function logApi(data: {
  userId: number;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTime: number;
  errorMessage?: string;
}) {
  const database = await db();
  
  await database.insert(apiLogs).values({
    ...data,
    createdAt: new Date(),
  });
}
