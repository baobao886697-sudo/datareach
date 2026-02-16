/**
 * TPS 详情获取执行器 v8.0 (分批+延迟模式)
 * 
 * v8.0 重构:
 * - 完全废弃 TpsSmartConcurrencyPool（虚拟线程+动态并发）
 * - 借鉴 EXE 版本的 fetchBatch 模式：分批 + 批间延迟
 * - 简单、可预测、稳定，根治详情阶段 502 错误
 * 
 * v8.1 增强:
 * - 识别 Scrape.do API 积分耗尽 (HTTP 401/403)，立即停止所有请求
 * - 连续失败计数器：连续 N 个请求全部失败时自动停止（兜底机制）
 * - 优化错误日志：API 积分耗尽只输出一次提示，不刷屏
 * 
 * 核心逻辑:
 * 1. 将所有待获取的详情链接按 BATCH_SIZE 分成多个批次
 * 2. 每个批次内使用 Promise.all 并行获取
 * 3. 批次间强制等待 BATCH_DELAY_MS，给上游 API 恢复时间
 * 4. 所有批次完成后，对失败的链接进行一轮延后重试
 * 5. 检测到 API 积分耗尽时立即停止，不再重试
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
  RETRY_DELAY_MS: 3000,
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

export interface SmartPoolFetchResult {
  results: Array<{ task: DetailTaskWithIndex; details: TpsDetailResult[] }>;
  stats: {
    detailPageRequests: number;
    filteredOut: number;
    stoppedDueToCredits: boolean;
    /** Scrape.do API 积分耗尽导致停止 */
    stoppedDueToApiCredits: boolean;
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
}

// ============================================================================
// 核心执行函数: 分批+延迟模式
// ============================================================================

/**
 * 使用分批+延迟模式获取详情 (v8.0)
 * 
 * 借鉴 EXE 版本的 fetchBatch 函数，彻底替代旧的 TpsSmartConcurrencyPool。
 * 
 * 关键设计:
 * - 每批 BATCH_SIZE 个请求并行执行
 * - 批次间强制等待 BATCH_DELAY_MS
 * - 单个请求失败不影响同批次其他请求
 * - 所有批次完成后统一进行延后重试
 * - onDetailProgress 回调在每个请求完成后触发，保持前端实时更新
 * - 检测到 Scrape.do API 积分耗尽 (401/403) 时立即停止
 * - 连续 N 批全部失败时自动停止（兜底机制）
 */
