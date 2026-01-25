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
import { getDb, logUserActivity } from "../db";
import { tpsSearchTasks } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

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
      defaultMinAge: config.defaultMinAge || 50,
      defaultMaxAge: config.defaultMaxAge || 79,
    };
  }),

  // 预估搜索消耗
  estimateCost: protectedProcedure
    .input(tpsSearchInputSchema)
    .query(async ({ input }) => {
      const config = await getTpsConfig();
      const searchCost = parseFloat(config.searchCost);
      const detailCost = parseFloat(config.detailCost);
      const maxPages = config.maxPages || 25;
      
      // 计算子任务数
      let subTaskCount = 0;
      if (input.mode === "nameOnly") {
        subTaskCount = input.names.length;
      } else {
        const locations = input.locations || [""];
        subTaskCount = input.names.length * locations.length;
      }
      
      // 预估参数（与前端保持一致）
      const avgDetailsPerTask = 50;  // 每个任务平均 50 条详情
      
      // 搜索页费用：任务数 × 最大页数 × 单价（最大预估）
      const maxSearchPages = subTaskCount * maxPages;
      const maxSearchCost = maxSearchPages * searchCost;
      
      // 详情页费用：任务数 × 平均详情数 × 单价
      const estimatedDetails = subTaskCount * avgDetailsPerTask;
      const estimatedDetailCost = estimatedDetails * detailCost;
      
      // 总费用
      const estimatedCost = maxSearchCost + estimatedDetailCost;
      
      return {
        subTaskCount,
        maxPages,
        maxSearchPages,
        maxSearchCost: Math.ceil(maxSearchCost * 10) / 10,
        avgDetailsPerTask,
        estimatedDetails,
        estimatedDetailCost: Math.ceil(estimatedDetailCost * 10) / 10,
        estimatedCost: Math.ceil(estimatedCost * 10) / 10,
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
      const maxPages = config.maxPages || 25;
      
      // 计算子任务数
      let subTaskCount = 0;
      if (input.mode === "nameOnly") {
        subTaskCount = input.names.length;
      } else {
        const locations = input.locations || [""];
        subTaskCount = input.names.length * locations.length;
      }
      
      // 预估最大消耗（与前端保持一致）
      const avgDetailsPerTask = 50;  // 每个任务平均 50 条详情
      const maxSearchPageCost = subTaskCount * maxPages * searchCost;
      const estimatedDetailCost = subTaskCount * avgDetailsPerTask * detailCost;
      const maxEstimatedCost = maxSearchPageCost + estimatedDetailCost;
      
      if (userCredits < maxEstimatedCost) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `积分不足，预估最多需要 ${maxEstimatedCost.toFixed(1)} 积分（搜索页 ${maxSearchPageCost.toFixed(1)} + 详情页 ${estimatedDetailCost.toFixed(1)}），当前余额 ${userCredits} 积分`,
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
      
      // 转换 creditsUsed 为数字类型
      const tasksWithParsedCredits = history.data.map(task => ({
        ...task,
        creditsUsed: parseFloat(task.creditsUsed) || 0,
      }));
      
      return {
        tasks: tasksWithParsedCredits,
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
      
      // 生成 CSV（包含完整字段）
      const headers = [
        "姓名", "年龄", "城市", "州", "位置", "电话", "电话类型", 
        "运营商", "报告年份", "是否主号", "房产价值", "建造年份",
        "搜索姓名", "搜索地点", "详情链接"
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
        r.searchName || "",
        r.searchLocation || "",
        r.detailLink ? `https://www.truepeoplesearch.com${r.detailLink}` : "",
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
 * 统一队列模式执行搜索 (v3.3 优化版)
 * 
 * 两阶段执行：
 * 1. 阶段一：并发执行所有搜索任务（4 并发），每个任务内部并发获取所有搜索页
 * 2. 阶段二：统一队列消费所有详情链接（40 并发）
 * 
 * v3.3 优化：
 * - 搜索阶段：每个任务内部并发获取所有搜索页（而非顺序获取）
 * - 预期性能提升：搜索阶段 10-15 倍
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
  
  // 增强启动日志
  addLog(`═══════════════════════════════════════════════════`);
  addLog(`🌸 开始 TPS 搜索 (v3.4 增强日志版)`);
  addLog(`📜 总任务数: ${subTasks.length}`);
  addLog(`🧵 并发配置: 搜索 ${SEARCH_CONCURRENCY} 任务 × 25页 / 详情 ${TOTAL_CONCURRENCY} 并发`);
  addLog(`🔍 搜索模式: ${input.mode === 'nameOnly' ? '仅姓名' : '姓名+地点'}`);
  addLog(`═══════════════════════════════════════════════════`);
  
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
  
  // 缓存函数（修复：返回数组以支持多电话号码）
  const getCachedDetails = async (links: string[]) => {
    const cached = await getCachedTpsDetails(links);
    const map = new Map<string, TpsDetailResult[]>();
    for (const item of cached) {
      if (item.data) {
        const link = item.detailLink;
        if (!map.has(link)) {
          map.set(link, []);
        }
        map.get(link)!.push(item.data as TpsDetailResult);
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
    addLog(`📋 阶段一：并发搜索 (${SEARCH_CONCURRENCY} 任务并发 × 25页并发)...`);
    
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
        
        const taskName = subTask.location ? `${subTask.name} @ ${subTask.location}` : subTask.name;
        addLog(`✅ [${subTask.index + 1}/${subTasks.length}] ${taskName} - ${result.searchResults.length} 条结果, ${result.stats.searchPageRequests} 页, 过滤 ${result.stats.filteredOut} 条`);
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
    
    // 使用更可靠的并发控制方式
    const runConcurrentSearches = async () => {
      const results: Promise<void>[] = [];
      let currentIndex = 0;
      
      const runNext = async (): Promise<void> => {
        while (currentIndex < searchQueue.length) {
          const task = searchQueue[currentIndex++];
          await processSearch(task);
        }
      };
      
      // 启动指定数量的并发工作器
      const workers = Math.min(SEARCH_CONCURRENCY, searchQueue.length);
      for (let i = 0; i < workers; i++) {
        results.push(runNext());
      }
      
      await Promise.all(results);
    };
    
    await runConcurrentSearches();
    
    // 增强搜索阶段完成日志
    addLog(`════════ 搜索阶段完成 ════════`);
    addLog(`📊 搜索页请求: ${totalSearchPages} 页`);
    addLog(`📊 待获取详情: ${allDetailTasks.length} 条`);
    addLog(`📊 年龄预过滤: ${totalFilteredOut} 条被排除`);
    
    // ==================== 搜索阶段完成后的积分检查 ====================
    // 计算已消耗的搜索页费用
    const searchPageCostSoFar = totalSearchPages * searchCost;
    
    // 去重详情链接，计算需要获取的详情数
    const uniqueDetailLinks = [...new Set(allDetailTasks.map(t => t.searchResult.detailLink))];
    const estimatedDetailCostRemaining = uniqueDetailLinks.length * detailCost;
    const totalEstimatedCost = searchPageCostSoFar + estimatedDetailCostRemaining;
    
    // 再次检查用户积分是否足够
    const currentCredits = await getUserCredits(userId);
    if (currentCredits < totalEstimatedCost) {
      // 积分不足，终止任务
      addLog(`⚠️ 积分不足！当前余额 ${currentCredits} 积分，需要 ${totalEstimatedCost.toFixed(1)} 积分（搜索页 ${searchPageCostSoFar.toFixed(1)} + 详情页 ${estimatedDetailCostRemaining.toFixed(1)}）`);
      addLog(`❌ 任务提前终止，已完成的搜索页费用将正常扣除`);
      
      // 只扣除已完成的搜索页费用
      if (searchPageCostSoFar > 0) {
        await deductCredits(userId, searchPageCostSoFar, `TPS搜索[提前终止] [${taskId}]`);
        await logCreditChange(userId, -searchPageCostSoFar, "search", `TPS搜索任务[提前终止] ${taskId}`, taskId);
      }
      
      // 标记任务为积分不足状态
      await updateTpsSearchTaskProgress(taskDbId, {
        status: "insufficient_credits",
        searchPageRequests: totalSearchPages,
        logs,
      });
      
      // 记录完成信息
      const database = await getDb();
      if (database) {
        await database.update(tpsSearchTasks).set({
          errorMessage: `积分不足，任务提前终止。已扣除搜索页费用 ${searchPageCostSoFar.toFixed(1)} 积分`,
          creditsUsed: searchPageCostSoFar.toString(),
          completedAt: new Date(),
        }).where(eq(tpsSearchTasks.id, taskDbId));
      }
      
      await logApi({
        userId,
        apiType: "scrape_tps",
        endpoint: "fullSearch",
        requestParams: { names: input.names.length, mode: input.mode },
        responseStatus: 402,  // Payment Required
        success: false,
        errorMessage: "积分不足，任务提前终止",
        creditsUsed: searchPageCostSoFar,
      });
      
      return;  // 终止任务
    }
    
    addLog(`✅ 积分检查通过: 当前 ${currentCredits} 积分，预估需要 ${totalEstimatedCost.toFixed(1)} 积分`);
    
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
      
      // 调试：统计每个子任务收到的原始结果数
      const rawResultsBySubTask = new Map<number, number>();
      for (const { task, details } of detailResult.results) {
        rawResultsBySubTask.set(task.subTaskIndex, (rawResultsBySubTask.get(task.subTaskIndex) || 0) + details.length);
      }
      for (const [idx, count] of rawResultsBySubTask) {
        const subTask = subTasks.find(t => t.index === idx);
        if (subTask) {
          addLog(`📊 [调试] 子任务 ${idx + 1} (${subTask.name} @ ${subTask.location || '无地点'}) 收到 ${count} 条原始结果`);
        }
      }
      
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
      
      addLog(`════════ 详情阶段完成 ════════`);
      addLog(`📊 详情页请求: ${totalDetailPages} 页`);
      addLog(`📊 缓存命中: ${totalCacheHits} 条`);
      addLog(`📊 详情过滤: ${totalFilteredOut} 条被排除`);
      addLog(`📊 有效结果: ${totalResults} 条`);
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
    
    // 增强完成日志
    addLog(`═══════════════════════════════════════════════════`);
    addLog(`🎉 任务完成!`);
    addLog(`═══════════════════════════════════════════════════`);
    addLog(`📱 总结果数: ${totalResults}`);
    addLog(`💰 总消耗: ${actualCost.toFixed(1)} 积分`);
    addLog(`════════ 详细统计 ════════`);
    addLog(`   搜索页请求: ${totalSearchPages} 页 (费用: ${(totalSearchPages * searchCost).toFixed(1)})`);
    addLog(`   详情页请求: ${totalDetailPages} 页 (费用: ${(totalDetailPages * detailCost).toFixed(1)})`);
    addLog(`   缓存命中: ${totalCacheHits} 条 (节省: ${(totalCacheHits * detailCost).toFixed(1)} 积分)`);
    addLog(`   过滤排除: ${totalFilteredOut} 条`);
    addLog(`═══════════════════════════════════════════════════`);
    
    await completeTpsSearchTask(taskDbId, {
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
      action: 'TPS搜索',
      details: `搜索完成: ${input.names.length}个姓名, ${totalResults}条结果, 消耗${actualCost.toFixed(1)}积分`,
      ipAddress: null,
      userAgent: null
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
