/**
 * SPF 线程池执行器
 * 
 * 将线程池模式集成到现有 SPF 搜索流程
 * 
 * 功能：
 * 1. 提供与现有 executeSpfSearchUnifiedQueue 兼容的接口
 * 2. 使用线程池执行搜索和详情获取任务
 * 3. 支持缓存机制
 * 4. 支持进度回调和日志记录
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
    totalCacheHits: number;
    totalResults: number;
    totalFilteredOut: number;
    totalSkippedDeceased: number;
  };
  error?: string;
}

// ==================== 线程池执行器 ====================

/**
 * 使用线程池执行 SPF 搜索
 * 
 * 这是线程池模式的主入口函数，替代原有的 executeSpfSearchUnifiedQueue
 */
export async function executeSpfSearchWithThreadPool(
  taskDbId: number,
  taskId: string,
  config: any,
  input: ThreadPoolSearchInput,
  userId: number,
  frozenAmount: number,
  addLog: (message: string) => void,
  getCachedDetails: (links: string[]) => Promise<any[]>,
  setCachedDetails: (items: Array<{ link: string; data: SpfDetailResult }>) => Promise<void>,
  updateProgress: (data: any) => Promise<void>,
  completeTask: (data: any) => Promise<void>,
  failTask: (error: string, logs: string[]) => Promise<void>,
  settleCredits: (userId: number, frozenAmount: number, actualCost: number, taskId: string) => Promise<any>,
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
  
  // 记录任务信息
  logMessage(`═══════════════════════════════════════════════════`);
  logMessage(`🚀 SPF 搜索任务启动 (线程池模式)`);
  logMessage(`═══════════════════════════════════════════════════`);
  logMessage(`📋 任务 ID: ${taskId}`);
  logMessage(`📋 搜索配置:`);
  logMessage(`   • 搜索模式: ${input.mode === 'nameOnly' ? '仅姓名搜索' : '姓名+地点组合搜索'}`);
  logMessage(`   • 搜索姓名: ${input.names.join(', ')}`);
  if (input.mode === 'nameLocation' && input.locations) {
    logMessage(`   • 搜索地点: ${input.locations.join(', ')}`);
  }
  logMessage(`   • 搜索组合: ${subTasks.length} 个任务`);
  
  // 显示过滤条件
  const filters = input.filters || {};
  logMessage(`📋 过滤条件:`);
  logMessage(`   • 年龄范围: ${filters.minAge || 50} - ${filters.maxAge || 79} 岁`);
  if (filters.excludeLandline) logMessage(`   • 排除座机号码`);
  if (filters.excludeWireless) logMessage(`   • 排除手机号码`);
  if (filters.excludeTMobile) logMessage(`   • 排除 T-Mobile 运营商`);
  if (filters.excludeComcast) logMessage(`   • 排除 Comcast/Xfinity 运营商`);
  
  // 显示线程池配置
  logMessage(`═══════════════════════════════════════════════════`);
  logMessage(`🧵 线程池配置 (基于 Scrape.do 最佳实践):`);
  logMessage(`   • Worker Thread 数量: ${THREAD_POOL_CONFIG.WORKER_THREAD_COUNT}`);
  logMessage(`   • 每个 Worker 并发数: ${THREAD_POOL_CONFIG.CONCURRENCY_PER_WORKER}`);
  logMessage(`   • 全局最大并发: ${THREAD_POOL_CONFIG.GLOBAL_MAX_CONCURRENCY}`);
  
  // 显示预估费用
  const maxPagesPerTask = SPF_SEARCH_CONFIG.MAX_SAFE_PAGES;
  const maxDetailsPerTask = SPF_SEARCH_CONFIG.MAX_DETAILS_PER_TASK;
  const estimatedSearchPages = subTasks.length * maxPagesPerTask;
  const estimatedSearchCost = estimatedSearchPages * searchCost;
  const estimatedDetailPages = subTasks.length * maxDetailsPerTask;
  const estimatedDetailCost = estimatedDetailPages * detailCost;
  const estimatedTotalCost = estimatedSearchCost + estimatedDetailCost;
  
  logMessage(`💰 费用预估 (最大值):`);
  logMessage(`   • 搜索页费用: 最多 ${estimatedSearchPages} 页 × ${searchCost} = ${estimatedSearchCost.toFixed(1)} 积分`);
  logMessage(`   • 详情页费用: 最多 ${estimatedDetailPages} 页 × ${detailCost} = ${estimatedDetailCost.toFixed(1)} 积分`);
  logMessage(`   • 预估总费用: ~${estimatedTotalCost.toFixed(1)} 积分 (实际费用取决于搜索结果)`);
  logMessage(`   💡 提示: 缓存命中的详情不收费，可节省大量积分`);
  
  // 更新任务状态
  await updateProgress({
    status: 'running',
    totalSubTasks: subTasks.length,
    logs,
  });
  
  // 统计
  let totalSearchPages = 0;
  let totalDetailPages = 0;
  let totalCacheHits = 0;
  let totalResults = 0;
  let totalFilteredOut = 0;
  let totalSkippedDeceased = 0;
  
  // 用于跨任务电话号码去重
  const seenPhones = new Set<string>();
  
  try {
    // 初始化线程池
    logMessage(`📋 初始化线程池...`);
    const pool = await initThreadPool();
    
    // 监听进度事件
    pool.on('taskProgress', (data: { workerId: number; taskId: string; message: string }) => {
      logMessage(data.message);
    });
    
    // ==================== 阶段一：并发搜索 ====================
    logMessage(`═══════════════════════════════════════════════════`);
    logMessage(`📋 阶段一：线程池并发搜索...`);
    
    // 收集所有详情任务
    const allDetailTasks: DetailTask[] = [];
    const subTaskResults: Map<number, { searchResults: SpfDetailResult[]; searchPages: number }> = new Map();
    
    // 构建搜索任务
    const searchTasks = subTasks.map(subTask => ({
      name: subTask.name,
      location: subTask.location,
      token,
      maxPages,
      filters: input.filters || {},
      subTaskIndex: subTask.index,
    }));
    
    // 提交搜索任务到线程池
    logMessage(`📤 提交 ${searchTasks.length} 个搜索任务到线程池...`);
    
    const searchResults = await pool.submitSearchTasks(searchTasks);
    
    // 处理搜索结果
    for (const result of searchResults) {
      if (result.success && result.data) {
        const { searchResults: results, subTaskIndex } = result.data;
        const stats = result.stats || {};
        
        totalSearchPages += stats.searchPageRequests || 0;
        totalFilteredOut += stats.filteredOut || 0;
        totalSkippedDeceased += stats.skippedDeceased || 0;
        
        // 保存搜索结果
        subTaskResults.set(subTaskIndex, {
          searchResults: results,
          searchPages: stats.searchPageRequests || 0,
        });
        
        // 收集详情任务
        const subTask = subTasks.find(t => t.index === subTaskIndex);
        if (subTask) {
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
          logMessage(`✅ [${subTaskIndex + 1}/${subTasks.length}] ${taskName} - ${results.length} 条结果, ${stats.searchPageRequests || 0} 页`);
        }
      } else {
        logMessage(`❌ 搜索任务失败: ${result.error || 'Unknown error'}`);
      }
    }
    
    // 更新进度
    await updateProgress({
      completedSubTasks: subTasks.length,
      progress: 30,
      searchPageRequests: totalSearchPages,
      logs,
    });
    
    // 增强搜索阶段完成日志
    logMessage(`════════ 搜索阶段完成 ════════`);
    logMessage(`📊 搜索页请求: ${totalSearchPages} 页`);
    logMessage(`📊 待获取详情: ${allDetailTasks.length} 条`);
    logMessage(`📊 年龄预过滤: ${totalFilteredOut} 条被排除`);
    if (totalSkippedDeceased > 0) {
      logMessage(`📊 排除已故: ${totalSkippedDeceased} 条 (Deceased)`);
    }
    
    // ==================== 阶段二：统一队列获取详情 ====================
    if (allDetailTasks.length > 0) {
      logMessage(`═══════════════════════════════════════════════════`);
      logMessage(`📋 阶段二：线程池统一队列获取详情...`);
      
      // 去重详情链接
      const uniqueLinks = Array.from(new Set(allDetailTasks.map(t => t.detailLink)));
      logMessage(`🔗 去重后 ${uniqueLinks.length} 个唯一详情链接`);
      
      // 检查缓存
      logMessage(`检查缓存: ${uniqueLinks.length} 个链接...`);
      const cachedArray = await getCachedDetails(uniqueLinks);
      
      // 将数组转换为 Map
      const cachedMap = new Map<string, SpfDetailResult>();
      for (const item of cachedArray) {
        if (item.data && item.detailLink) {
          cachedMap.set(item.detailLink, item.data as SpfDetailResult);
        }
      }
      
      // 分离缓存命中和需要获取的任务
      const tasksToFetch: Array<{
        detailLink: string;
        token: string;
        filters: any;
        subTaskIndex: number;
        searchName: string;
        searchLocation: string;
      }> = [];
      const tasksByLink = new Map<string, DetailTask[]>();
      
      for (const task of allDetailTasks) {
        const link = task.detailLink;
        if (!tasksByLink.has(link)) {
          tasksByLink.set(link, []);
        }
        tasksByLink.get(link)!.push(task);
      }
      
      const cachedResults: Array<{ task: DetailTask; details: SpfDetailResult }> = [];
      
      for (const [link, linkTasks] of Array.from(tasksByLink.entries())) {
        const cached = cachedMap.get(link);
        if (cached && cached.phone && cached.phone.length >= 10) {
          totalCacheHits++;
          const cachedWithFlag = { ...cached, fromCache: true };
          
          for (const task of linkTasks) {
            cachedResults.push({ task, details: cachedWithFlag });
          }
        } else {
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
      
      logMessage(`⚡ 缓存命中: ${totalCacheHits}, 待获取: ${tasksToFetch.length}`);
      
      // 提交详情任务到线程池
      const cacheToSave: Array<{ link: string; data: SpfDetailResult }> = [];
      
      if (tasksToFetch.length > 0) {
        logMessage(`📤 提交 ${tasksToFetch.length} 个详情任务到线程池...`);
        
        const detailResults = await pool.submitDetailTasks(tasksToFetch);
        
        // 处理详情结果
        for (const result of detailResults) {
          if (result.success && result.data) {
            const { details, subTaskIndex } = result.data;
            const stats = result.stats || {};
            
            totalDetailPages += stats.detailPageRequests || 0;
            
            if (details) {
              // 保存到缓存
              if (details.phone && details.phone.length >= 10) {
                cacheToSave.push({ link: details.detailLink!, data: details });
              }
              
              // 关联到所有使用此链接的任务
              const linkTasks = tasksByLink.get(details.detailLink!) || [];
              for (const task of linkTasks) {
                cachedResults.push({ task, details });
              }
            }
          } else {
            totalDetailPages += result.stats?.detailPageRequests || 0;
            if (result.stats?.filteredOut) {
              totalFilteredOut += result.stats.filteredOut;
            }
          }
        }
      }
      
      // 按子任务分组保存结果
      const resultsBySubTask = new Map<number, SpfDetailResult[]>();
      
      for (const { task, details } of cachedResults) {
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
      
      // 保存缓存
      if (cacheToSave.length > 0) {
        logMessage(`保存缓存: ${cacheToSave.length} 条...`);
        await setCachedDetails(cacheToSave);
      }
      
      logMessage(`════════ 详情阶段完成 ════════`);
      logMessage(`📊 详情页请求: ${totalDetailPages} 页`);
      logMessage(`📊 缓存命中: ${totalCacheHits} 条`);
      logMessage(`📊 详情过滤: ${totalFilteredOut} 条被排除`);
      logMessage(`📊 有效结果: ${totalResults} 条`);
    }
    
    // 更新最终进度
    await updateProgress({
      progress: 100,
      totalResults,
      searchPageRequests: totalSearchPages,
      detailPageRequests: totalDetailPages,
      cacheHits: totalCacheHits,
      logs,
    });
    
    // ==================== 结算退还机制 ====================
    const actualCost = totalSearchPages * searchCost + totalDetailPages * detailCost;
    
    const settlement = await settleCredits(userId, frozenAmount, actualCost, taskId);
    
    // 记录 API 日志
    await logApi({
      userId,
      apiType: 'scrape_spf',
      endpoint: 'fullSearch',
      requestParams: { names: input.names.length, mode: input.mode },
      responseStatus: 200,
      responseTime: 0,
      success: true,
      creditsUsed: actualCost,
    });
    
    // 增强完成日志
    logMessage(`═══════════════════════════════════════════════════`);
    logMessage(`🎉 任务完成! (线程池模式)`);
    logMessage(`═══════════════════════════════════════════════════`);
    
    // 搜索结果摘要
    logMessage(`📊 搜索结果摘要:`);
    logMessage(`   • 有效结果: ${totalResults} 条联系人信息`);
    logMessage(`   • 缓存命中: ${totalCacheHits} 条 (免费获取)`);
    logMessage(`   • 过滤排除: ${totalFilteredOut} 条 (不符合筛选条件)`);
    if (totalSkippedDeceased > 0) {
      logMessage(`   • 排除已故: ${totalSkippedDeceased} 条 (Deceased)`);
    }
    
    // 费用明细
    const searchPageCost = totalSearchPages * searchCost;
    const detailPageCost = totalDetailPages * detailCost;
    const savedByCache = totalCacheHits * detailCost;
    
    logMessage(`💰 费用明细:`);
    logMessage(`   • 搜索页费用: ${totalSearchPages} 页 × ${searchCost} = ${searchPageCost.toFixed(1)} 积分`);
    logMessage(`   • 详情页费用: ${totalDetailPages} 页 × ${detailCost} = ${detailPageCost.toFixed(1)} 积分`);
    logMessage(`   • 缓存节省: ${totalCacheHits} 条 × ${detailCost} = ${savedByCache.toFixed(1)} 积分`);
    logMessage(`   ──────────────────────────────`);
    logMessage(`   • 预扣积分: ${frozenAmount.toFixed(1)} 积分`);
    logMessage(`   • 实际消耗: ${actualCost.toFixed(1)} 积分`);
    if (settlement.refundAmount > 0) {
      logMessage(`   • ✅ 已退还: ${settlement.refundAmount.toFixed(1)} 积分`);
    }
    logMessage(`   • 当前余额: ${settlement.newBalance.toFixed(1)} 积分`);
    
    // 费用效率分析
    logMessage(`📈 费用效率:`);
    if (totalResults > 0) {
      const costPerResult = actualCost / totalResults;
      logMessage(`   • 每条结果成本: ${costPerResult.toFixed(2)} 积分`);
    }
    const cacheHitRate = totalCacheHits > 0 ? ((totalCacheHits / (totalCacheHits + totalDetailPages)) * 100).toFixed(1) : '0';
    logMessage(`   • 缓存命中率: ${cacheHitRate}%`);
    if (savedByCache > 0 && actualCost > 0) {
      logMessage(`   • 缓存节省: ${savedByCache.toFixed(1)} 积分 (相当于 ${Math.round(savedByCache / actualCost * 100)}% 的实际费用)`);
    }
    
    // 线程池状态
    const poolStatus = pool.getStatus();
    logMessage(`🧵 线程池状态:`);
    logMessage(`   • 总任务提交: ${poolStatus.stats.totalTasksSubmitted}`);
    logMessage(`   • 总任务完成: ${poolStatus.stats.totalTasksCompleted}`);
    logMessage(`   • 总任务失败: ${poolStatus.stats.totalTasksFailed}`);
    
    logMessage(`═══════════════════════════════════════════════════`);
    logMessage(`💡 提示: 相同姓名/地点的后续搜索将命中缓存，节省更多积分`);
    logMessage(`═══════════════════════════════════════════════════`);
    
    await completeTask({
      totalResults,
      searchPageRequests: totalSearchPages,
      detailPageRequests: totalDetailPages,
      cacheHits: totalCacheHits,
      creditsUsed: actualCost,
      logs,
    });
    
    // 记录用户活动日志
    await logUserActivity({
      userId,
      action: 'SPF搜索',
      details: `搜索完成(线程池模式): ${input.names.length}个姓名, ${totalResults}条结果, 消耗${actualCost.toFixed(1)}积分`,
      ipAddress: undefined,
      userAgent: undefined,
    });
    
  } catch (error: any) {
    logMessage(`❌ 搜索任务失败: ${error.message}`);
    
    // 失败时的结算退还
    const partialCost = totalSearchPages * searchCost + totalDetailPages * detailCost;
    
    const settlement = await settleCredits(userId, frozenAmount, partialCost, taskId);
    
    logMessage(`💰 失败结算:`);
    logMessage(`   • 预扣积分: ${frozenAmount.toFixed(1)} 积分`);
    logMessage(`   • 已消耗: ${partialCost.toFixed(1)} 积分（搜索页 ${totalSearchPages} + 详情页 ${totalDetailPages}）`);
    if (settlement.refundAmount > 0) {
      logMessage(`   • ✅ 已退还: ${settlement.refundAmount.toFixed(1)} 积分`);
    }
    logMessage(`   • 当前余额: ${settlement.newBalance.toFixed(1)} 积分`);
    
    await failTask(error.message, logs);
    
    await logApi({
      userId,
      apiType: 'scrape_spf',
      endpoint: 'fullSearch',
      requestParams: { names: input.names.length, mode: input.mode },
      responseStatus: 500,
      responseTime: 0,
      success: false,
      errorMessage: error.message,
      creditsUsed: partialCost,
    });
  }
}

/**
 * 检查是否应该使用线程池模式
 */
export function shouldUseThreadPool(): boolean {
  return isThreadPoolEnabled();
}
