/**
 * TruePeopleSearch tRPC 路由
 * 
 * 提供 TPS 搜索功能的 API 端点
 * 
 * v4.0 更新:
 * - 实时扣分机制：用多少扣多少，扣完即停
 * - 有始有终：积分不足时停止，返回已获取结果
 * - 取消缓存命中：每次都获取最新数据
 * - 保留数据保存：用于历史 CSV 导出
 * - 简化费用明细：更专业透明的展示
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
  DetailTaskWithIndex,
  TPS_CONFIG,
} from "./scraper";
import { 
  fetchDetailsWithSmartPool,
} from "./smartPoolExecutor";
import {
  TPS_POOL_CONFIG,
  getTpsTaskScaleDescription,
} from "./smartConcurrencyPool";
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
  saveTpsDetailCache,
  logApi,
  getUserCredits,
} from "./db";
import { getDb, logUserActivity } from "../db";
import { tpsSearchTasks } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { 
  createTpsRealtimeCreditTracker, 
  TpsRealtimeCreditTracker,
  formatTpsCostBreakdown,
} from "./realtimeCredits";
import {
  getConcurrencyStats,
  getActiveTasks,
  recordTaskStart,
  recordTaskComplete,
  recordTaskProgress,
} from "./concurrencyMonitor";

// 统一队列并发配置 (v5.0 智能动态并发池)
const TOTAL_CONCURRENCY = TPS_POOL_CONFIG.GLOBAL_MAX_CONCURRENCY;  // 40 总并发 (4×10)
const SEARCH_CONCURRENCY = TPS_POOL_CONFIG.MAX_THREADS;  // 4 搜索并发

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
      
      // 预估参数
      const avgDetailsPerTask = 50;
      
      // 搜索页费用
      const maxSearchPages = subTaskCount * maxPages;
      const maxSearchCost = maxSearchPages * searchCost;
      
      // 详情页费用
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

  // 提交搜索任务 (v4.0 实时扣分版)
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
      
      const searchCost = parseFloat(config.searchCost);
      const detailCost = parseFloat(config.detailCost);
      
      // ==================== 实时扣分模式：只检查最低余额 ====================
      const userCredits = await getUserCredits(userId);
      const minRequiredCredits = searchCost; // 至少能执行一次搜索页请求
      
      if (userCredits < minRequiredCredits) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `积分不足，至少需要 ${minRequiredCredits.toFixed(1)} 积分才能开始搜索，当前余额 ${userCredits.toFixed(1)} 积分`,
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
      
      // 异步执行搜索（实时扣分模式）
      executeTpsSearchRealtimeDeduction(task.id, task.taskId, config, input, userId).catch(err => {
        console.error(`TPS 搜索任务 ${task.taskId} 执行失败:`, err);
      });
      
      return {
        taskId: task.taskId,
        message: "搜索任务已提交（实时扣分模式）",
        currentBalance: userCredits,
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
      
      // 允许 completed 和 insufficient_credits 状态导出
      if (task.status !== "completed" && task.status !== "insufficient_credits") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "任务尚未完成，无法导出",
        });
      }
      
      const results = await getTpsSearchResults(task.id, 1, 10000);
      
      // 电话号码格式化函数：转换为纯数字+前缀1格式
      const formatPhone = (phone: string): string => {
        if (!phone) return "";
        // 移除所有非数字字符
        const digits = phone.replace(/\D/g, "");
        // 如果是10位数字，添加1前缀
        if (digits.length === 10) {
          return `1${digits}`;
        }
        // 如果是11位且以1开头，直接返回
        if (digits.length === 11 && digits.startsWith("1")) {
          return digits;
        }
        // 其他情况直接返回数字
        return digits;
      };
      
      // 从全名解析 firstName 和 lastName
      const parseName = (fullName: string): { firstName: string; lastName: string } => {
        if (!fullName) return { firstName: "", lastName: "" };
        const parts = fullName.trim().split(/\s+/);
        if (parts.length === 1) {
          return { firstName: parts[0], lastName: "" };
        }
        // 第一个词是 firstName，最后一个词是 lastName
        return { firstName: parts[0], lastName: parts[parts.length - 1] };
      };
      
      // CSV 表头 - 精简版，删除重复冗余列
      const headers = [
        "姓名",
        "年龄",
        "地址",
        "电话",
        "电话类型",
        "运营商",
        "号码年份",
        "房产价值",
        "公司",
        "职位",
        "主邮箱",
        "其他邮箱",
        "婚姻状态",
        "详情链接",
        "数据来源",
        "获取时间",
      ];
      
      // CSV 数据行
      const rows = results.data.map((r: any) => {
        // 婚姻状态：有配偶显示配偶名字，无配偶显示"可能单身"
        const maritalStatus = r.spouse ? r.spouse : "可能单身";
        
        // 从其他邮箱中剔除主邮箱
        const primaryEmail = r.primaryEmail || "";
        let otherEmails = r.email || "";
        if (primaryEmail && otherEmails) {
          // 将邮箱字符串分割成数组，过滤掉主邮箱，再重新组合
          const emailList = otherEmails.split(",").map((e: string) => e.trim());
          const filteredEmails = emailList.filter((e: string) => e.toLowerCase() !== primaryEmail.toLowerCase());
          otherEmails = filteredEmails.join(", ");
        }
        
        return [
          r.name || "",
          r.age?.toString() || "",
          r.location || (r.city && r.state ? `${r.city}, ${r.state}` : ""),
          formatPhone(r.phone || ""),
          r.phoneType || "",
          r.carrier || "",
          r.reportYear?.toString() || "",
          r.propertyValue?.toString() || "",
          r.company || "",
          r.jobTitle || "",
          primaryEmail,
          otherEmails,
          maritalStatus,
          r.detailLink ? `https://www.truepeoplesearch.com${r.detailLink}` : "",
          "TruePeopleSearch",
          new Date().toISOString().split("T")[0],
        ];
      });
      
      // 生成 CSV 内容
      const BOM = "\uFEFF";
      const csv = BOM + [
        headers.join(","),
        ...rows.map((row: string[]) => row.map((cell: string) => `"${cell.replace(/"/g, '""')}"`).join(","))
      ].join("\n");
      
      return {
        csv,
        filename: `DataReach_TPS_${task.taskId}_${new Date().toISOString().split("T")[0]}.csv`,
      };
    }),

  // ==================== 并发监控 API ====================
  
  // 获取并发统计信息
  getConcurrencyStats: protectedProcedure.query(async () => {
    return getConcurrencyStats();
  }),

  // 获取活跃任务列表
  getActiveTasks: protectedProcedure.query(async () => {
    return getActiveTasks();
  }),
});

// ==================== 实时扣分模式搜索执行逻辑 (v4.0) ====================

/**
 * 实时扣分模式执行搜索
 * 
 * 核心理念：用多少扣多少，扣完即停，有始有终
 * 
 * 特点：
 * 1. 每个 API 请求成功后立即扣除积分
 * 2. 积分不足时立即停止，返回已获取结果
 * 3. 不使用缓存命中，每次都获取最新数据
 * 4. 保存数据用于历史 CSV 导出
 */
