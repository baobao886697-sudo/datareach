/**
 * TruePeopleSearch tRPC 路由
 * 
 * 提供 TPS 搜索功能的 API 端点
 * 
 * v3.2 更新:
 * - 实现统一队列模式：40 并发统一消费详情队列
 * - 两阶段执行：先并发搜索，再统一获取详情
 * - 最大化并发利用率，避免线程间不平衡
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { 
  searchOnly,
  fetchDetailsInBatch,
  TpsFilters, 
  TpsDetailResult,
  TpsSearchResult,
  DetailTask,
  TPS_CONFIG,
} from "./scraper";
import {
  getTpsConfig,
  createTpsSearchTask,
  updateTpsSearchTaskProgress,
  completeTpsSearchTask,
  failTpsSearchTask,
  saveTpsSearchResults,
  getTpsSearchTask,
  getUserTpsSearchTasks,
  getTpsSearchResults,
  getCachedTpsDetails,
  saveTpsDetailCache,
  deductCredits,
  getUserCredits,
  logCreditChange,
  logApi,
} from "./db";

// 统一队列并发配置
const TOTAL_CONCURRENCY = TPS_CONFIG.TOTAL_CONCURRENCY;  // 40 总并发
const SEARCH_CONCURRENCY = TPS_CONFIG.TASK_CONCURRENCY;  // 4 搜索并发

// 输入验证 schema
const tpsFiltersSchema = z.object({
  minAge: z.number().min(0).max(120).optional(),
  maxAge: z.number().min(0).max(120).optional(),
  minYear: z.number().min(2000).max(2030).optional(),
  minPropertyValue: z.number().min(0).optional(),
  excludeTMobile: z.boolean().optional(),
  excludeComcast: z.boolean().optional(),
  excludeLandline: z.boolean().optional(),
}).optional();

const tpsSearchInputSchema = z.object({
  names: z.array(z.string().min(1)).min(1).max(100),
  locations: z.array(z.string()).optional(),
  mode: z.enum(["nameOnly", "nameLocation"]),
  filters: tpsFiltersSchema,
  // maxPages 已删除，固定使用最大 25 页
});

export const tpsRouter = router({
  // 获取 TPS 配置（用户端）
  getConfig: protectedProcedure.query(async () => {
    const config = await getTpsConfig();
    return {
      searchCost: parseFloat(config.searchCost),
      detailCost: parseFloat(config.detailCost),
      maxPages: config.maxPages,
      enabled: config.enabled,
    };
  }),

  // 预估搜索消耗
  estimateCost: protectedProcedure
    .input(tpsSearchInputSchema)
    .query(async ({ input }) => {
      const config = await getTpsConfig();
      const searchCost = parseFloat(config.searchCost);
      const detailCost = parseFloat(config.detailCost);
      
      // 计算子任务数
      let subTaskCount = 0;
      if (input.mode === "nameOnly") {
        subTaskCount = input.names.length;
      } else {
        const locations = input.locations || [""];
        subTaskCount = input.names.length * locations.length;
      }
      
      // 预估：每个子任务平均 5 页搜索 + 50 条详情
      const avgPagesPerTask = 5;
      const avgDetailsPerTask = 50;
      
      const estimatedSearchPages = subTaskCount * avgPagesPerTask;
      const estimatedDetails = subTaskCount * avgDetailsPerTask;
      
      const estimatedCost = 
        estimatedSearchPages * searchCost + 
        estimatedDetails * detailCost;
      
      return {
        subTaskCount,
        estimatedSearchPages,
        estimatedDetails,
        estimatedCost: Math.ceil(estimatedCost * 10) / 10, // 向上取整到0.1
        searchCost,
        detailCost,
      };
    }),

  // 提交搜索任务
  search: protectedProcedure
    .input(tpsSearchInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user!.id;
      
      // 检查 TPS 是否启用
      const config = await getTpsConfig();
      if (!config.enabled) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "TruePeopleSearch 功能暂未开放",
        });
      }
      
      if (!config.scrapeDoToken) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "系统配置错误，请联系管理员",
        });
      }
      
      // 检查用户积分
      const userCredits = await getUserCredits(userId);
      const searchCost = parseFloat(config.searchCost);
      const detailCost = parseFloat(config.detailCost);
      
      // 预估最小消耗
      const minEstimatedCost = input.names.length * (searchCost + detailCost * 10);
      if (userCredits < minEstimatedCost) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `积分不足，预估最少需要 ${minEstimatedCost.toFixed(1)} 积分，当前余额 ${userCredits} 积分`,
        });
      }
      
      // 创建搜索任务
      const task = await createTpsSearchTask({
        userId,
        mode: input.mode,
        names: input.names,
        locations: input.locations || [],
        filters: input.filters || {},
        maxPages: config.maxPages,
      });
      
      // 异步执行搜索（不阻塞响应）
      executeTpsSearchUnifiedQueue(task.id, task.taskId, config, input, userId).catch(err => {
        console.error(`TPS 搜索任务 ${task.taskId} 执行失败:`, err);
      });
      
      return {
        taskId: task.taskId,
        message: "搜索任务已提交",
      };
    }),

  // 获取任务状态
  getTaskStatus: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(async ({ ctx, input }) => {
      const task = await getTpsSearchTask(input.taskId);
      
      if (!task) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "任务不存在",
        });
      }
      
      if (task.userId !== ctx.user!.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "无权访问此任务",
        });
      }
      
      return {
        taskId: task.taskId,
        status: task.status,
        progress: task.progress,
        totalSubTasks: task.totalSubTasks,
        completedSubTasks: task.completedSubTasks,
        totalResults: task.totalResults,
        searchPageRequests: task.searchPageRequests,
        detailPageRequests: task.detailPageRequests,
        cacheHits: task.cacheHits,
        creditsUsed: parseFloat(task.creditsUsed),
        logs: task.logs || [],
        errorMessage: task.errorMessage,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
      };
    }),

  // 获取任务结果
  getTaskResults: protectedProcedure
    .input(z.object({ 
      taskId: z.string(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(10).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const task = await getTpsSearchTask(input.taskId);
      
      if (!task) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "任务不存在",
        });
      }
      
      if (task.userId !== ctx.user!.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "无权访问此任务",
        });
      }
      
      const results = await getTpsSearchResults(task.id, input.page, input.pageSize);
      
      return {
        results: results.data,
        total: results.total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(results.total / input.pageSize),
      };
    }),

  // 获取用户搜索历史
  getHistory: protectedProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(10).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user!.id;
      const history = await getUserTpsSearchTasks(userId, input.page, input.pageSize);
      
      return {
        tasks: history.data,
        total: history.total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(history.total / input.pageSize),
      };
    }),

  // 导出结果为 CSV
  exportResults: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const task = await getTpsSearchTask(input.taskId);
      
      if (!task) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "任务不存在",
        });
      }
      
      if (task.userId !== ctx.user!.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "无权访问此任务",
        });
      }
      
      const results = await getTpsSearchResults(task.id, 1, 10000);
      
      // 电话号码格式化函数：转换为 +1 格式
      const formatPhone = (phone: string): string => {
        if (!phone) return "";
        // 移除所有非数字字符
        const digits = phone.replace(/\D/g, "");
        // 如果是10位数字，添加+1前缀
        if (digits.length === 10) {
          return `+1${digits}`;
        }
        // 如果是11位且以1开头，添加+前缀
        if (digits.length === 11 && digits.startsWith("1")) {
          return `+${digits}`;
        }
        // 其他情况返回原始数字
        return digits;
      };
      
      // 生成 CSV
      const headers = [
        "姓名", "年龄", "城市", "州", "位置", "电话", "电话类型", 
        "运营商", "报告年份", "是否主号", "房产价值", "建造年份"
      ];
      
      const rows = results.data.map((r: any) => [
        r.name || "",
        r.age?.toString() || "",
        r.city || "",
        r.state || "",
        r.location || (r.city && r.state ? `${r.city}, ${r.state}` : (r.city || r.state || "")),
        formatPhone(r.phone),
        r.phoneType || "",
        r.carrier || "",
        r.reportYear?.toString() || "",
        r.isPrimary ? "是" : "否",
        r.propertyValue?.toString() || "",
        r.yearBuilt?.toString() || "",
      ]);
      
      // 添加 UTF-8 BOM 头以确保 Excel 正确识别中文
      const BOM = "\uFEFF";
      const csv = BOM + [
        headers.join(","),
        ...rows.map((row: string[]) => row.map((cell: string) => `"${cell.replace(/"/g, '""')}"`).join(","))
      ].join("\n");
      
      return {
        csv,
        filename: `tps_results_${task.taskId}_${new Date().toISOString().split("T")[0]}.csv`,
      };
    }),
});

// ==================== 统一队列模式搜索执行逻辑 ====================

/**
 * 统一队列模式执行搜索
 * 
 * 两阶段执行：
 * 1. 阶段一：并发执行所有搜索任务（4 并发），收集详情链接
 * 2. 阶段二：统一队列消费所有详情链接（40 并发）
 * 
 * 优势：
 * - 详情获取阶段始终保持 40 并发，不会因任务大小不均而浪费
 * - 搜索阶段快速完成，详情阶段高效并行
 */
