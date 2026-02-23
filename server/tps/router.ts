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
  TpsFilters, 
  TpsDetailResult,
  TpsSearchResult,
  DetailTask,
  DetailTaskWithIndex,
  TPS_CONFIG,
} from "./scraper";
import { 
  fetchDetailsWithSmartPool,
  DetailProgressInfo,
  BATCH_CONFIG,
  BatchSaveItem,
} from "./smartPoolExecutor";
import { globalTaskQueue } from "../_core/taskQueue";
// v8.0: smartConcurrencyPool 已废弃，分批配置从 smartPoolExecutor 导入
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
import { emitTaskProgress, emitTaskCompleted, emitTaskFailed, emitCreditsUpdate } from "../_core/wsEmitter";

// v8.0: 搜索并发配置（详情并发由 BATCH_CONFIG 控制）
const SEARCH_CONCURRENCY = 3;  // 搜索并发：固定3个名字同时搜索

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
  names: z.array(z.string().min(1, { message: "姓名不能为空" })).min(1, { message: "请至少输入一个姓名" }).max(100, { message: "姓名数量不能超过100个" }),
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
      
      // 🛡️ v9.0: 通过全局任务队列提交，防止过多任务同时运行导致OOM
      const queueResult = globalTaskQueue.enqueue({
        taskDbId: task.id,
        taskId: task.taskId,
        userId,
        module: 'tps',
        enqueuedAt: Date.now(),
        execute: async (signal?: AbortSignal) => {
          await executeTpsSearchRealtimeDeduction(task.id, task.taskId, config, input, userId, signal);
        },
      });
      
      return {
        taskId: task.taskId,
        message: queueResult.queued 
          ? `搜索任务已提交，当前排队位置 #${queueResult.position}，请稍候...`
          : "搜索任务已提交（实时扣分模式）",
        currentBalance: userCredits,
        queued: queueResult.queued,
        queuePosition: queueResult.position,
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
      
      // 允许 completed、insufficient_credits、service_busy 和 failed 状态导出（失败任务可能已通过流式保存获取了部分结果）
      if (task.status !== "completed" && task.status !== "insufficient_credits" && task.status !== "service_busy" && task.status !== "failed") {
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
          // BUG-15修复：使用任务完成时间而非当前时间
          (task.completedAt ? new Date(task.completedAt).toISOString().split("T")[0] : new Date().toISOString().split("T")[0]),
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
  userId: number,
  signal?: AbortSignal
) {
  // v8.0: 全局信号量已移除，并发由分批模式控制
  console.log(`[TPS v8.0] 用户 ${userId} 开始任务`);
  
  // BUG-10修复：记录任务开始到监控器
  recordTaskStart(taskId, userId, 0);
  
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
  
  // v8.2: 启动日志（统一为Anywho标杆风格）
  addLog(`═══════════════════════════════════════════════════`);
  addLog(`🚀 开始 TPS 搜索（实时扣费模式）`);
  addLog(`═══════════════════════════════════════════════════`);
  
  // 显示搜索配置
  addLog(`📋 搜索配置:`);
  if (input.mode === 'nameLocation' && input.locations) {
    addLog(`   • 搜索姓名: ${input.names.join(', ')}`);
    addLog(`   • 搜索地点: ${input.locations.join(', ')}`);
  } else {
    addLog(`   • 搜索姓名: ${input.names.join(', ')}`);
  }
  addLog(`   • 搜索组合: ${subTasks.length} 个任务`);
  
  // 显示过滤条件
  const filters = input.filters || {};
  addLog(`📋 过滤条件:`);
  addLog(`   • 年龄范围: ${filters.minAge || 50} - ${filters.maxAge || 79} 岁`);
  if (filters.minYear) addLog(`   • 号码年份: ≥ ${filters.minYear} 年`);
  addLog(`   • 排除已故: 是`);  // TPS默认排除已故
  
  addLog(`💰 扣费模式: 实时扣费，用多少扣多少`);
  addLog(`💰 当前余额: ${creditTracker.getCurrentBalance().toFixed(1)} 积分`);
  addLog(`═══════════════════════════════════════════════════`);
  
  // 更新任务状态
  await updateTpsSearchTaskProgress(taskDbId, {
    status: "running",
    totalSubTasks: subTasks.length,
    logs,
  });
  emitTaskProgress(userId, taskId, "tps", { status: "running", totalSubTasks: subTasks.length, logs });
  
  // 统计
  let totalSearchPages = 0;
  let totalDetailPages = 0;
  let totalResults = 0;
  let totalFilteredOut = 0;
  let totalSkippedDeceased = 0;
  let stoppedDueToCredits = false;
  let stoppedDueToApiExhausted = false; // API 服务额度耗尽（与用户积分不足区分）
  
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
      // 检查超时终止信号
      if (signal?.aborted) {
        addLog(`⚠️ 任务已超时，停止搜索`);
        stoppedDueToCredits = true;  // 复用停止标志终止后续流程
        return;
      }
      // BUG-04修复：先检查同步标志，再检查异步余额，减少竞态窗口
      if (stoppedDueToCredits || creditTracker.isStopped()) {
        return;
      }
      
      // BUG-05修复：搜索前预检查是否足够支付至少1页搜索费用
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
        (msg) => addLog(`[${subTask.index + 1}/${subTasks.length}] ${msg}`),
        signal
      );
      
      completedSearches++;
      
      if (result.success) {
        // v3.0: 按所有API调用次数扣费（含失败），调用1次API扣除1次
        for (let i = 0; i < result.stats.searchPageRequests; i++) {
          const deductResult = await creditTracker.deductSearchPage();
          if (!deductResult.success) {
            stoppedDueToCredits = true;
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
        addLog(`✅ [${subTask.index + 1}/${subTasks.length}] ${taskName} - ${result.searchResults.length} 条结果, ${result.stats.searchPageRequests} 页成功`);
        
        // 检查 Scrape.do API 积分耗尽
        if (result.apiCreditsExhausted) {
          addLog(`🚫 当前使用人数过多，服务繁忙，请联系客服处理`);
          addLog(`💡 已获取的结果已保存，如需继续请联系客服`);
          stoppedDueToApiExhausted = true;
          stoppedDueToCredits = true; // 仍用于停止后续任务的控制流
          return;
        }
      } else {
        // v3.0: 搜索失败也要扣费（API已被调用）
        // searchPageRequests 在 scraper.ts 中已统计所有调用（含失败）
        if (result.stats.searchPageRequests > 0) {
          for (let i = 0; i < result.stats.searchPageRequests; i++) {
            const deductResult = await creditTracker.deductSearchPage();
            if (!deductResult.success) {
              stoppedDueToCredits = true;
              break;
            }
          }
          totalSearchPages += result.stats.searchPageRequests;
        }
        
        // 检查是否因 API 积分耗尽导致失败
        if (result.apiCreditsExhausted) {
          addLog(`🚫 当前使用人数过多，服务繁忙，请联系客服处理`);
          addLog(`💡 已获取的结果已保存，如需继续请联系客服`);
          stoppedDueToApiExhausted = true;
          stoppedDueToCredits = true;
          return;
        }
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
      emitTaskProgress(userId, taskId, "tps", { progress: searchProgress, completedSubTasks: completedSearches, totalSubTasks: subTasks.length, creditsUsed: creditTracker.getTotalDeducted(), logs });
      emitCreditsUpdate(userId, { newBalance: creditTracker.getCurrentBalance(), deductedAmount: creditTracker.getTotalDeducted(), source: "tps", taskId });
    };
    
    // 并发执行搜索
    const runConcurrentSearches = async () => {
      let currentIndex = 0;
      
      const runNext = async (): Promise<void> => {
        while (currentIndex < searchQueue.length && !stoppedDueToCredits && !signal?.aborted) {
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
    
    // stoppedDueToCredits 已在搜索阶段首次触发时输出日志，此处不再重复
    
    // ==================== 阶段二：智能并发池获取详情（v7.0 全局弹性并发 + 实时进度推送） ====================
    if (allDetailTasks.length > 0 && !stoppedDueToCredits && !signal?.aborted) {
      addLog(`════════ 进入详情获取阶段 ════════`);
      addLog(`📋 待获取详情: ${allDetailTasks.length} 条`);
      addLog(`💰 当前余额: ${creditTracker.getCurrentBalance().toFixed(1)} 积分`);
      
      // v7.0: 详情进度回调 — 每完成一批就更新数据库和推送WS
      let lastDetailProgressPush = 0; // 防止推送过于频繁
      const onDetailProgress = (info: DetailProgressInfo) => {
        const now = Date.now();
        // 每2秒最多推送一次，或者是最后一条
        if (now - lastDetailProgressPush < 2000 && info.completedDetails < info.totalDetails) return;
        lastDetailProgressPush = now;
        
        // 详情阶段进度占 30%-95%
        const detailProgress = 30 + Math.round(info.percent * 0.65);
        const phase = info.phase === 'retrying' ? '重试中' : '获取详情';
        
        // v7.2: 使用 fire-and-forget 模式，避免阻塞并发池的 onStats 回调
        // v8.2: 增加 detailPageRequests 和 totalResults 实时推送
        updateTpsSearchTaskProgress(taskDbId, {
          progress: detailProgress,
          searchPageRequests: totalSearchPages,
          detailPageRequests: info.detailPageRequests,
          totalResults: info.totalResults,
          creditsUsed: creditTracker.getTotalDeducted(),
          logs,
        }).catch(err => console.error('[TPS] 详情进度更新DB失败:', err));
        
        // WS推送是同步的，不会抛异常
        emitTaskProgress(userId, taskId, "tps", {
          progress: detailProgress,
          phase,
          completedDetails: info.completedDetails,
          totalDetails: info.totalDetails,
          detailPageRequests: info.detailPageRequests,
          totalResults: info.totalResults,
          creditsUsed: creditTracker.getTotalDeducted(),
          logs,
        });
        emitCreditsUpdate(userId, { newBalance: creditTracker.getCurrentBalance(), deductedAmount: creditTracker.getTotalDeducted(), source: "tps", taskId });
      };
      
      // 🛡️ v9.0: 流式保存回调 - 每批结果立即保存到数据库，不在内存中累积
      const onBatchSave = async (items: BatchSaveItem[]): Promise<number> => {
        // 按子任务分组
        const resultsBySubTask = new Map<number, TpsDetailResult[]>();
        
        for (const { task, details } of items) {
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
        
        // 立即保存到数据库
        let batchSavedCount = 0;
        for (const [subTaskIndex, results] of Array.from(resultsBySubTask.entries())) {
          const subTask = subTasks.find(t => t.index === subTaskIndex);
          if (subTask && results.length > 0) {
            await saveTpsSearchResults(taskDbId, subTaskIndex, subTask.name, subTask.location, results);
            batchSavedCount += results.length;
          }
        }
        
        totalResults += batchSavedCount;
        return batchSavedCount;
      };
      
      // 使用智能并发池获取详情（v9.0 流式保存模式）
      const detailResult = await fetchDetailsWithSmartPool(
        allDetailTasks,
        token,
        input.filters || {},
        addLog,
        setCachedDetails,
        creditTracker,
        userId,
        onDetailProgress,
        onBatchSave,
        signal
      );
      
      totalDetailPages += detailResult.stats.detailPageRequests;
      totalFilteredOut += detailResult.stats.filteredOut;
      
      // 检查是否因积分不足停止
      if (detailResult.stats.stoppedDueToCredits || creditTracker.isStopped()) {
        stoppedDueToCredits = true;
      }
      
      // 检查是否因 Scrape.do API 积分耗尽停止
      if (detailResult.stats.stoppedDueToApiCredits) {
        addLog(`🚫 当前使用人数过多，服务繁忙，任务提前结束`);
        addLog(`💡 已获取的结果已保存，如需继续请联系客服`);
        stoppedDueToApiExhausted = true;
      }
    }
    
    // ==================== 搜索阶段积分耗尽时保存搜索结果 ====================
    // 如果搜索阶段积分耗尽导致详情阶段被跳过，仍需保存已获取的搜索结果
    if (stoppedDueToCredits && totalResults === 0 && allDetailTasks.length > 0) {
      addLog(`📋 保存搜索阶段已获取的 ${allDetailTasks.length} 条基础结果...`);
      
      // 按子任务分组，将搜索结果转换为基础详情格式
      const searchResultsBySubTask = new Map<number, TpsDetailResult[]>();
      
      for (const task of allDetailTasks) {
        if (!searchResultsBySubTask.has(task.subTaskIndex)) {
          searchResultsBySubTask.set(task.subTaskIndex, []);
        }
        
        // 跨任务电话号码去重（搜索结果无phone，跳过去重）
        
        // 将 TpsSearchResult 转换为 TpsDetailResult 基础格式
        const locationParts = task.searchResult.location?.split(',').map(s => s.trim()) || [];
        const basicResult: TpsDetailResult = {
          name: task.searchResult.name,
          age: task.searchResult.age,
          city: locationParts[0] || '',
          state: locationParts[1] || '',
          location: task.searchResult.location,
          detailLink: task.searchResult.detailLink,
        };
        
        searchResultsBySubTask.get(task.subTaskIndex)!.push(basicResult);
      }
      
      for (const [subTaskIndex, results] of Array.from(searchResultsBySubTask.entries())) {
        const subTask = subTasks.find(t => t.index === subTaskIndex);
        if (subTask && results.length > 0) {
          await saveTpsSearchResults(taskDbId, subTaskIndex, subTask.name, subTask.location, results);
          totalResults += results.length;
        }
      }
      
      addLog(`✅ 已保存 ${totalResults} 条搜索结果（无详情数据）`);
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
    emitTaskProgress(userId, taskId, "tps", { progress: 100, totalResults, creditsUsed: creditTracker.getTotalDeducted(), logs });
    emitCreditsUpdate(userId, { newBalance: creditTracker.getCurrentBalance(), deductedAmount: creditTracker.getTotalDeducted(), source: "tps", taskId });
    
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
      detailCost,
      stoppedDueToCredits,
      stoppedDueToApiExhausted
    );
    
    for (const line of costLines) {
      addLog(line);
    }
    
    // 完成任务
    const finalStatus = stoppedDueToApiExhausted ? "service_busy" : (stoppedDueToCredits ? "insufficient_credits" : "completed");
    
    if (stoppedDueToApiExhausted || stoppedDueToCredits) {
      
      // 更新任务状态：API 耗尽为 service_busy，用户积分不足为 insufficient_credits
      const database = await getDb();
      if (database) {
        try {
          await database.update(tpsSearchTasks).set({
            status: finalStatus,
            totalResults,
            searchPageRequests: totalSearchPages,
            detailPageRequests: totalDetailPages,
            cacheHits: 0,
            creditsUsed: creditTracker.getTotalDeducted().toFixed(2),
            logs,
            completedAt: new Date(),
          }).where(eq(tpsSearchTasks.id, taskDbId));
        } catch (dbError: any) {
          // ⭐ ENUM兼容性保护：如果数据库不支持该状态值，fallback到"failed"
          console.error(`[TPS v8.0] 状态更新失败 (${finalStatus})，尝试fallback到failed:`, dbError.message);
          try {
            await database.update(tpsSearchTasks).set({
              status: 'failed',
              totalResults,
              searchPageRequests: totalSearchPages,
              detailPageRequests: totalDetailPages,
              cacheHits: 0,
              creditsUsed: creditTracker.getTotalDeducted().toFixed(2),
              logs,
              completedAt: new Date(),
            }).where(eq(tpsSearchTasks.id, taskDbId));
          } catch (fallbackError: any) {
            console.error(`[TPS v8.0] fallback状态更新也失败:`, fallbackError.message);
          }
        }
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
    emitTaskCompleted(userId, taskId, "tps", { totalResults, creditsUsed: creditTracker.getTotalDeducted(), status: finalStatus });

    // BUG-10修复：记录任务完成到监控器
    recordTaskComplete(taskId, true);
    console.log(`[TPS v8.0] 用户 ${userId} 任务完成`);

    // 记录用户活动日志
    await logUserActivity({
      userId,
      action: 'TPS搜索',
      details: `搜索${stoppedDueToApiExhausted ? '(服务繁忙停止)' : (stoppedDueToCredits ? '(积分不足停止)' : '完成')}: ${input.names.length}个姓名, ${totalResults}条结果, 消耗${creditTracker.getTotalDeducted().toFixed(1)}积分`,
      ipAddress: undefined,
      userAgent: undefined
    });
    
    } catch (error: any) {
    const safeMsg = (error.message || '').includes('Scrape.do') ? '服务繁忙，请稍后重试' : error.message;
    addLog(`❌ 任务失败: ${safeMsg}`);
    
    // 获取已消耗的费用
    const costBreakdown = creditTracker.getCostBreakdown();
    
    await failTpsSearchTask(taskDbId, safeMsg, logs);
    emitTaskFailed(userId, taskId, "tps", { error: safeMsg, creditsUsed: creditTracker.getTotalDeducted() });
    
    // BUG-10修复：记录任务失败到监控器
    recordTaskComplete(taskId, false);
    console.log(`[TPS v8.0] 用户 ${userId} 任务失败`);
    
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