async function executeTpsSearchRealtimeDeduction(
  taskDbId: number,
  taskId: string,
  config: any,
  input: z.infer<typeof tpsSearchInputSchema>,
  userId: number
) {
  const searchCost = parseFloat(config.searchCost);
  const detailCost = parseFloat(config.detailCost);
  const token = config.scrapeDoToken;
  const maxPages = TPS_CONFIG.MAX_SAFE_PAGES;
  
  const logs: Array<{ timestamp: string; message: string }> = [];
  const addLog = (message: string) => {
    logs.push({ timestamp: new Date().toISOString(), message });
  };
  
  // 创建实时积分跟踪器
  const creditTracker = await createTpsRealtimeCreditTracker(
    userId,
    taskId,
    searchCost,
    detailCost
  );
  
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
  
  // 启动日志（简洁专业版，参考 SPF 风格）
  addLog(`🚀 TPS 搜索任务启动`);
  addLog(`📋 搜索组合: ${subTasks.length} 个任务`);
  if (input.mode === 'nameLocation' && input.locations) {
    addLog(`📋 搜索: ${input.names.join(', ')} @ ${input.locations.join(', ')}`);
  } else {
    addLog(`📋 搜索: ${input.names.join(', ')}`);
  }
  
  // 显示过滤条件
  const filters = input.filters || {};
  addLog(`📋 过滤条件: 年龄 ${filters.minAge || 50}-${filters.maxAge || 79} 岁`);
  
  // 更新任务状态
  await updateTpsSearchTaskProgress(taskDbId, {
    status: "running",
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
  
  // 缓存保存函数（只保存，不读取）
  const setCachedDetails = async (items: Array<{ link: string; data: TpsDetailResult }>) => {
    const cacheDays = config.cacheDays || 180;
    await saveTpsDetailCache(items, cacheDays);
  };
  
  // 用于跨任务电话号码去重
  const seenPhones = new Set<string>();
  
  try {
    // ==================== 阶段一：并发搜索（实时扣费） ====================
    addLog(`📋 阶段一：开始搜索...`);
    
    // 收集所有详情任务
    const allDetailTasks: DetailTaskWithIndex[] = [];
    const subTaskResults: Map<number, { searchResults: TpsSearchResult[]; searchPages: number }> = new Map();
    
    let completedSearches = 0;
    
    // 并发执行搜索
    const searchQueue = [...subTasks];
    
    const processSearch = async (subTask: { name: string; location: string; index: number }) => {
      // 检查是否因积分不足而停止
      if (stoppedDueToCredits) {
        return;
      }
      
      // 检查是否有足够积分执行搜索
      const canAfford = await creditTracker.canAffordSearchPage();
      if (!canAfford) {
        stoppedDueToCredits = true;
        addLog(`⚠️ 积分不足，停止搜索阶段`);
        return;
      }
      
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
        // 实时扣除搜索页费用
        for (let i = 0; i < result.stats.searchPageRequests; i++) {
          const deductResult = await creditTracker.deductSearchPage();
          if (!deductResult.success) {
            stoppedDueToCredits = true;
            addLog(`⚠️ 积分不足，停止搜索`);
            break;
          }
        }
        
        totalSearchPages += result.stats.searchPageRequests;
        totalFilteredOut += result.stats.filteredOut;
        totalSkippedDeceased += result.stats.skippedDeceased || 0;
        
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
        addLog(`✅ [${subTask.index + 1}/${subTasks.length}] ${taskName} - ${result.searchResults.length} 条结果, ${result.stats.searchPageRequests} 页`);
      } else {
        addLog(`❌ [${subTask.index + 1}/${subTasks.length}] 搜索失败: ${result.error}`);
      }
      
      // 更新进度
      const searchProgress = Math.round((completedSearches / subTasks.length) * 30);
      await updateTpsSearchTaskProgress(taskDbId, {
        completedSubTasks: completedSearches,
        progress: searchProgress,
        searchPageRequests: totalSearchPages,
        creditsUsed: creditTracker.getTotalDeducted(),
        logs,
      });
    };
    
    // 并发执行搜索
    const runConcurrentSearches = async () => {
      let currentIndex = 0;
      
      const runNext = async (): Promise<void> => {
        while (currentIndex < searchQueue.length && !stoppedDueToCredits) {
          const task = searchQueue[currentIndex++];
          await processSearch(task);
        }
      };
      
      const workers = Math.min(SEARCH_CONCURRENCY, searchQueue.length);
      const workerPromises: Promise<void>[] = [];
      for (let i = 0; i < workers; i++) {
        workerPromises.push(runNext());
      }
      
      await Promise.all(workerPromises);
    };
    
    await runConcurrentSearches();
    
    // 搜索阶段完成日志（简洁版）
    addLog(`✅ 搜索完成: ${totalSearchPages} 页, 找到 ${allDetailTasks.length} 条待获取`);
    
    if (stoppedDueToCredits) {
      addLog(`⚠️ 积分不足，停止搜索`);
    }
    
    // ==================== 阶段二：智能并发池获取详情（v5.0 实时扣费） ====================
    if (allDetailTasks.length > 0 && !stoppedDueToCredits) {
      addLog(`📋 开始获取详情...`);
      
      // 使用智能并发池获取详情
      const detailResult = await fetchDetailsWithSmartPool(
        allDetailTasks,
        token,
        input.filters || {},
        addLog,
        setCachedDetails,
        creditTracker
      );
      
      totalDetailPages += detailResult.stats.detailPageRequests;
      totalFilteredOut += detailResult.stats.filteredOut;
      
      // 检查是否因积分不足停止
      if (detailResult.stats.stoppedDueToCredits || creditTracker.isStopped()) {
        stoppedDueToCredits = true;
      }
      
      // 按子任务分组保存结果
      const resultsBySubTask = new Map<number, TpsDetailResult[]>();
      
      for (const { task, details } of detailResult.results) {
        if (!resultsBySubTask.has(task.subTaskIndex)) {
          resultsBySubTask.set(task.subTaskIndex, []);
        }
        
        // 跨任务电话号码去重
        for (const detail of details) {
          if (detail.phone && seenPhones.has(detail.phone)) {
            continue;
          }
          if (detail.phone) {
            seenPhones.add(detail.phone);
          }
          resultsBySubTask.get(task.subTaskIndex)!.push(detail);
        }
      }
      
      // 保存结果到数据库
      for (const [subTaskIndex, results] of Array.from(resultsBySubTask.entries())) {
        const subTask = subTasks.find(t => t.index === subTaskIndex);
        if (subTask && results.length > 0) {
          await saveTpsSearchResults(taskDbId, subTaskIndex, subTask.name, subTask.location, results);
          totalResults += results.length;
        }
      }
    }
    
    // 更新最终进度
    await updateTpsSearchTaskProgress(taskDbId, {
      progress: 100,
      totalResults,
      searchPageRequests: totalSearchPages,
      detailPageRequests: totalDetailPages,
      cacheHits: 0, // 不再使用缓存命中
      creditsUsed: creditTracker.getTotalDeducted(),
      logs,
    });
    
    // 记录 API 日志
    await logApi({
      userId,
      apiType: "scrape_tps",
      endpoint: "fullSearch",
      requestParams: { names: input.names.length, mode: input.mode },
      responseStatus: 200,
      success: true,
      creditsUsed: creditTracker.getTotalDeducted(),
    });
    
    // 生成费用明细
    const costBreakdown = creditTracker.getCostBreakdown();
    const costLines = formatTpsCostBreakdown(
      costBreakdown,
      creditTracker.getCurrentBalance(),
      totalResults,
      searchCost,
      detailCost
    );
    
    for (const line of costLines) {
      addLog(line);
    }
    
    // 完成任务
    const finalStatus = stoppedDueToCredits ? "insufficient_credits" : "completed";
    
    if (stoppedDueToCredits) {
      addLog(`⚠️ 任务因积分不足提前结束`);
      
      // 更新任务状态为 insufficient_credits
      const database = await getDb();
      if (database) {
        await database.update(tpsSearchTasks).set({
          status: "insufficient_credits",
          totalResults,
          searchPageRequests: totalSearchPages,
          detailPageRequests: totalDetailPages,
          cacheHits: 0,
          creditsUsed: creditTracker.getTotalDeducted().toFixed(2),
          logs,
          completedAt: new Date(),
        }).where(eq(tpsSearchTasks.id, taskDbId));
      }
    } else {
      await completeTpsSearchTask(taskDbId, {
        totalResults,
        searchPageRequests: totalSearchPages,
        detailPageRequests: totalDetailPages,
        cacheHits: 0,
        creditsUsed: creditTracker.getTotalDeducted(),
        logs,
      });
    }

    // 记录用户活动日志
    await logUserActivity({
      userId,
      action: 'TPS搜索',
      details: `搜索${stoppedDueToCredits ? '(积分不足停止)' : '完成'}: ${input.names.length}个姓名, ${totalResults}条结果, 消耗${creditTracker.getTotalDeducted().toFixed(1)}积分`,
      ipAddress: undefined,
      userAgent: undefined
    });
    
  } catch (error: any) {
    addLog(`❌ 任务失败: ${error.message}`);
    
    // 获取已消耗的费用
    const costBreakdown = creditTracker.getCostBreakdown();
    
    await failTpsSearchTask(taskDbId, error.message, logs);
    
    await logApi({
      userId,
      apiType: "scrape_tps",
      endpoint: "fullSearch",
      requestParams: { names: input.names.length, mode: input.mode },
      responseStatus: 500,
      success: false,
      errorMessage: error.message,
      creditsUsed: creditTracker.getTotalDeducted(),
    });
  }
}
