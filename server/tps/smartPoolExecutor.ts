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
  /** 延后重试前等待时间（毫秒） */
  RETRY_DELAY_MS: 4000,
  /** 延后重试的批次大小（更保守） */
  RETRY_BATCH_SIZE: 8,
  /** 延后重试的批间延迟（更保守） */
  RETRY_BATCH_DELAY_MS: 800,
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
  onBatchSave?: OnBatchSaveCallback
): Promise<SmartPoolFetchResult> {
  let totalSaved = 0;
  let detailPageRequests = 0;
  let filteredOut = 0;
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
  const failedLinks: string[] = [];  // 收集失败的链接用于延后重试
  let consecutiveFailBatches = 0;  // 连续全部失败的批次计数
  
  const totalBatches = Math.ceil(totalDetails / BATCH_CONFIG.BATCH_SIZE);
  
  onProgress(`📤 开始分批获取 ${totalDetails} 条详情 (${totalBatches} 批, 每批 ${BATCH_CONFIG.BATCH_SIZE} 个, 间隔 ${BATCH_CONFIG.BATCH_DELAY_MS}ms)`);
  console.log(`[TPS v9.0] 流式保存模式: ${totalDetails} 条详情, ${totalBatches} 批, 每批 ${BATCH_CONFIG.BATCH_SIZE} 个`);
  
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
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
      
      if (result.success) {
        batchSuccess++;
        detailPageRequests++;
        
        // BUG-18修复：先解析结果，再扣积分。即使扣积分失败也保存当前结果
        // （因为HTTP请求已消耗Scrape.do API积分，不应浪费）
        
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
          
          // 🛡️ v9.0: 收集到本批临时数组，而非全局 results 数组
          for (const task of linkTasks) {
            batchSaveItems.push({ task, details: filtered });
          }
        } else {
          // ⭐ 内存优化：即使没有匹配的任务，也释放HTML
          (batchResults[ri] as any).html = '';
        }
        
        // 实时扣除积分（移到解析之后，确保当前结果已被收集）
        const deductResult = await creditTracker.deductDetailPage();
        if (!deductResult.success) {
          stoppedDueToCredits = true;
          onProgress(`⚠️ 积分不足，停止获取详情（当前批次结果已保存）`);
          break;
        }
      } else {
        batchFail++;
        // API 积分耗尽的链接不加入重试队列
        if (!result.isApiCreditsError) {
          failedLinks.push(result.link);
        }
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
        onProgress(`🚫 连续 ${consecutiveFailBatches} 批请求全部失败，自动停止（可能是 API 服务异常）`);
        onProgress(`💡 请稍后重试或联系客服处理`);
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
      onProgress(`📥 批次 ${batchNum}/${totalBatches} 完成 (成功${batchSuccess}/失败${batchFail}), 总进度 ${completedDetails}/${totalDetails} (${overallPercent}%)`);
    }
    
    // 批间延迟（最后一批不需要延迟）
    if (batchIndex < totalBatches - 1 && !stoppedDueToCredits && !stoppedDueToApiCredits) {
      await new Promise(resolve => setTimeout(resolve, BATCH_CONFIG.BATCH_DELAY_MS));
    }
  }
  
  // ==================== 延后重试阶段 ====================
  
  let retrySuccess = 0;
  const retryTotal = failedLinks.length;
  
  // API 积分耗尽时跳过重试
  if (failedLinks.length > 0 && !stoppedDueToCredits && !stoppedDueToApiCredits) {
    onProgress(`🔄 开始延后重试 ${failedLinks.length} 个失败链接 (等待 ${BATCH_CONFIG.RETRY_DELAY_MS}ms)...`);
    console.log(`[TPS v9.0] 延后重试: ${failedLinks.length} 个失败链接`);
    
    // 等待一段时间，给上游服务恢复
    await new Promise(resolve => setTimeout(resolve, BATCH_CONFIG.RETRY_DELAY_MS));
    
    // 分批重试（使用更保守的参数）
    const retryBatches = Math.ceil(failedLinks.length / BATCH_CONFIG.RETRY_BATCH_SIZE);
    
    for (let ri = 0; ri < retryBatches; ri++) {
      if (stoppedDueToCredits || stoppedDueToApiCredits) break;
      
      const retryBatchStart = ri * BATCH_CONFIG.RETRY_BATCH_SIZE;
      const retryBatchLinks = failedLinks.slice(retryBatchStart, retryBatchStart + BATCH_CONFIG.RETRY_BATCH_SIZE);
      
      const retryPromises = retryBatchLinks.map(async (link) => {
        const detailUrl = link.startsWith('http') ? link : `${baseUrl}${link}`;
        try {
          const html = await fetchWithScrapedo(detailUrl, token);
          return { link, html, success: true as const, isApiCreditsError: false };
        } catch (error: any) {
          const isApiCreditsError = error instanceof ScrapeApiCreditsError;
          return { link, html: '', success: false as const, isApiCreditsError };
        }
      });
      
      const retryResults = await Promise.all(retryPromises);
      
      // 检查重试中是否有 API 积分耗尽
      if (retryResults.some(r => r.isApiCreditsError)) {
        stoppedDueToApiCredits = true;
        onProgress(`🚫 服务暂时不可用，停止重试`);
        break;
      }
      
      // 🛡️ v9.0: 重试结果也立即保存
      const retrySaveItems: BatchSaveItem[] = [];
      const retryCacheItems: Array<{ link: string; data: TpsDetailResult }> = [];
      
      for (let rri = 0; rri < retryResults.length; rri++) {
        const result = retryResults[rri];
        if (stoppedDueToCredits) break;
        
        if (result.success) {
          retrySuccess++;
          detailPageRequests++;
          
          const deductResult = await creditTracker.deductDetailPage();
          if (!deductResult.success) {
            stoppedDueToCredits = true;
            break;
          }
          
          const linkTasks = tasksByLink.get(result.link) || [];
          if (linkTasks.length > 0) {
            const details = parseDetailPage(result.html, linkTasks[0].searchResult);
            
            // BUG-06修复：重试阶段也释放HTML内存
            (retryResults[rri] as any).html = '';
            
            for (const detail of details) {
              if (detail.phone && detail.phone.length >= 10) {
                retryCacheItems.push({ link: result.link, data: detail });
              }
            }
            
            const detailsWithFlag = details.map(d => ({ ...d, fromCache: false }));
            const filtered = detailsWithFlag.filter(r => shouldIncludeResult(r, filters));
            filteredOut += details.length - filtered.length;
            
            for (const task of linkTasks) {
              retrySaveItems.push({ task, details: filtered });
            }
          } else {
            // BUG-06修复：即使没有匹配任务也释放HTML
            (retryResults[rri] as any).html = '';
          }
        }
        
        // 重试阶段也推送进度
        if (onDetailProgress) {
          onDetailProgress({
            completedDetails: completedDetails,  // 保持总数不变，重试不增加总数
            totalDetails,
            percent: Math.round((completedDetails / totalDetails) * 100),
            phase: 'retrying',
            detailPageRequests,
            totalResults: totalSaved + retrySaveItems.reduce((sum, item) => sum + item.details.length, 0),
          });
        }
      }
      
      // 🛡️ v9.0: 重试批次也立即保存
      if (retrySaveItems.length > 0 && onBatchSave) {
        try {
          const savedCount = await onBatchSave(retrySaveItems);
          totalSaved += savedCount;
        } catch (saveError: any) {
          console.error(`[TPS v9.0] 重试批次保存失败:`, saveError.message);
        }
      }
      
      if (retryCacheItems.length > 0) {
        try {
          await setCachedDetails(retryCacheItems);
        } catch (cacheError: any) {
          console.error(`[TPS v9.0] 重试缓存保存失败:`, cacheError.message);
        }
      }
      
      // 重试批间延迟
      if (ri < retryBatches - 1 && !stoppedDueToCredits && !stoppedDueToApiCredits) {
        await new Promise(resolve => setTimeout(resolve, BATCH_CONFIG.RETRY_BATCH_DELAY_MS));
      }
    }
    
    onProgress(`🔄 延后重试完成: ${retrySuccess}/${failedLinks.length} 成功`);
  } else if (failedLinks.length > 0 && stoppedDueToApiCredits) {
    onProgress(`⏭️ 跳过 ${failedLinks.length} 个失败链接的重试（服务暂时不可用）`);
  }
  
  // ==================== 统计信息 ====================
  
  onProgress(`════════ 详情获取完成 ════════`);
  onProgress(`📊 详情页请求: ${detailPageRequests} 页`);
  onProgress(`📊 有效结果: ${totalSaved} 条（已实时保存到数据库）`);
  onProgress(`📊 过滤排除: ${filteredOut} 条`);
  onProgress(`📊 批次模式: ${totalBatches} 批 × ${BATCH_CONFIG.BATCH_SIZE} 并发, 间隔 ${BATCH_CONFIG.BATCH_DELAY_MS}ms`);
  if (retryTotal > 0) {
    onProgress(`🔄 延后重试: ${retrySuccess}/${retryTotal} 成功`);
  }
  if (stoppedDueToApiCredits) {
    onProgress(`🚫 服务繁忙，任务提前结束`);
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
    },
  };
}