export async function fetchDetailsWithSmartPool(
  tasks: DetailTaskWithIndex[],
  token: string,
  filters: TpsFilters,
  onProgress: (message: string) => void,
  setCachedDetails: (items: Array<{ link: string; data: TpsDetailResult }>) => Promise<void>,
  creditTracker: TpsRealtimeCreditTracker,
  userId: number,
  onDetailProgress?: (info: DetailProgressInfo) => void
): Promise<SmartPoolFetchResult> {
  const results: Array<{ task: DetailTaskWithIndex; details: TpsDetailResult[] }> = [];
  let detailPageRequests = 0;
  let filteredOut = 0;
  let stoppedDueToCredits = false;
  let stoppedDueToApiCredits = false;
  
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
      results, 
      stats: { 
        detailPageRequests, filteredOut, stoppedDueToCredits, stoppedDueToApiCredits,
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
  const cacheToSave: Array<{ link: string; data: TpsDetailResult }> = [];
  let consecutiveFailBatches = 0;  // 连续全部失败的批次计数
  
  const totalBatches = Math.ceil(totalDetails / BATCH_CONFIG.BATCH_SIZE);
  
  onProgress(`📤 开始分批获取 ${totalDetails} 条详情 (${totalBatches} 批, 每批 ${BATCH_CONFIG.BATCH_SIZE} 个, 间隔 ${BATCH_CONFIG.BATCH_DELAY_MS}ms)`);
  console.log(`[TPS v8.0] 分批模式: ${totalDetails} 条详情, ${totalBatches} 批, 每批 ${BATCH_CONFIG.BATCH_SIZE} 个`);
  
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
      console.error(`[TPS v8.0] Scrape.do API 积分耗尽，停止详情获取`);
      // 不再处理本批结果中的失败项，只处理成功的
    }
    
    // 处理批次结果
    let batchSuccess = 0;
    let batchFail = 0;
    
    for (const result of batchResults) {
      if (stoppedDueToCredits) break;
      
      if (result.success) {
        batchSuccess++;
        detailPageRequests++;
        
        // 实时扣除积分
        const deductResult = await creditTracker.deductDetailPage();
        if (!deductResult.success) {
          stoppedDueToCredits = true;
          onProgress(`⚠️ 积分不足，停止获取详情`);
          break;
        }
        
        // 解析详情页
        const linkTasks = tasksByLink.get(result.link) || [];
        if (linkTasks.length > 0) {
          const details = parseDetailPage(result.html, linkTasks[0].searchResult);
          
          // 保存缓存
          for (const detail of details) {
            if (detail.phone && detail.phone.length >= 10) {
              cacheToSave.push({ link: result.link, data: detail });
            }
          }
          
          // 过滤结果
          const detailsWithFlag = details.map(d => ({ ...d, fromCache: false }));
          const filtered = detailsWithFlag.filter(r => shouldIncludeResult(r, filters));
          filteredOut += details.length - filtered.length;
          
          // 关联到所有相同链接的任务
          for (const task of linkTasks) {
            results.push({ task, details: filtered });
          }
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
        });
      }
    }
    
    // 连续失败批次检测（兜底机制）
    if (batchSuccess === 0 && batchFail > 0) {
      consecutiveFailBatches++;
      if (consecutiveFailBatches >= BATCH_CONFIG.CONSECUTIVE_FAIL_THRESHOLD && !stoppedDueToApiCredits) {
        onProgress(`🚫 连续 ${consecutiveFailBatches} 批请求全部失败，自动停止（可能是 API 服务异常）`);
        onProgress(`💡 请稍后重试或联系客服处理`);
        console.error(`[TPS v8.0] 连续 ${consecutiveFailBatches} 批全部失败，自动停止`);
        stoppedDueToApiCredits = true;  // 复用此标志表示外部API问题
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
    console.log(`[TPS v8.0] 延后重试: ${failedLinks.length} 个失败链接`);
    
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
      
      for (const result of retryResults) {
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
            
            for (const detail of details) {
              if (detail.phone && detail.phone.length >= 10) {
                cacheToSave.push({ link: result.link, data: detail });
              }
            }
            
            const detailsWithFlag = details.map(d => ({ ...d, fromCache: false }));
            const filtered = detailsWithFlag.filter(r => shouldIncludeResult(r, filters));
            filteredOut += details.length - filtered.length;
            
            for (const task of linkTasks) {
              results.push({ task, details: filtered });
            }
          }
        }
        
        // 重试阶段也推送进度
        if (onDetailProgress) {
          onDetailProgress({
            completedDetails: completedDetails,  // 保持总数不变，重试不增加总数
            totalDetails,
            percent: Math.round((completedDetails / totalDetails) * 100),
            phase: 'retrying',
          });
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
  
  // ==================== 保存缓存 ====================
  
  if (cacheToSave.length > 0) {
    onProgress(`💾 保存缓存: ${cacheToSave.length} 条...`);
    await setCachedDetails(cacheToSave);
  }
  
  // ==================== 统计信息 ====================
  
  onProgress(`════════ 详情获取完成 ════════`);
  onProgress(`📊 详情页请求: ${detailPageRequests} 页`);
  onProgress(`📊 有效结果: ${results.length} 条`);
  onProgress(`📊 过滤排除: ${filteredOut} 条`);
  onProgress(`📊 批次模式: ${totalBatches} 批 × ${BATCH_CONFIG.BATCH_SIZE} 并发, 间隔 ${BATCH_CONFIG.BATCH_DELAY_MS}ms`);
  if (retryTotal > 0) {
    onProgress(`🔄 延后重试: ${retrySuccess}/${retryTotal} 成功`);
  }
  if (stoppedDueToApiCredits) {
    onProgress(`🚫 服务繁忙，任务提前结束`);
  }
  
  return {
    results,
    stats: {
      detailPageRequests,
      filteredOut,
      stoppedDueToCredits,
      stoppedDueToApiCredits,
      totalBatches,
      failedRequests: retryTotal - retrySuccess,
      retrySuccess,
      retryTotal,
    },
  };
}
