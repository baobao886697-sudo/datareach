/**
 * TPS 详情获取执行器 v9.0 (流式保存+分批模式)
 * 
 * v9.0 重构 (内存安全):
 * - 🛡️ 核心改造：每批结果处理完成后立即通过回调保存到数据库，不再在内存中累积
 * - 内存占用从 O(N) 降为 O(batch_size)，无论任务多大都不会 OOM
 * - 函数返回统计数据而非结果数组，彻底消除内存泄漏风险
 * 
 * 基于 v8.0/v8.1:
 * - 保留分批 + 批间延迟的稳定模式
 * - 保留 Scrape.do API 积分耗尽检测
 * - 保留连续失败计数器兜底机制
 * - 保留前端 WebSocket 实时进度推送
 * 
 * 核心逻辑:
 * 1. 将所有待获取的详情链接按 BATCH_SIZE 分成多个批次
 * 2. 每个批次内使用 Promise.all 并行获取
 * 3. 每批完成后立即调用 onBatchSave 回调保存到数据库，然后释放内存
 * 4. 批次间强制等待 BATCH_DELAY_MS，给上游 API 恢复时间
 * 5. 所有批次完成后，对失败的链接进行一轮延后重试
 * 6. 检测到 API 积分耗尽时立即停止，不再重试
 * 
 * 独立模块: 仅用于 TPS 搜索功能
 */

import {
  TpsDetailResult,
  TpsSearchResult,
  TpsFilters,
  DetailTaskWithIndex,
  parseDetailPage,
  shouldIncludeResult,
  fetchWithScrapedo,
} from './scraper';
import { ScrapeApiCreditsError } from './scrapeClient';
import { TpsRealtimeCreditTracker } from './realtimeCredits';

// ============================================================================
// v8.0 分批配置
// ============================================================================

export const BATCH_CONFIG = {
  /** 每批并发获取的详情页数量 */
  BATCH_SIZE: 30,
  /** 批次间延迟（毫秒），给上游 API 恢复时间 */
  BATCH_DELAY_MS: 500,
  // v3.0: 已移除延后重试机制
  /** 连续失败阈值：连续 N 批全部失败时自动停止（兜底机制） */
  CONSECUTIVE_FAIL_THRESHOLD: 3,
};

// ============================================================================
// 类型定义
// ============================================================================

/** v9.0: 每批保存的回调参数 */
export interface BatchSaveItem {
  task: DetailTaskWithIndex;
  details: TpsDetailResult[];
}

/** v9.0: 流式保存回调类型 */
export type OnBatchSaveCallback = (items: BatchSaveItem[]) => Promise<number>;

/** v9.0: 返回统计数据而非结果数组 */
export interface SmartPoolFetchResult {
  stats: {
    /** 总保存结果数（由回调返回值累加） */
    totalSaved: number;
    detailPageRequests: number;
    filteredOut: number;
    stoppedDueToCredits: boolean;
    /** Scrape.do API 积分耗尽导致停止 */
    stoppedDueToApiCredits: boolean;
    /** BUG-08: 连续失败导致停止（独立标志） */
    stoppedDueToConsecutiveFails: boolean;
    /** v8.0: 批次统计 */
    totalBatches: number;
    failedRequests: number;
    retrySuccess: number;
    retryTotal: number;
    /** v9.1: 详情页502/5xx失败计数（仅用于后端日志统计） */
    detailPageFailed?: number;
  };
}

/**
 * v7.0 兼容: 详情进度回调类型
 * 
 * 保持与前端 WebSocket 推送格式完全兼容
 */
export interface DetailProgressInfo {
  completedDetails: number;
  totalDetails: number;
  percent: number;
  phase: 'fetching' | 'retrying';
  /** v8.2: 实时详情页请求数 */
  detailPageRequests: number;
  /** v8.2: 实时有效结果数 */
  totalResults: number;
}

// ============================================================================
// 核心执行函数: 流式保存+分批模式 (v9.0)
// ============================================================================

/**
 * 使用流式保存+分批模式获取详情 (v9.0)
 * 
 * 🛡️ 内存安全改造:
 * - 新增 onBatchSave 回调：每批处理完成后立即保存到数据库
 * - 不再返回 results 数组，改为返回统计数据
 * - 每批保存后释放该批结果的引用，让 GC 回收内存
 * 
 * 其他逻辑与 v8.0/v8.1 完全一致，保持稳定性。
 */
