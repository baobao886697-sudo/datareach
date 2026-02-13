/**
 * LinkedIn 搜索模块 - 数据库操作
 * 
 * 统一管理所有LinkedIn搜索相关的数据库操作
 */

import { getDb } from '../db';
import { 
  users, 
  searchTasks, SearchTask,
  searchResults, SearchResult,
  creditLogs,
  globalCache
} from '../../drizzle/schema';
import { eq, desc, sql, and, gte } from 'drizzle-orm';
import crypto from 'crypto';

// ============ 积分操作 ============

/**
 * 预扣积分（冻结）- LinkedIn搜索
 * 
 * 在任务开始前预扣最大预估费用，确保任务能够完整执行
 */
export async function freezeCredits(
  userId: number, 
  amount: number, 
  taskId: string
): Promise<{ success: boolean; frozenAmount: number; currentBalance: number; message: string }> {
  const db = await getDb();
  if (!db) return { success: false, frozenAmount: 0, currentBalance: 0, message: '数据库连接失败' };
  
  // 获取用户信息
  const userResult = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userResult.length > 0 ? userResult[0] : undefined;
  if (!user) return { success: false, frozenAmount: 0, currentBalance: 0, message: '用户不存在' };
  
  const roundedAmount = Math.ceil(amount * 10) / 10;
  
  // 检查余额是否足够
  const userCredits = parseFloat(String(user.credits)) || 0;
  if (userCredits < roundedAmount) {
    return {
      success: false,
      frozenAmount: 0,
      currentBalance: userCredits,
      message: `积分不足，需要 ${roundedAmount} 积分，当前余额 ${userCredits} 积分`,
    };
  }
  
  // 预扣积分
  const newBalance = userCredits - roundedAmount;
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
export async function settleCredits(
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
  
  // 获取用户信息
  const userResult = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userResult.length > 0 ? userResult[0] : undefined;
  if (!user) return { refundAmount: 0, actualCost: roundedActualCost, newBalance: 0 };
  
  let currentBalance = parseFloat(String(user.credits)) || 0;
  
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

/**
 * 获取用户积分
 */
export async function getUserCredits(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ credits: users.credits }).from(users).where(eq(users.id, userId)).limit(1);
  return result.length > 0 ? parseFloat(String(result[0].credits)) || 0 : 0;
}

// ============ 搜索任务操作 ============

/**
 * 创建搜索任务
 */
export async function createSearchTask(
  userId: number, 
  searchHash: string, 
  params: any, 
  requestedCount: number
): Promise<SearchTask | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const taskId = crypto.randomBytes(8).toString('hex');
  await db.insert(searchTasks).values({ 
    taskId, 
    userId, 
    searchHash, 
    params, 
    requestedCount, 
    logs: [] 
  });
  return getSearchTask(taskId);
}

/**
 * 获取搜索任务
 */
