/**
 * SearchPeopleFree (SPF) 数据库操作模块
 */

import { getDb, getConfig, updateApiStats } from "../db";
import { 
  spfConfig, 
  spfDetailCache, 
  spfSearchTasks, 
  spfSearchResults,
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
 * 获取 SPF 配置
 * 优先从 systemConfigs 表读取配置，实现与管理后台的联动
 */
export async function getSpfConfig() {
  const database = await db();
  
  // 尝试从 spf_config 表获取配置
  let config: any = null;
  try {
    const configs = await database.select().from(spfConfig).limit(1);
    config = configs[0];
  } catch (error) {
    console.error('获取 spf_config 表失败，使用默认配置:', error);
  }
  
  // 从 systemConfigs 表获取配置
  const [tokenFromSystemConfig, minAgeConfig, maxAgeConfig, searchCreditsConfig, detailCreditsConfig] = await Promise.all([
    getConfig('SPF_SCRAPE_TOKEN'),
    getConfig('SPF_MIN_AGE'),
    getConfig('SPF_MAX_AGE'),
    getConfig('SPF_SEARCH_CREDITS'),
    getConfig('SPF_DETAIL_CREDITS'),
  ]);
  
  // 解析年龄配置，默认 50-79 岁
  const defaultMinAge = minAgeConfig ? parseInt(minAgeConfig, 10) : 50;
  const defaultMaxAge = maxAgeConfig ? parseInt(maxAgeConfig, 10) : 79;
  
  // 解析积分配置 - 默认 0.85 积分/次 API 调用
  const searchCost = searchCreditsConfig || "0.85";
  const detailCost = detailCreditsConfig || "0.85";
  
  if (!config) {
    return {
      id: 0,
      searchCost,
      detailCost,
      maxConcurrent: 40,
      cacheDays: 180,
      scrapeDoToken: tokenFromSystemConfig || process.env.SPF_SCRAPE_DO_TOKEN || null,
      maxPages: 25,
      batchDelay: 200,
      enabled: true,
      defaultMinAge,
      defaultMaxAge,
    };
  }
  
  return {
    ...config,
    searchCost: searchCreditsConfig || config.searchCost,
    detailCost: detailCreditsConfig || config.detailCost,
    scrapeDoToken: config.scrapeDoToken || tokenFromSystemConfig || process.env.SPF_SCRAPE_DO_TOKEN || null,
    defaultMinAge: minAgeConfig ? defaultMinAge : (config.defaultMinAge || 50),
    defaultMaxAge: maxAgeConfig ? defaultMaxAge : (config.defaultMaxAge || 79),
  };
}

/**
 * 更新 SPF 配置
 */
export async function updateSpfConfig(data: {
  searchCost?: string;
  detailCost?: string;
  maxConcurrent?: number;
  cacheDays?: number;
  scrapeDoToken?: string;
  maxPages?: number;
  batchDelay?: number;
  enabled?: boolean;
  defaultMinAge?: number;
  defaultMaxAge?: number;
}) {
  const database = await db();
  const existing = await database.select().from(spfConfig).limit(1);
  
  if (existing[0]) {
    await database.update(spfConfig).set(data).where(eq(spfConfig.id, existing[0].id));
  } else {
    await database.insert(spfConfig).values({
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
export async function createSpfSearchTask(data: {
  userId: number;
  mode: "nameOnly" | "nameLocation";
  names: string[];
  locations: string[];
  filters: any;
  maxPages?: number;
}) {
  const database = await db();
  const taskId = crypto.randomBytes(16).toString("hex");
  
  const result = await database.insert(spfSearchTasks).values({
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
export async function getSpfSearchTask(taskId: string) {
  const database = await db();
  const tasks = await database
    .select()
    .from(spfSearchTasks)
    .where(eq(spfSearchTasks.taskId, taskId));
  
  return tasks[0];
}

/**
 * 通过数据库 ID 获取搜索任务
 */
export async function getSpfSearchTaskById(taskDbId: number) {
  const database = await db();
  const tasks = await database
    .select()
    .from(spfSearchTasks)
    .where(eq(spfSearchTasks.id, taskDbId));
  
  return tasks[0];
}

/**
 * 更新搜索任务进度
 */
export async function updateSpfSearchTaskProgress(
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
    creditsUsed?: number;
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
  if (data.creditsUsed !== undefined) updateData.creditsUsed = data.creditsUsed.toString();
  if (data.logs !== undefined) updateData.logs = data.logs.slice(-100); // 限制日志数量为 100 条
  
  if (data.status === "running" && !updateData.startedAt) {
    updateData.startedAt = new Date();
  }
  
  await database.update(spfSearchTasks).set(updateData).where(eq(spfSearchTasks.id, taskDbId));
}

/**
 * 完成搜索任务
 */
export async function completeSpfSearchTask(
  taskDbId: number,
  data: {
    totalResults: number;
    searchPageRequests: number;
    detailPageRequests: number;
    cacheHits: number;
    creditsUsed: number;
    logs: Array<{ timestamp: string; message: string }>;
    stoppedDueToCredits?: boolean;
    stoppedDueToApiExhausted?: boolean;
  }
) {
  const database = await db();
  // 限制日志数量为最近 100 条，避免超过数据库字段大小限制
  const truncatedLogs = data.logs.slice(-100);
  const finalStatus = data.stoppedDueToApiExhausted ? "service_busy" : (data.stoppedDueToCredits ? "insufficient_credits" : "completed");
  try {
    await database.update(spfSearchTasks).set({
      status: finalStatus,
      progress: 100,
      totalResults: data.totalResults,
      searchPageRequests: data.searchPageRequests,
      detailPageRequests: data.detailPageRequests,
      cacheHits: data.cacheHits,
      creditsUsed: data.creditsUsed.toString(),
      logs: truncatedLogs,
      completedAt: new Date(),
    }).where(eq(spfSearchTasks.id, taskDbId));
  } catch (dbError: any) {
    // ⭐ ENUM兼容性保护：fallback到"failed"
    console.error(`[SPF] 状态更新失败 (${finalStatus})，fallback到failed:`, dbError.message);
    await database.update(spfSearchTasks).set({
      status: 'failed',
      progress: 100,
      totalResults: data.totalResults,
      searchPageRequests: data.searchPageRequests,
      detailPageRequests: data.detailPageRequests,
      cacheHits: data.cacheHits,
      creditsUsed: data.creditsUsed.toString(),
      logs: truncatedLogs,
      completedAt: new Date(),
    }).where(eq(spfSearchTasks.id, taskDbId));
  }
}

/**
 * 标记任务失败
 */
export async function failSpfSearchTask(
  taskDbId: number,
  errorMessage: string,
  logs: Array<{ timestamp: string; message: string }>
) {
  const database = await db();
  // 限制日志数量为最近 100 条，避免超过数据库字段大小限制
  const truncatedLogs = logs.slice(-100);
  // 截断过长的错误消息
  const truncatedErrorMessage = errorMessage.length > 500 
    ? errorMessage.substring(0, 500) + '...' 
    : errorMessage;
  await database.update(spfSearchTasks).set({
    status: "failed",
    errorMessage: truncatedErrorMessage,
    logs: truncatedLogs,
    completedAt: new Date(),
  }).where(eq(spfSearchTasks.id, taskDbId));
}

/**
 * 获取用户搜索历史
 */
export async function getUserSpfSearchTasks(
  userId: number,
  page: number = 1,
  pageSize: number = 20
) {
  const database = await db();
  const offset = (page - 1) * pageSize;
  
  const [tasks, countResult] = await Promise.all([
    database
      .select()
      .from(spfSearchTasks)
      .where(eq(spfSearchTasks.userId, userId))
      .orderBy(desc(spfSearchTasks.createdAt))
      .limit(pageSize)
      .offset(offset),
    database
      .select({ count: sql<number>`count(*)` })
      .from(spfSearchTasks)
      .where(eq(spfSearchTasks.userId, userId)),
  ]);
  
  return {
    data: tasks,
    total: countResult[0]?.count || 0,
  };
}

// ==================== 搜索结果相关 ====================

/**
 * 保存搜索结果（包含 SPF 独特字段）
 */
// 安全截断字符串函数
function truncateString(str: string | undefined | null, maxLength: number): string {
  if (!str) return '';
  return str.length > maxLength ? str.substring(0, maxLength) : str;
}

export async function saveSpfSearchResults(
  taskDbId: number,
  subTaskIndex: number,
  searchName: string,
  searchLocation: string,
  results: Array<{
    name: string;
    firstName?: string;
    lastName?: string;
    age?: number;
    birthYear?: string;           // ★ 出生年份
    city?: string;
    state?: string;
    location?: string;
    phone?: string;
    phoneType?: string;           // ★ 电话类型
    phoneYear?: number;           // ★ 主电话年份
    carrier?: string;
    allPhones?: Array<{ number: string; type: string; year?: number; date?: string }>;
    reportYear?: number | null;
    isPrimary?: boolean;
    // ★ SPF 独特字段
    email?: string;
    allEmails?: string[];
    maritalStatus?: string;
    spouseName?: string;
    spouseLink?: string;
    employment?: string;
    confirmedDate?: string;
    latitude?: number;
    longitude?: number;
    // 其他字段
    familyMembers?: string[];
    associates?: string[];
    businesses?: string[];
    propertyValue?: number;
    yearBuilt?: number | null;
    isDeceased?: boolean;
    detailLink?: string;
    fromCache?: boolean;
  }>
) {
  if (results.length === 0) return;
  
  const database = await db();
  const values = results.map(r => ({
    taskId: taskDbId,
    subTaskIndex,
    searchName: truncateString(searchName, 200),
    searchLocation: truncateString(searchLocation, 200),
    name: truncateString(r.name, 200),
    firstName: truncateString(r.firstName, 100),
    lastName: truncateString(r.lastName, 100),
    age: r.age ?? null,
    birthYear: truncateString(r.birthYear, 20),
    city: truncateString(r.city, 100),
    state: truncateString(r.state, 50),
    location: truncateString(r.location, 200),
    phone: truncateString(r.phone, 50),
    phoneType: truncateString(r.phoneType, 50),
    phoneYear: r.phoneYear ?? null,
    carrier: truncateString(r.carrier, 100),
    allPhones: r.allPhones || [],
    reportYear: r.reportYear ?? null,
    isPrimary: r.isPrimary ?? false,
    // SPF 独特字段 - 按 schema 定义截断
    email: truncateString(r.email, 200),
    allEmails: r.allEmails || [],
    maritalStatus: truncateString(r.maritalStatus, 50),
    spouseName: truncateString(r.spouseName, 200),
    spouseLink: truncateString(r.spouseLink, 500),
    employment: truncateString(r.employment, 200),
    confirmedDate: truncateString(r.confirmedDate, 50),
    latitude: r.latitude?.toString() || null,
    longitude: r.longitude?.toString() || null,
    // 其他字段
    familyMembers: r.familyMembers || [],
    associates: r.associates || [],
    businesses: r.businesses || [],
    propertyValue: r.propertyValue ?? 0,
    yearBuilt: r.yearBuilt ?? null,
    isDeceased: r.isDeceased ?? false,
    detailLink: truncateString(r.detailLink, 500),
    fromCache: r.fromCache ?? false,
  }));
  
  await database.insert(spfSearchResults).values(values);
}

/**
 * 获取搜索结果
 */
export async function getSpfSearchResults(
  taskDbId: number,
  page: number = 1,
  pageSize: number = 50
) {
  const database = await db();
  const offset = (page - 1) * pageSize;
  
  const [results, countResult] = await Promise.all([
    database
      .select()
      .from(spfSearchResults)
      .where(eq(spfSearchResults.taskId, taskDbId))
      .orderBy(desc(spfSearchResults.id))
      .limit(pageSize)
      .offset(offset),
    database
      .select({ count: sql<number>`count(*)` })
      .from(spfSearchResults)
      .where(eq(spfSearchResults.taskId, taskDbId)),
  ]);
  
  return {
    data: results,
    total: countResult[0]?.count || 0,
  };
}

/**
 * 获取所有搜索结果（用于导出）
 */
export async function getAllSpfSearchResults(taskDbId: number) {
  console.log('[SPF DB] getAllSpfSearchResults called with taskDbId:', taskDbId);
  
  const database = await db();
  
  const results = await database
    .select()
    .from(spfSearchResults)
    .where(eq(spfSearchResults.taskId, taskDbId))
    .orderBy(spfSearchResults.id);
  
  console.log('[SPF DB] getAllSpfSearchResults returned', results.length, 'results');
  
  return results;
}

// ==================== 缓存相关 ====================

/**
 * 获取缓存的详情页数据
 */
export async function getCachedSpfDetails(links: string[]) {
  if (links.length === 0) return [];
  
  const database = await db();
  const now = new Date();
  
  const cached = await database
    .select()
    .from(spfDetailCache)
    .where(
      and(
        inArray(spfDetailCache.detailLink, links),
        gte(spfDetailCache.expiresAt, now)
      )
    );
  
  return cached;
}

/**
 * 保存详情页缓存
 */
export async function saveSpfDetailCache(
  items: Array<{ link: string; data: any }>,
  cacheDays: number = 180
) {
  if (items.length === 0) return;
  
  const database = await db();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + cacheDays);
  
  for (const item of items) {
    try {
      await database.insert(spfDetailCache).values({
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
      console.error(`[SPF] 保存缓存失败: ${item.link}`, error);
    }
  }
}

// ==================== 积分相关 ====================

/**
 * 预扣积分（冻结机制）
 * 
 * 参考 TPS 实现：
 * - 按最大预估消耗预扣积分
 * - 记录冻结日志
 * - 任务完成后结算退还
 */
export async function freezeSpfCredits(
  userId: number,
  estimatedCredits: number,
  taskId: string
): Promise<{ success: boolean; message: string; currentBalance: number; frozenAmount: number }> {
  const database = await db();
  
  // 获取当前余额
  const userResult = await database
    .select({ credits: users.credits })
    .from(users)
    .where(eq(users.id, userId));
  
  const currentBalance = userResult[0]?.credits || 0;
  
  // 四舍五入到一位小数
  const roundedEstimate = Math.round(estimatedCredits * 10) / 10;
  
  if (currentBalance < roundedEstimate) {
    return { 
      success: false, 
      message: `积分不足，需要 ${roundedEstimate} 积分，当前余额 ${currentBalance} 积分`,
      currentBalance,
      frozenAmount: 0,
    };
  }
  
  // 预扣积分（冻结）
  const newBalance = currentBalance - roundedEstimate;
  await database.update(users).set({
    credits: newBalance,
  }).where(eq(users.id, userId));
  
  // 记录冻结日志
  await database.insert(creditLogs).values({
    userId,
    amount: -roundedEstimate,
    balanceAfter: newBalance,
    type: "search",
    description: `SPF搜索预扣积分 [${taskId}]（最大预估 ${roundedEstimate} 积分，实际消耗后退还）`,
    relatedTaskId: taskId,
  });
  
  console.log(`[SPF] 预扣积分成功: 用户 ${userId}, 预扣 ${roundedEstimate}, 余额 ${newBalance}`);
  
  return { 
    success: true, 
    message: '预扣成功',
    currentBalance: newBalance,
    frozenAmount: roundedEstimate,
  };
}

/**
 * 结算积分（退还多扣的部分）
 * 
 * 参考 TPS 实现：
 * - 计算实际消耗
 * - 退还多扣的积分
 * - 记录结算日志
 */
export async function settleSpfCredits(
  userId: number,
  frozenAmount: number,
  actualCost: number,
  taskId: string
): Promise<{ refundAmount: number; newBalance: number }> {
  const database = await db();
  
  // 四舍五入到一位小数
  const roundedFrozen = Math.round(frozenAmount * 10) / 10;
  const roundedActual = Math.round(actualCost * 10) / 10;
  const refundAmount = Math.round((roundedFrozen - roundedActual) * 10) / 10;
  
  // 获取当前余额
  const userResult = await database
    .select({ credits: users.credits })
    .from(users)
    .where(eq(users.id, userId));
  
  let currentBalance = userResult[0]?.credits || 0;
  
  if (refundAmount > 0) {
    // 退还多扣的积分
    const newBalance = currentBalance + refundAmount;
    await database.update(users).set({
      credits: newBalance,
    }).where(eq(users.id, userId));
    
    // 记录退款日志
    await database.insert(creditLogs).values({
      userId,
      amount: refundAmount,
      balanceAfter: newBalance,
      type: "refund",
      description: `SPF搜索结算退款 [${taskId}] - 预扣 ${roundedFrozen}，实际 ${roundedActual}，退还 ${refundAmount}`,
      relatedTaskId: taskId,
    });
    
    console.log(`[SPF] 结算退款: 用户 ${userId}, 预扣 ${roundedFrozen}, 实际 ${roundedActual}, 退还 ${refundAmount}, 新余额 ${newBalance}`);
    
    return { refundAmount, newBalance };
  } else if (roundedActual > roundedFrozen) {
    // 极端情况：实际消耗超过预扣（理论上不应该发生）
    // 记录日志但不额外扣费，保护用户利益
    console.warn(`[SPF] 警告: 任务 ${taskId} 实际消耗 ${roundedActual} 超过预扣 ${roundedFrozen}`);
    
    await database.insert(creditLogs).values({
      userId,
      amount: 0,
      balanceAfter: currentBalance,
      type: "search",
      description: `SPF搜索结算 [${taskId}] - 实际消耗 ${roundedActual}（已预扣 ${roundedFrozen}）`,
      relatedTaskId: taskId,
    });
    
    return { refundAmount: 0, newBalance: currentBalance };
  }
  
  // 预扣等于实际消耗，无需退款
  console.log(`[SPF] 结算完成: 用户 ${userId}, 预扣 ${roundedFrozen}, 实际 ${roundedActual}, 无需退款`);
  return { refundAmount: 0, newBalance: currentBalance };
}

/**
 * 预扣积分（兼容旧接口）
 * @deprecated 请使用 freezeSpfCredits
 */
export async function preDeductSpfCredits(
  userId: number,
  estimatedCredits: number,
  taskId: string
): Promise<{ success: boolean; currentBalance: number }> {
  const result = await freezeSpfCredits(userId, estimatedCredits, taskId);
  return { success: result.success, currentBalance: result.currentBalance };
}

// ==================== API 日志相关 ====================

/**
 * 记录 API 调用日志
 */
export async function logApi(data: {
  userId?: number;
  apiType: "scrape_spf";
  endpoint: string;
  requestParams?: any;
  responseStatus: number;
  responseTime: number;
  success: boolean;
  errorMessage?: string;
  creditsUsed?: number;
}) {
  try {
    const database = await db();
    await database.insert(apiLogs).values({
      userId: data.userId,
      apiType: "scrape_tps", // 使用现有的枚举值
      endpoint: `spf:${data.endpoint}`,
      requestParams: data.requestParams,
      responseStatus: data.responseStatus,
      responseTime: data.responseTime,
      success: data.success,
      errorMessage: data.errorMessage,
      creditsUsed: data.creditsUsed || 0,
    });
    
    // 同时更新 API 统计
    await updateApiStats(
      `scrape_spf:${data.endpoint}`,
      data.success,
      data.responseTime,
      data.creditsUsed || 0
    );
  } catch (error) {
    console.error('[SPF] 记录 API 日志失败:', error);
  }
}
