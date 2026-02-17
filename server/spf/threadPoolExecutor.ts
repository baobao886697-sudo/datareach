/**
 * SPF 线程池执行器 v2.0
 * 
 * 重构版本：
 * 1. 实时积分扣除 - 用多少扣多少，扣完即停
 * 2. 移除缓存读取 - 每次都请求最新数据
 * 3. 保留数据保存 - 用于历史任务 CSV 导出
 * 4. 简化费用明细 - 专业、简洁、透明
 * 5. 优雅停止机制 - 积分不足时返回已获取结果
 */

import { getThreadPool, initThreadPool, THREAD_POOL_CONFIG } from './threadPool';
import { 
  SPF_CONFIG, 
  SPF_SEARCH_CONFIG,
  isThreadPoolEnabled,
} from './config';
import {
  SpfDetailResult,
  SpfFilters,
  DetailTask,
} from './scraper';
import {
  RealtimeCreditTracker,
  createRealtimeCreditTracker,
  formatCostBreakdown,
} from './realtimeCredits';

// ==================== 类型定义 ====================

export interface ThreadPoolSearchInput {
  names: string[];
  locations?: string[];
  mode: 'nameOnly' | 'nameLocation';
  filters?: SpfFilters;
}

export interface ThreadPoolSearchResult {
  success: boolean;
  results: SpfDetailResult[];
  stats: {
    totalSearchPages: number;
    totalDetailPages: number;
    totalResults: number;
    totalFilteredOut: number;
    totalSkippedDeceased: number;
  };
  error?: string;
}

// ==================== 线程池执行器 ====================

/**
 * 使用线程池执行 SPF 搜索 (v2.0 - 实时扣除版)
 * 
 * 核心改动：
 * 1. 移除预扣费机制，改为实时扣除
 * 2. 移除缓存读取，每次都请求最新数据
 * 3. 保留数据保存，用于 CSV 导出
 * 4. 积分不足时优雅停止，返回已获取结果
 */