async function executeTpsSearchUnifiedQueue(
  taskDbId: number,
  taskId: string,
  config: any,
  input: z.infer<typeof tpsSearchInputSchema>,
  userId: number
) {
  const searchCost = parseFloat(config.searchCost);
  const detailCost = parseFloat(config.detailCost);
  const token = config.scrapeDoToken;
  const maxPages = TPS_CONFIG.MAX_SAFE_PAGES;  // 固定使用最大 25 页
  
  const logs: Array<{ timestamp: string; message: string }> = [];
  const addLog = (message: string) => {
    logs.push({ timestamp: new Date().toISOString(), message });
  };
  
  // 构建子任务列表
  const subTasks: Array<{ name: string; location: string; index: number }> = [];
  
  if (input.mode === "nameOnly") {
    for (let i = 0; i < input.names.length; i++) {
      subTasks.push({ name: input.names[i], location: "", index: i });
    }
  } else {
    const locations = input.locations && input.locations.length > 0 
      ? input.locations 
      : [""];
    let index = 0;
    for (const name of input.names) {
      for (const location of locations) {
        subTasks.push({ name, location, index: index++ });
      }
    }
  }
  
  addLog(`🚀 开始搜索任务，共 ${subTasks.length} 个子任务`);
  addLog(`⚡ 统一队列模式: 搜索 ${SEARCH_CONCURRENCY} 并发 → 详情 ${TOTAL_CONCURRENCY} 并发`);
  
  // 更新任务状态
  await updateTpsSearchTaskProgress(taskDbId, {
    status: "running",
    totalSubTasks: subTasks.length,
    logs,
  });
  
  // 统计
  let totalSearchPages = 0;
  let totalDetailPages = 0;
  let totalCacheHits = 0;
  let totalResults = 0;
  let totalFilteredOut = 0;
  
  // 缓存函数
  const getCachedDetails = async (links: string[]) => {
    const cached = await getCachedTpsDetails(links);
    const map = new Map<string, TpsDetailResult>();
    for (const item of cached) {
      if (item.data) {
        map.set(item.detailLink, item.data as TpsDetailResult);
      }
    }
    return map;
  };
  
  const setCachedDetails = async (items: Array<{ link: string; data: TpsDetailResult }>) => {
    const cacheDays = config.cacheDays || 30;
    await saveTpsDetailCache(items, cacheDays);
  };
  
  // 用于跨任务电话号码去重
  const seenPhones = new Set<string>();
  
  try {
    // ==================== 阶段一：并发搜索 ====================
    addLog(`📋 阶段一：并发搜索（${SEARCH_CONCURRENCY} 并发）...`);
    
    // 收集所有详情任务
    const allDetailTasks: DetailTask[] = [];
    const subTaskResults: Map<number, { searchResults: TpsSearchResult[]; searchPages: number }> = new Map();
    
    let completedSearches = 0;
    
    // 并发执行搜索
    const searchQueue = [...subTasks];
    let searchIndex = 0;
    const runningSearches: Promise<void>[] = [];
    
    const processSearch = async (subTask: { name: string; location: string; index: number }) => {
      const result = await searchOnly(
        subTask.name,
        subTask.location,
        token,
        maxPages,
        input.filters || {},
        (msg) => addLog(`[${subTask.index + 1}/${subTasks.length}] ${msg}`)
      );
      
      completedSearches++;
      
      if (result.success) {
        totalSearchPages += result.stats.searchPageRequests;
        totalFilteredOut += result.stats.filteredOut;
        
        // 保存搜索结果
        subTaskResults.set(subTask.index, {
          searchResults: result.searchResults,
          searchPages: result.stats.searchPageRequests,
        });
        
        // 收集详情任务
        for (const searchResult of result.searchResults) {
          allDetailTasks.push({
            searchResult,
            subTaskIndex: subTask.index,
            name: subTask.name,
            location: subTask.location,
          });
        }
        
        addLog(`✅ [${subTask.index + 1}/${subTasks.length}] 搜索完成: ${result.searchResults.length} 条待获取详情`);
      } else {
        addLog(`❌ [${subTask.index + 1}/${subTasks.length}] 搜索失败: ${result.error}`);
      }
      
      // 更新进度（搜索阶段占 30%）
      const searchProgress = Math.round((completedSearches / subTasks.length) * 30);
      await updateTpsSearchTaskProgress(taskDbId, {
        completedSubTasks: completedSearches,
        progress: searchProgress,
        searchPageRequests: totalSearchPages,
        logs,
      });
    };
    
    const startNextSearch = () => {
      if (searchIndex < searchQueue.length) {
        const task = searchQueue[searchIndex++];
        const promise = processSearch(task).then(() => {
          startNextSearch();
        });
        runningSearches.push(promise);
      }
    };
    
    // 启动搜索并发
    const initialSearchBatch = Math.min(SEARCH_CONCURRENCY, searchQueue.length);
    for (let i = 0; i < initialSearchBatch; i++) {
      startNextSearch();
    }
    
    await Promise.all(runningSearches);
    
    addLog(`📊 搜索阶段完成: ${allDetailTasks.length} 条详情待获取`);
    
    // ==================== 阶段二：统一队列获取详情 ====================
    if (allDetailTasks.length > 0) {
      addLog(`📋 阶段二：统一队列获取详情（${TOTAL_CONCURRENCY} 并发）...`);
      
      // 去重详情链接
      const uniqueLinks = [...new Set(allDetailTasks.map(t => t.searchResult.detailLink))];
      addLog(`🔗 去重后 ${uniqueLinks.length} 个唯一详情链接`);
      
      // 统一获取详情
      const detailResult = await fetchDetailsInBatch(
        allDetailTasks,
        token,
        TOTAL_CONCURRENCY,
        input.filters || {},
        addLog,
        getCachedDetails,
        setCachedDetails
      );
      
      totalDetailPages += detailResult.stats.detailPageRequests;
      totalCacheHits += detailResult.stats.cacheHits;
      totalFilteredOut += detailResult.stats.filteredOut;
      
      // 按子任务分组保存结果
      const resultsBySubTask = new Map<number, TpsDetailResult[]>();
      
      for (const { task, details } of detailResult.results) {
        if (!resultsBySubTask.has(task.subTaskIndex)) {
          resultsBySubTask.set(task.subTaskIndex, []);
        }
        
        // 跨任务电话号码去重
        for (const detail of details) {
          if (detail.phone && seenPhones.has(detail.phone)) {
            continue;  // 跳过重复电话
          }
          if (detail.phone) {
            seenPhones.add(detail.phone);
          }
          resultsBySubTask.get(task.subTaskIndex)!.push(detail);
        }
      }
      
      // 保存结果到数据库
      for (const [subTaskIndex, results] of resultsBySubTask) {
        const subTask = subTasks.find(t => t.index === subTaskIndex);
        if (subTask && results.length > 0) {
          await saveTpsSearchResults(taskDbId, subTaskIndex, subTask.name, subTask.location, results);
          totalResults += results.length;
        }
      }
      
      addLog(`📊 详情阶段完成: ${totalResults} 条结果`);
    }
    
    // 更新最终进度
    await updateTpsSearchTaskProgress(taskDbId, {
      progress: 100,
      totalResults,
      searchPageRequests: totalSearchPages,
      detailPageRequests: totalDetailPages,
      cacheHits: totalCacheHits,
      logs,
    });
    
    // 计算实际消耗
    const actualCost = totalSearchPages * searchCost + totalDetailPages * detailCost;
    
    // 扣除积分
    if (actualCost > 0) {
      await deductCredits(userId, actualCost, `TPS搜索 [${taskId}]`);
      await logCreditChange(userId, -actualCost, "search", `TPS搜索任务 ${taskId}`, taskId);
    }
    
    // 记录 API 日志
    await logApi({
      userId,
      apiType: "scrape_tps",
      endpoint: "fullSearch",
      requestParams: { names: input.names.length, mode: input.mode },
      responseStatus: 200,
      success: true,
      creditsUsed: actualCost,
    });
    
    // 完成任务
    addLog(`🎉 搜索任务完成！共 ${totalResults} 条结果，消耗 ${actualCost.toFixed(1)} 积分`);
    addLog(`📈 统计: 搜索页 ${totalSearchPages}，详情页 ${totalDetailPages}，缓存命中 ${totalCacheHits}，过滤 ${totalFilteredOut}`);
    
    await completeTpsSearchTask(taskDbId, {
      totalResults,
      searchPageRequests: totalSearchPages,
      detailPageRequests: totalDetailPages,
      cacheHits: totalCacheHits,
      creditsUsed: actualCost,
      logs,
    });
    
  } catch (error: any) {
    addLog(`❌ 搜索任务失败: ${error.message}`);
    
    await failTpsSearchTask(taskDbId, error.message, logs);
    
    await logApi({
      userId,
      apiType: "scrape_tps",
      endpoint: "fullSearch",
      requestParams: { names: input.names.length, mode: input.mode },
      responseStatus: 500,
      success: false,
      errorMessage: error.message,
    });
  }
}