export async function getSearchTask(taskId: string): Promise<SearchTask | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(searchTasks).where(eq(searchTasks.taskId, taskId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * 更新搜索任务
 */
export async function updateSearchTask(taskId: string, updates: Partial<SearchTask>): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error('[LinkedIn/DB] updateSearchTask: Database not available');
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
      console.error(`[LinkedIn/DB] updateSearchTask attempt ${attempt}/${maxRetries} failed:`, error.message);
      
      // 如果失败，尝试只更新非 logs 字段
      if (attempt === 2) {
        console.warn('[LinkedIn/DB] Retrying without logs field...');
        const { logs, ...updatesWithoutLogs } = processedUpdates;
        try {
          if (Object.keys(updatesWithoutLogs).length > 0) {
            await db.update(searchTasks).set(updatesWithoutLogs as any).where(eq(searchTasks.taskId, taskId));
            console.log('[LinkedIn/DB] Update succeeded without logs field');
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
  
  console.error('[LinkedIn/DB] updateSearchTask failed after all retries:', lastError?.message);
}

/**
 * 更新搜索任务状态
 */
export async function updateSearchTaskStatus(
  taskId: string, 
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'insufficient_credits'
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(searchTasks).set({ status }).where(eq(searchTasks.taskId, taskId));
}

/**
 * 获取用户的搜索任务列表
 */
export async function getUserSearchTasks(
  userId: number, 
  page: number = 1, 
  limit: number = 20
): Promise<{ tasks: SearchTask[]; total: number }> {
  const db = await getDb();
  if (!db) return { tasks: [], total: 0 };
  const offset = (page - 1) * limit;
  const result = await db.select().from(searchTasks)
    .where(eq(searchTasks.userId, userId))
    .orderBy(desc(searchTasks.createdAt))
    .limit(limit)
    .offset(offset);
  const countResult = await db.select({ count: sql<number>`count(*)` }).from(searchTasks)
    .where(eq(searchTasks.userId, userId));
  return { tasks: result, total: countResult[0]?.count || 0 };
}

// ============ 搜索结果操作 ============

/**
 * 保存搜索结果
 */
export async function saveSearchResult(
  taskId: number, 
  apolloId: string, 
  data: any, 
  verified: boolean = false, 
  verificationScore?: number, 
  verificationDetails?: any
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.insert(searchResults).values({ 
      taskId, 
      apolloId, 
      data, 
      verified, 
      verificationScore, 
      verificationDetails 
    });
    return true;
  } catch (error) {
    console.error('[LinkedIn/DB] saveSearchResult error:', error);
    return false;
  }
}

/**
 * 更新搜索结果
 */
export async function updateSearchResult(
  id: number, 
  updates: Partial<SearchResult>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(searchResults).set(updates as any).where(eq(searchResults.id, id));
}

/**
 * 获取搜索结果
 */
export async function getSearchResults(taskId: number): Promise<SearchResult[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(searchResults)
    .where(eq(searchResults.taskId, taskId))
    .orderBy(desc(searchResults.createdAt));
}

/**
 * 通过任务ID获取搜索结果
 */
export async function getSearchResultsByTaskId(taskId: string): Promise<SearchResult[]> {
  const db = await getDb();
  if (!db) return [];
  
  // 先获取任务
  const task = await getSearchTask(taskId);
  if (!task) return [];
  
  return getSearchResults(task.id);
}

// ============ 缓存操作 ============

/**
 * 获取缓存
 */
export async function getCacheByKey(key: string): Promise<any | null> {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(globalCache)
    .where(and(
      eq(globalCache.cacheKey, key),
      gte(globalCache.expiresAt, new Date())
    ))
    .limit(1);
  
  if (result.length === 0) return null;
  
  return result[0].data;
}

/**
 * 设置缓存
 * 
 * 使用健壮的错误处理，确保缓存失败不会导致任务中断
 */
export async function setCache(
  key: string, 
  value: any, 
  cacheType: 'search' | 'person' | 'verification' = 'search',
  expiryDays: number = 180
): Promise<boolean> {
  const db = await getDb();
  if (!db) {
    console.warn('[LinkedIn/DB] setCache: Database not available');
    return false;
  }
  
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiryDays);
  
  // 使用 upsert 逻辑，带重试机制
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 先尝试插入
      await db.insert(globalCache).values({
        cacheKey: key,
        cacheType,
        data: value,
        expiresAt,
      });
      return true;
    } catch (error: any) {
      // 如果是重复键错误，尝试更新
      if (error.code === 'ER_DUP_ENTRY') {
        try {
          await db.update(globalCache)
            .set({ data: value, expiresAt, hitCount: sql`hitCount + 1` })
            .where(eq(globalCache.cacheKey, key));
          return true;
        } catch (updateError: any) {
          console.warn(`[LinkedIn/DB] setCache update failed (attempt ${attempt}/${maxRetries}):`, updateError.message);
        }
      } else {
        // 其他错误，记录日志但不抛出异常
        console.warn(`[LinkedIn/DB] setCache insert failed (attempt ${attempt}/${maxRetries}):`, error.message);
      }
      
      // 重试前等待
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 100 * attempt));
      }
    }
  }
  
  // 所有重试都失败，但不抛出异常，只返回 false
  console.error(`[LinkedIn/DB] setCache failed after ${maxRetries} attempts for key: ${key.substring(0, 50)}...`);
  return false;
}