export async function executeSpfSearchWithThreadPool(
  taskDbId: number,
  taskId: string,
  config: any,
  input: ThreadPoolSearchInput,
  userId: number,
  _frozenAmount: number, // 不再使用，保留参数兼容性
  addLog: (message: string) => void,
  _getCachedDetails: (links: string[]) => Promise<any[]>, // 不再使用
  setCachedDetails: (items: Array<{ link: string; data: SpfDetailResult }>) => Promise<void>,
  updateProgress: (data: any) => Promise<void>,
  completeTask: (data: any) => Promise<void>,
  failTask: (error: string, logs: string[]) => Promise<void>,
  _settleCredits: (userId: number, frozenAmount: number, actualCost: number, taskId: string) => Promise<any>, // 不再使用
  logApi: (data: any) => Promise<void>,
  logUserActivity: (data: any) => Promise<void>,
  saveResults: (taskDbId: number, subTaskIndex: number, name: string, location: string, results: SpfDetailResult[]) => Promise<void>
): Promise<void> {
  const logs: string[] = [];
  const token = config.scrapeDoToken;
  const searchCost = parseFloat(config.searchCost);
  const detailCost = parseFloat(config.detailCost);
  const maxPages = SPF_SEARCH_CONFIG.MAX_SAFE_PAGES;
  
  // 构建子任务列表
  const subTasks: Array<{ name: string; location: string; index: number }> = [];
  
  if (input.mode === 'nameOnly') {
    for (let i = 0; i < input.names.length; i++) {
      subTasks.push({ name: input.names[i], location: '', index: i });
    }
  } else {
    const locations = input.locations || [''];
    let index = 0;
    for (const name of input.names) {
      for (const location of locations) {
        subTasks.push({ name, location, index });
        index++;
      }
    }
  }
  
  // 日志辅助函数
  const logMessage = (msg: string) => {
    logs.push(msg);
    addLog(msg);
  };
  
  // ==================== 初始化实时积分跟踪器 ====================
  const creditTracker = await createRealtimeCreditTracker(userId, taskId, searchCost, detailCost);
  const initialBalance = creditTracker.getCurrentBalance();
  
  // 记录任务信息（简洁专业版）
  logMessage(`🚀 SPF 搜索任务启动`);
  logMessage(`📋 搜索组合: ${subTasks.length} 个任务`);
  
  // 显示过滤条件
  const filters = input.filters || {};
  logMessage(`📋 过滤条件: 年龄 ${filters.minAge || 50}-${filters.maxAge || 79} 岁`);
  
  // 更新任务状态
  await updateProgress({
    status: 'running',
    totalSubTasks: subTasks.length,
    logs,
  });
  
  // 统计
  let totalSearchPages = 0;
  let totalDetailPages = 0;
  let totalResults = 0;
  let totalFilteredOut = 0;
  let totalSkippedDeceased = 0;
  let stoppedDueToCredits = false;
  
  // 用于跨任务电话号码去重
  const seenPhones = new Set<string>();
  
  try {
    // 初始化线程池
    const pool = await initThreadPool();
    
    // ==================== 阶段一：逐个搜索（实时扣费） ====================
    
    // 收集所有详情任务
    const allDetailTasks: DetailTask[] = [];
    const subTaskResults: Map<number, { searchResults: SpfDetailResult[]; searchPages: number }> = new Map();
    
    for (const subTask of subTasks) {
      // 检查积分是否足够
      if (!await creditTracker.canAffordSearchPage()) {
        logMessage(`⚠️ 积分不足，停止搜索`);
        stoppedDueToCredits = true;
        break;
      }
      
      // 构建搜索任务
      const searchTask = {
        name: subTask.name,
        location: subTask.location,
        token,
        maxPages,
        filters: input.filters || {},
        subTaskIndex: subTask.index,
      };
      
      // 提交搜索任务
      const searchResults = await pool.submitSearchTasks([searchTask]);
      const result = searchResults[0];
      
      if (result.success && result.data) {
        const { searchResults: results, subTaskIndex } = result.data;
        const stats = result.stats || {};
        const pagesUsed = stats.searchPageRequests || 1;
        
        // 实时扣除搜索页费用
        for (let i = 0; i < pagesUsed; i++) {
          const deductResult = await creditTracker.deductSearchPage();
          if (!deductResult.success) {
            logMessage(`⚠️ 积分不足，停止搜索`);
            stoppedDueToCredits = true;
            break;
          }
        }
        
        if (stoppedDueToCredits) break;
        
        totalSearchPages += pagesUsed;
        totalFilteredOut += stats.filteredOut || 0;
        totalSkippedDeceased += stats.skippedDeceased || 0;
        
        // 保存搜索结果
        subTaskResults.set(subTaskIndex, {
          searchResults: results,
          searchPages: pagesUsed,
        });
        
        // 收集详情任务
        for (const searchResult of results) {
          if (searchResult.detailLink) {
            allDetailTasks.push({
              detailLink: searchResult.detailLink,
              searchName: subTask.name,
              searchLocation: subTask.location,
              searchResult,
              subTaskIndex,
            });
          }
        }
        
        const taskName = subTask.location ? `${subTask.name} @ ${subTask.location}` : subTask.name;
        logMessage(`✅ [${subTask.index + 1}/${subTasks.length}] ${taskName} - ${results.length} 条, ${pagesUsed} 页`);
      } else {
        const safeError = (result.error || '').includes('Scrape.do') ? '服务繁忙，请稍后重试' : (result.error || 'Unknown error');
        logMessage(`❌ 搜索失败: ${safeError}`);
      }
    }
    
    // 更新进度
    await updateProgress({
      completedSubTasks: subTasks.length,
      progress: 30,
      searchPageRequests: totalSearchPages,
      logs,
    });
    
    // 搜索完成，静默处理
    
    // ==================== 阶段二：获取详情（实时扣费，无缓存读取） ====================
    if (allDetailTasks.length > 0 && !stoppedDueToCredits) {
      // 阶段二：详情获取
      
      // 去重详情链接
      const uniqueLinks = Array.from(new Set(allDetailTasks.map(t => t.detailLink)));
      const tasksByLink = new Map<string, DetailTask[]>();
      
      for (const task of allDetailTasks) {
        const link = task.detailLink;
        if (!tasksByLink.has(link)) {
          tasksByLink.set(link, []);
        }
        tasksByLink.get(link)!.push(task);
      }
      
      // 唯一详情链接数量，静默处理
      
      // 检查可以负担多少条详情
      const affordCheck = await creditTracker.canAffordDetailBatch(uniqueLinks.length);
      let linksToFetch = uniqueLinks;
      
      if (!affordCheck.canAfford) {
        logMessage(`⚠️ 积分不足，无法获取详情`);
        stoppedDueToCredits = true;
      } else if (affordCheck.affordableCount < uniqueLinks.length) {
        logMessage(`⚠️ 积分仅够获取 ${affordCheck.affordableCount}/${uniqueLinks.length} 条详情`);
        linksToFetch = uniqueLinks.slice(0, affordCheck.affordableCount);
        stoppedDueToCredits = true;
      }
      
      // 构建详情任务
      const tasksToFetch: Array<{
        detailLink: string;
        token: string;
        filters: any;
        subTaskIndex: number;
        searchName: string;
        searchLocation: string;
      }> = [];
      
      for (const link of linksToFetch) {
        const linkTasks = tasksByLink.get(link);
        if (linkTasks && linkTasks.length > 0) {
          const firstTask = linkTasks[0];
          tasksToFetch.push({
            detailLink: link,
            token,
            filters: input.filters || {},
            subTaskIndex: firstTask.subTaskIndex,
            searchName: firstTask.searchName,
            searchLocation: firstTask.searchLocation,
          });
        }
      }
      
      // 提交详情任务到线程池
      const cacheToSave: Array<{ link: string; data: SpfDetailResult }> = [];
      const fetchedResults: Array<{ task: DetailTask; details: SpfDetailResult }> = [];
      
      if (tasksToFetch.length > 0) {
        // 获取详情，静默处理
        
        const detailResults = await pool.submitDetailTasks(tasksToFetch);
        
        // 处理详情结果
        for (const result of detailResults) {
          if (result.success && result.data) {
            const { details, subTaskIndex } = result.data;
            const stats = result.stats || {};
            const pagesUsed = stats.detailPageRequests || 1;
            
            // 实时扣除详情页费用
            for (let i = 0; i < pagesUsed; i++) {
              const deductResult = await creditTracker.deductDetailPage();
              if (!deductResult.success) {
                logMessage(`⚠️ 积分不足，停止获取详情`);
                stoppedDueToCredits = true;
                break;
              }
            }
            
            totalDetailPages += pagesUsed;
            
            if (details) {
              // 保存到缓存（用于 CSV 导出）
              if (details.phone && details.phone.length >= 10) {
                cacheToSave.push({ link: details.detailLink!, data: details });
              }
              
              // 关联到所有使用此链接的任务
              const linkTasks = tasksByLink.get(details.detailLink!) || [];
              for (const task of linkTasks) {
                fetchedResults.push({ task, details });
              }
            }
          } else {
            totalDetailPages += result.stats?.detailPageRequests || 0;
            if (result.stats?.filteredOut) {
              totalFilteredOut += result.stats.filteredOut;
            }
          }
          
          if (stoppedDueToCredits) break;
        }
      }
      
      // 按子任务分组保存结果
      const resultsBySubTask = new Map<number, SpfDetailResult[]>();
      
      for (const { task, details } of fetchedResults) {
        if (!details) continue;
        
        if (!resultsBySubTask.has(task.subTaskIndex)) {
          resultsBySubTask.set(task.subTaskIndex, []);
        }
        
        // 跨任务电话号码去重
        if (details.phone && seenPhones.has(details.phone)) {
          continue;
        }
        if (details.phone) {
          seenPhones.add(details.phone);
        }
        
        // 添加搜索信息
        const resultWithSearchInfo = {
          ...details,
          searchName: task.searchName,
          searchLocation: task.searchLocation,
        };
        
        resultsBySubTask.get(task.subTaskIndex)!.push(resultWithSearchInfo);
      }
      
      // 保存结果到数据库
      for (const [subTaskIndex, results] of Array.from(resultsBySubTask.entries())) {
        const subTask = subTasks.find(t => t.index === subTaskIndex);
        if (subTask && results.length > 0) {
          await saveResults(taskDbId, subTaskIndex, subTask.name, subTask.location, results);
          totalResults += results.length;
        }
      }
      
      // 保存数据到缓存表（用于 CSV 导出，不用于读取）
      if (cacheToSave.length > 0) {
        await setCachedDetails(cacheToSave);
      }
      
      // 详情完成，静默处理
    }
    
    // 更新最终进度
    await updateProgress({
      progress: 100,
      totalResults,
      searchPageRequests: totalSearchPages,
      detailPageRequests: totalDetailPages,
      logs,
    });
    
    // ==================== 任务完成日志（简洁专业版） ====================
    const breakdown = creditTracker.getCostBreakdown();
    const currentBalance = creditTracker.getCurrentBalance();
    
    if (stoppedDueToCredits) {
      logMessage(`⚠️ 任务因积分不足提前结束`);
    } else {
      logMessage(`✅ 任务完成`);
    }
    logMessage(`📊 结果: ${totalResults} 条 | 消耗: ${breakdown.totalCost.toFixed(1)} 积分 | 余额: ${currentBalance.toFixed(1)} 积分`);
    
    // 记录 API 日志
    await logApi({
      userId,
      apiType: 'scrape_spf',
      endpoint: 'fullSearch',
      requestParams: { names: input.names.length, mode: input.mode },
      responseStatus: 200,
      responseTime: 0,
      success: true,
      creditsUsed: breakdown.totalCost,
    });
    
    await completeTask({
      totalResults,
      searchPageRequests: totalSearchPages,
      detailPageRequests: totalDetailPages,
      creditsUsed: breakdown.totalCost,
      logs,
      stoppedDueToCredits,
    });
    
    // 记录用户活动日志
    await logUserActivity({
      userId,
      action: 'SPF搜索',
      details: `搜索完成: ${input.names.length}个姓名, ${totalResults}条结果, 消耗${breakdown.totalCost.toFixed(1)}积分${stoppedDueToCredits ? ' (积分不足提前结束)' : ''}`,
      ipAddress: undefined,
      userAgent: undefined,
    });
    
  } catch (error: any) {
    const safeMsg = (error.message || '').includes('Scrape.do') ? '服务繁忙，请稍后重试' : error.message;
    logMessage(`❌ 任务失败: ${safeMsg}`);
    
    // 获取已消耗的费用
    const breakdown = creditTracker.getCostBreakdown();
    
    await failTask(safeMsg, logs);
    
    await logApi({
      userId,
      apiType: 'scrape_spf',
      endpoint: 'fullSearch',
      requestParams: { names: input.names.length, mode: input.mode },
      responseStatus: 500,
      responseTime: 0,
      success: false,
      errorMessage: error.message,
      creditsUsed: breakdown.totalCost,
    });
  }
}

/**
 * 检查是否应该使用线程池模式
 */
export function shouldUseThreadPool(): boolean {
  return isThreadPoolEnabled();
}