export async function fetchDetailsWithSmartPool(
  tasks: DetailTaskWithIndex[],
  token: string,
  filters: TpsFilters,
  onProgress: (message: string) => void,
  setCachedDetails: (items: Array<{ link: string; data: TpsDetailResult }>) => Promise<void>,
  creditTracker: TpsRealtimeCreditTracker,
  userId: number,
  onDetailProgress?: (info: DetailProgressInfo) => void,
  onBatchSave?: OnBatchSaveCallback,
  signal?: AbortSignal
): Promise<SmartPoolFetchResult> {
  let totalSaved = 0;
  let detailPageRequests = 0;
  let filteredOut = 0;
  let detailPageFailed = 0;  // v9.1: 详情页失败计数（仅用于后端日志）
  let stoppedDueToCredits = false;
  let stoppedDueToApiCredits = false;
  let stoppedDueToConsecutiveFails = false;  // BUG-08: 独立的连续失败标志
  
  const baseUrl = 'https://www.truepeoplesearch.com';
  
  // ==================== 准备阶段 ====================
  
  // 去重详情链接
  const uniqueLinks = Array.from(new Set(tasks.map(t => t.searchResult.detailLink)));
  const tasksByLink = new Map<string, DetailTaskWithIndex[]>();
  
  for (const task of tasks) {
    const link = task.searchResult.detailLink;
    if (!tasksByLink.has(link)) {
      tasksByLink.set(link, []);
    }
    tasksByLink.get(link)!.push(task);
  }
  
  onProgress(`🔗 去重后 ${uniqueLinks.length} 个唯一详情链接`);
  
  // 检查积分
  const affordCheck = await creditTracker.canAffordDetailBatch(uniqueLinks.length);
  let linksToFetch = uniqueLinks;
  
  if (!affordCheck.canAfford) {
    onProgress(`⚠️ 积分不足，无法获取详情`);
    stoppedDueToCredits = true;
    return { 
      stats: { 
        totalSaved, detailPageRequests, filteredOut, stoppedDueToCredits, stoppedDueToApiCredits,
        stoppedDueToConsecutiveFails,
        totalBatches: 0, failedRequests: 0, retrySuccess: 0, retryTotal: 0,
      } 
    };
  }
  
  if (affordCheck.affordableCount < uniqueLinks.length) {
    onProgress(`⚠️ 积分仅够获取 ${affordCheck.affordableCount}/${uniqueLinks.length} 条详情`);
    linksToFetch = uniqueLinks.slice(0, affordCheck.affordableCount);
    stoppedDueToCredits = true;
  }
  
  // ==================== 分批获取阶段 ====================
  
  const totalDetails = linksToFetch.length;
  let completedDetails = 0;
  // v3.0: 不再收集失败链接，失败直接跳过
  let consecutiveFailBatches = 0;  // 连续全部失败的批次计数
  
  const totalBatches = Math.ceil(totalDetails / BATCH_CONFIG.BATCH_SIZE);
  
  onProgress(`📤 开始分批获取 ${totalDetails} 条详情 (${totalBatches} 批, 每批 ${BATCH_CONFIG.BATCH_SIZE} 个, 间隔 ${BATCH_CONFIG.BATCH_DELAY_MS}ms)`);
  console.log(`[TPS v9.0] 流式保存模式: ${totalDetails} 条详情, ${totalBatches} 批, 每批 ${BATCH_CONFIG.BATCH_SIZE} 个`);
  
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    // 检查超时终止信号
    if (signal?.aborted) {
      onProgress(`任务已结束，已获取的结果已保存`);
      break;
    }
    if (stoppedDueToCredits || stoppedDueToApiCredits) break;
    
    const batchStart = batchIndex * BATCH_CONFIG.BATCH_SIZE;
    const batchLinks = linksToFetch.slice(batchStart, batchStart + BATCH_CONFIG.BATCH_SIZE);
    const batchNum = batchIndex + 1;
    
    // 批内并行获取（携带错误类型信息）
    const batchPromises = batchLinks.map(async (link) => {
      const detailUrl = link.startsWith('http') ? link : `${baseUrl}${link}`;
      try {
        const html = await fetchWithScrapedo(detailUrl, token);
        return { link, html, success: true as const, error: '', isApiCreditsError: false };
      } catch (error: any) {
        const isApiCreditsError = error instanceof ScrapeApiCreditsError;
        // v9.1: 记录详情页失败到后端日志（不推送给用户）
        if (!isApiCreditsError) {
          console.error(`[TPS 502-Monitor] 详情页失败: link="${link}", batch=${batchNum}/${totalBatches}, error=${error.message || error}`);
        }
        return { link, html: '', success: false as const, error: error.message || String(error), isApiCreditsError };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    // 检查本批是否有 API 积分耗尽错误
    const apiCreditsErrors = batchResults.filter(r => r.isApiCreditsError);
    if (apiCreditsErrors.length > 0) {
      stoppedDueToApiCredits = true;
      onProgress(`🚫 当前使用人数过多，服务繁忙，请联系客服处理`);
      onProgress(`💡 已获取的结果已保存，如需继续请联系客服`);
      console.error(`[TPS v9.0] Scrape.do API 积分耗尽，停止详情获取`);
    }
    
    // 🛡️ v9.0: 本批的结果临时收集，处理完立即保存并释放
    const batchSaveItems: BatchSaveItem[] = [];
    const batchCacheItems: Array<{ link: string; data: TpsDetailResult }> = [];
    
    // 处理批次结果
    let batchSuccess = 0;
    let batchFail = 0;
    
    for (let ri = 0; ri < batchResults.length; ri++) {
      const result = batchResults[ri];
      if (stoppedDueToCredits) break;
      
      // v3.0: 每次API调用都扣费，无论成功失败
      detailPageRequests++;
      const deductResult = await creditTracker.deductDetailPage();
      if (!deductResult.success) {
        stoppedDueToCredits = true;
        onProgress(`⚠️ 积分不足，停止获取详情（当前批次结果已保存）`);
        break;
      }
      
      if (result.success) {
        batchSuccess++;
        
        // 解析详情页
        const linkTasks = tasksByLink.get(result.link) || [];
        if (linkTasks.length > 0) {
          const details = parseDetailPage(result.html, linkTasks[0].searchResult);
          
          // ⭐ 内存优化：解析完成后立即释放HTML内存
          (batchResults[ri] as any).html = '';
          
          // 收集缓存
          for (const detail of details) {
            if (detail.phone && detail.phone.length >= 10) {
              batchCacheItems.push({ link: result.link, data: detail });
            }
          }
          
          // 过滤结果
          const detailsWithFlag = details.map(d => ({ ...d, fromCache: false }));
          const filtered = detailsWithFlag.filter(r => shouldIncludeResult(r, filters));
          filteredOut += details.length - filtered.length;
          
          // 🛡️ v9.0: 收集到本批临时数组
          for (const task of linkTasks) {
            batchSaveItems.push({ task, details: filtered });
          }
        } else {
          // ⭐ 内存优化：即使没有匹配的任务，也释放HTML
          (batchResults[ri] as any).html = '';
        }
      } else {
        batchFail++;
        detailPageFailed++;  // v9.1: 详情页失败计数
        // v3.0: 失败也已扣费，直接跳过
      }
      
      // 更新进度（每个请求完成后都触发）
      completedDetails++;
      if (onDetailProgress) {
        onDetailProgress({
          completedDetails,
          totalDetails,
          percent: Math.round((completedDetails / totalDetails) * 100),
          phase: 'fetching',
          detailPageRequests,
          totalResults: totalSaved + batchSaveItems.reduce((sum, item) => sum + item.details.length, 0),
        });
      }
    }
    
    // 🛡️ v9.0: 本批处理完成，立即保存到数据库并释放内存
    if (batchSaveItems.length > 0 && onBatchSave) {
      try {
        const savedCount = await onBatchSave(batchSaveItems);
        totalSaved += savedCount;
      } catch (saveError: any) {
        console.error(`[TPS v9.0] 批次 ${batchNum} 保存失败:`, saveError.message);
        // 保存失败不中断任务，继续处理下一批
      }
    } else if (batchSaveItems.length > 0 && !onBatchSave) {
      // 兼容模式：如果没有提供回调，直接计数（不应该发生）
      totalSaved += batchSaveItems.reduce((sum, item) => sum + item.details.length, 0);
    }
    
    // 保存缓存（每批保存，避免累积）
    if (batchCacheItems.length > 0) {
      try {
        await setCachedDetails(batchCacheItems);
      } catch (cacheError: any) {
        console.error(`[TPS v9.0] 批次 ${batchNum} 缓存保存失败:`, cacheError.message);
      }
    }
    
    // 🛡️ v9.0: 本批数据已保存，batchSaveItems 和 batchCacheItems 在此作用域结束后自动被 GC 回收
    
    // 连续失败批次检测（兜底机制）
    if (batchSuccess === 0 && batchFail > 0) {
      consecutiveFailBatches++;
      if (consecutiveFailBatches >= BATCH_CONFIG.CONSECUTIVE_FAIL_THRESHOLD && !stoppedDueToApiCredits) {
        onProgress(`🚫 当前使用人数过多，服务繁忙，请联系客服处理`);
        onProgress(`💡 已获取的结果已保存，如需继续请联系客服`);
        console.error(`[TPS v9.0] 连续 ${consecutiveFailBatches} 批全部失败，自动停止`);
        // BUG-08修复：使用独立标志，不再复用 stoppedDueToApiCredits
        stoppedDueToConsecutiveFails = true;
        stoppedDueToApiCredits = true;  // 保持向后兼容，仍用于停止控制流
      }
    } else {
      consecutiveFailBatches = 0;  // 有成功的就重置计数
    }
    
    // 批次日志（每5批或最后一批输出）
    if (batchNum % 5 === 0 || batchNum === totalBatches) {
      const overallPercent = Math.round((completedDetails / totalDetails) * 100);
      onProgress(`📥 批次 ${batchNum}/${totalBatches} 完成, 总进度 ${completedDetails}/${totalDetails} (${overallPercent}%)`);
    }
    
    // 批间延迟（最后一批不需要延迟）
    if (batchIndex < totalBatches - 1 && !stoppedDueToCredits && !stoppedDueToApiCredits) {
      await new Promise(resolve => setTimeout(resolve, BATCH_CONFIG.BATCH_DELAY_MS));
    }
  }
  
  // v3.0: 已移除延后重试阶段，失败的链接直接跳过
  const retrySuccess = 0;
  const retryTotal = 0;
  
  // ==================== 统计信息 ====================
  
  onProgress(`════════ 详情获取完成 ════════`);
  onProgress(`📊 详情页请求: ${detailPageRequests} 页`);
  onProgress(`📊 有效结果: ${totalSaved} 条（已实时保存到数据库）`);
  onProgress(`📊 过滤排除: ${filteredOut} 条`);
  onProgress(`📊 批次模式: ${totalBatches} 批 × ${BATCH_CONFIG.BATCH_SIZE} 并发, 间隔 ${BATCH_CONFIG.BATCH_DELAY_MS}ms`);
  // v3.0: 不再有延后重试
  if (stoppedDueToApiCredits) {
    onProgress(`🚫 服务繁忙，任务提前结束`);
  }
  
  // v9.1: 详情阶段502统计汇总（仅后端日志，不推送给用户）
  if (detailPageFailed > 0) {
    console.error(`[TPS 502-Monitor] 详情阶段汇总: 总请求=${detailPageRequests}, 失败=${detailPageFailed}, 失败率=${(detailPageFailed / detailPageRequests * 100).toFixed(1)}%, 丢失详情数据=${detailPageFailed}条`);
  } else {
    console.log(`[TPS 502-Monitor] 详情阶段汇总: 总请求=${detailPageRequests}, 失败=0, 全部成功`);
  }
  
  return {
    stats: {
      totalSaved,
      detailPageRequests,
      filteredOut,
      stoppedDueToCredits,
      stoppedDueToApiCredits,
      stoppedDueToConsecutiveFails,
      totalBatches,
      failedRequests: retryTotal - retrySuccess,
      retrySuccess,
      retryTotal,
      detailPageFailed,
    },
  };
}
