/**
 * SearchPeopleFree (SPF) tRPC 路由
 * 
 * v4.0 - 实时积分扣除模式
 * 
 * SPF 独特亮点：
 * - 电子邮件信息
 * - 电话类型标注 (座机/手机)
 * - 婚姻状态和配偶信息
 * - 就业状态
 * - 数据确认日期
 * - 地理坐标
 * 
 * v4.0 实时扣除模式特性：
 * - 实时积分扣除：用多少扣多少，扣完即停
 * - 移除缓存读取：每次都请求最新数据
 * - 保留数据保存：用于历史任务 CSV 导出
 * - 简化费用明细：专业、简洁、透明
 * - 优雅停止机制：积分不足时返回已获取结果
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { 
  searchOnly,
  fetchDetailsInBatch,
  SpfFilters, 
  SpfDetailResult,
  DetailTask,
  SPF_CONFIG,
  isThreadPoolEnabled,
} from "./scraper";
import { executeSpfSearchWithThreadPool, shouldUseThreadPool } from "./threadPoolExecutor";
import { globalTaskQueue } from "../_core/taskQueue";
import { THREAD_POOL_CONFIG } from "./config";
import { emitTaskProgress, emitTaskCompleted, emitTaskFailed, emitCreditsUpdate } from "../_core/wsEmitter";
import {
  getSpfConfig,
  createSpfSearchTask,
  updateSpfSearchTaskProgress,
  completeSpfSearchTask,
  failSpfSearchTask,
  saveSpfSearchResults,
  getSpfSearchTask,
  getSpfSearchTaskById,
  getUserSpfSearchTasks,
  getSpfSearchResults,
  getAllSpfSearchResults,
  getCachedSpfDetails,
  saveSpfDetailCache,
  logApi,
} from "./db";
import { getDb, logUserActivity } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import {
  createRealtimeCreditTracker,
  formatCostBreakdown,
} from "./realtimeCredits";

// 并发配置 (基于 Scrape.do 官方最佳实践)
const TOTAL_CONCURRENCY = THREAD_POOL_CONFIG.GLOBAL_MAX_CONCURRENCY;  // 15 全局并发
const SEARCH_CONCURRENCY = THREAD_POOL_CONFIG.WORKER_THREAD_COUNT;    // 3 Worker Thread

// 输入验证 schema
const spfFiltersSchema = z.object({
  minAge: z.number().min(0).max(120).optional(),
  maxAge: z.number().min(0).max(120).optional(),
  minYear: z.number().min(2000).max(2030).optional(),
  minPropertyValue: z.number().min(0).optional(),
  excludeTMobile: z.boolean().optional(),
  excludeComcast: z.boolean().optional(),
  excludeLandline: z.boolean().optional(),
  excludeWireless: z.boolean().optional(),
}).optional();

const spfSearchInputSchema = z.object({
  names: z.array(z.string().min(1, { message: "姓名不能为空" })).min(1, { message: "请至少输入一个姓名" }).max(100, { message: "姓名数量不能超过100个" }),
  locations: z.array(z.string()).optional(),
  mode: z.enum(["nameOnly", "nameLocation"]),
  filters: spfFiltersSchema,
});

export const spfRouter = router({
  // 获取 SPF 配置（用户端）
  getConfig: protectedProcedure.query(async () => {
    const config = await getSpfConfig();
    return {
      searchCost: parseFloat(config.searchCost),
      detailCost: parseFloat(config.detailCost),
      maxPages: config.maxPages,
      enabled: config.enabled,
      defaultMinAge: config.defaultMinAge || 50,
      defaultMaxAge: config.defaultMaxAge || 79,
    };
  }),

  // 预估搜索消耗（按最大消耗预估）
  estimateCost: protectedProcedure
    .input(spfSearchInputSchema)
    .query(async ({ input }) => {
      const config = await getSpfConfig();
      const searchCost = parseFloat(config.searchCost);
      const detailCost = parseFloat(config.detailCost);
      const maxPages = SPF_CONFIG.MAX_SAFE_PAGES;  // 25 页
      const maxDetailsPerTask = SPF_CONFIG.MAX_DETAILS_PER_TASK;  // 250 条
      
      // 计算子任务数
      let subTaskCount = 0;
      if (input.mode === "nameOnly") {
        subTaskCount = input.names.length;
      } else {
        const locations = input.locations || [""];
        subTaskCount = input.names.length * locations.length;
      }
      
      // 搜索页费用：任务数 × 最大页数 × 单价
      const maxSearchPages = subTaskCount * maxPages;
      const maxSearchCost = maxSearchPages * searchCost;
      
      // 详情页费用：任务数 × 最大详情数 × 单价
      const maxDetails = subTaskCount * maxDetailsPerTask;
      const maxDetailCost = maxDetails * detailCost;
      
      // 总费用（最大预估）
      const maxEstimatedCost = maxSearchCost + maxDetailCost;
      
      return {
        subTaskCount,
        maxPages,
        maxSearchPages,
        maxSearchCost: Math.ceil(maxSearchCost * 10) / 10,
        maxDetailsPerTask,
        maxDetails,
        maxDetailCost: Math.ceil(maxDetailCost * 10) / 10,
        maxEstimatedCost: Math.ceil(maxEstimatedCost * 10) / 10,
        searchCost,
        detailCost,
        note: "实时扣费模式：用多少扣多少，积分不足时自动停止并返回已获取结果",
      };
    }),

  // 提交搜索任务 (v4.0 - 实时扣除模式)
  search: protectedProcedure
    .input(spfSearchInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user!.id;
      
      // 检查 SPF 是否启用
      const config = await getSpfConfig();
      if (!config.enabled) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "SearchPeopleFree 功能暂未开放",
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
      
      // 获取用户当前余额
      const database = await getDb();
      if (!database) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "数据库连接失败",
        });
      }
      
      const userResult = await database
        .select({ credits: users.credits })
        .from(users)
        .where(eq(users.id, userId));
      
      const currentBalance = userResult[0]?.credits || 0;
      
      // 检查是否有足够积分启动任务（至少需要一次搜索的费用）
      const minRequiredCredits = searchCost;
      if (currentBalance < minRequiredCredits) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `积分不足，至少需要 ${minRequiredCredits.toFixed(1)} 积分启动搜索，当前余额 ${currentBalance.toFixed(1)} 积分`,
        });
      }
      
      // 创建搜索任务
      const task = await createSpfSearchTask({
        userId,
        mode: input.mode,
        names: input.names,
        locations: input.locations || [],
        filters: input.filters || {},
      });
      
      // 🛡️ v9.0: 通过全局任务队列提交，防止过多任务同时运行导致OOM
      const queueResult = globalTaskQueue.enqueue({
        taskDbId: task.id,
        taskId: task.taskId,
        userId,
        module: 'spf',
        enqueuedAt: Date.now(),
        execute: async () => {
          if (shouldUseThreadPool()) {
            console.log(`[SPF] 使用线程池模式执行任务 (实时扣除): ${task.taskId}`);
            await executeSpfSearchWithThreadPool(
              task.id,
              task.taskId,
              config,
              input,
              userId,
              0,
              (msg) => console.log(`[SPF Task ${task.taskId}] ${msg}`),
              getCachedSpfDetails,
              async (items) => {
                const cacheDays = config.cacheDays || 180;
                await saveSpfDetailCache(items, cacheDays);
              },
              async (data) => await updateSpfSearchTaskProgress(task.id, data),
              async (data) => await completeSpfSearchTask(task.id, data),
              async (error, logs) => await failSpfSearchTask(task.id, error, logs.map(msg => ({ timestamp: new Date().toISOString(), message: msg }))),
              async () => ({ refundAmount: 0, newBalance: 0 }),
              logApi,
              logUserActivity,
              saveSpfSearchResults
            );
          } else {
            await executeSpfSearchRealtimeDeduction(
              task.id,
              task.taskId,
              config,
              input,
              userId
            );
          }
        },
      });
      
      return {
        taskId: task.taskId,
        message: queueResult.queued 
          ? `搜索任务已提交，当前排队位置 #${queueResult.position}，请稍候...`
          : "搜索任务已提交",
        currentBalance: currentBalance,
        note: "实时扣费模式：用多少扣多少，积分不足时自动停止",
        queued: queueResult.queued,
        queuePosition: queueResult.position,
      };
    }),

  // 获取任务状态
  getTaskStatus: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(async ({ ctx, input }) => {
      const task = await getSpfSearchTask(input.taskId);
      
      if (!task || task.userId !== ctx.user!.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "任务不存在",
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
        creditsUsed: parseFloat(task.creditsUsed) || 0,
        logs: task.logs || [],
        errorMessage: task.errorMessage,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
      };
    }),

  // 获取搜索结果 (支持分页)
  getResults: protectedProcedure
    .input(z.object({ 
      taskId: z.string(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const task = await getSpfSearchTask(input.taskId);
      
      if (!task || task.userId !== ctx.user!.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "任务不存在",
        });
      }
      
      const resultsData = await getSpfSearchResults(task.id, input.page, input.pageSize);
      const totalPages = Math.ceil(resultsData.total / input.pageSize);
      
      return {
        taskId: task.taskId,
        status: task.status,
        results: resultsData.data,
        total: resultsData.total,
        totalResults: resultsData.total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages,
      };
    }),

  // 获取用户的搜索历史
  getHistory: protectedProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(50).default(10),
    }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user!.id;
      const tasksData = await getUserSpfSearchTasks(userId, input.page, input.pageSize);
      
      return {
        tasks: tasksData.data.map((t: any) => ({
          taskId: t.taskId,
          status: t.status,
          mode: t.mode,
          names: t.names,
          locations: t.locations,
          totalResults: t.totalResults,
          creditsUsed: parseFloat(t.creditsUsed) || 0,
          createdAt: t.createdAt,
          completedAt: t.completedAt,
        })),
        total: tasksData.total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(tasksData.total / input.pageSize),
      };
    }),

  // 导出搜索结果为 CSV
  exportCsv: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(async ({ ctx, input }) => {
      const task = await getSpfSearchTask(input.taskId);
      
      if (!task || task.userId !== ctx.user!.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "任务不存在",
        });
      }
      
      // 允许 failed 状态导出（失败任务可能已通过流式保存获取了部分结果）
      if (task.status !== "completed" && task.status !== "insufficient_credits" && task.status !== "service_busy" && task.status !== "failed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "任务尚未完成",
        });
      }
      
      const allResults = await getAllSpfSearchResults(task.id);
      
      // 应用任务的过滤条件
      const filters = task.filters as {
        excludeTMobile?: boolean;
        excludeComcast?: boolean;
        excludeLandline?: boolean;
        excludeWireless?: boolean;
      } | null;
      
      const results = allResults.filter((r: any) => {
        // 电话类型过滤
        if (r.phoneType) {
          if (filters?.excludeLandline && r.phoneType === 'Landline') {
            return false;
          }
          if (filters?.excludeWireless && r.phoneType === 'Wireless') {
            return false;
          }
        }
        
        // 运营商过滤
        if (r.carrier) {
          const carrierLower = r.carrier.toLowerCase();
          if (filters?.excludeTMobile && carrierLower.includes('t-mobile')) {
            return false;
          }
          if (filters?.excludeComcast && (carrierLower.includes('comcast') || carrierLower.includes('spectrum'))) {
            return false;
          }
        }
        
        return true;
      });
      
      if (results.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "没有可导出的结果",
        });
      }
      
      // CSV 表头 - 完整字段
      const headers = [
        "姓名",
        "年龄",
        "出生年份",
        "地点",
        "电话",
        "电话类型",
        "运营商",
        "电话年份",
        "婚姻状态",
        "配偶姓名",
        "邮箱",
        "就业状态",
        "关联企业",
        "详情链接",
        "数据来源",
        "获取时间",
      ];
      
      // 格式化电话号码 - 纯数字格式，前缀加 1
      const formatPhone = (phone: string | null | undefined): string => {
        if (!phone) return "";
        const digits = phone.replace(/\D/g, "");
        if (digits.length === 0) return "";
        // 确保前缀有 1
        if (digits.startsWith("1") && digits.length === 11) {
          return digits;
        }
        if (digits.length === 10) {
          return "1" + digits;
        }
        return digits;
      };
      
      // 格式化日期时间
      const formatDateTime = (date: Date | string | null | undefined): string => {
        if (!date) return "";
        const d = new Date(date);
        return d.toLocaleString('zh-CN', { 
          year: 'numeric', 
          month: '2-digit', 
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }).replace(/\//g, '/');
      };
      
      // 格式化关联企业（JSON数组转字符串）
      const formatBusinesses = (businesses: any): string => {
        if (!businesses) return "";
        if (Array.isArray(businesses)) {
          return businesses.filter(b => b).join(" | ");
        }
        return String(businesses);
      };
      
      const csvRows = results.map((r: any) => [
        r.name || "",
        r.age?.toString() || "",
        r.birthYear || "",
        r.city && r.state ? `${r.city}, ${r.state}` : (r.city || r.state || ""),
        formatPhone(r.phone),
        r.phoneType || "",
        r.carrier || "",
        r.phoneYear?.toString() || "",
        r.maritalStatus || "",
        r.spouseName || "",
        r.email || r.primaryEmail || "",
        (r.employment || "").replace(/[\r\n]+/g, " | "),
        formatBusinesses(r.businesses),
        r.detailLink || "",
        "实时获取",
        formatDateTime(r.createdAt),
      ]);
      
      // 生成 CSV 内容
      const csvContent = [
        headers.join(","),
        ...csvRows.map((row: string[]) => row.map((cell: string) => `"${cell.replace(/"/g, '""')}"`).join(","))
      ].join("\n");
      
      // 添加 UTF-8 BOM 头
      const BOM = "\uFEFF";
      const csvContentWithBom = BOM + csvContent;
      
      // 生成文件名
      const searchParams = task.names as string[] || [];
      const firstNames = searchParams.slice(0, 3).join("_").replace(/[^a-zA-Z0-9_]/g, "");
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const fileName = `DataReach_SPF_${firstNames}_${date}.csv`;
      
      return {
        fileName,
        content: csvContentWithBom,
        totalRecords: results.length,
      };
    }),
});

// ==================== 实时扣除模式搜索执行逻辑 ====================

/**
 * 实时扣除模式执行搜索 (v4.0)
 * 
 * 核心特性：
 * 1. 实时积分扣除：每完成一个 API 请求，立即扣除对应积分
 * 2. 移除缓存读取：每次都请求最新数据
 * 3. 保留数据保存：用于历史任务 CSV 导出
 * 4. 优雅停止机制：积分不足时返回已获取结果
 * 5. 简化费用明细：专业、简洁、透明
 */
async function executeSpfSearchRealtimeDeduction(
  taskDbId: number,
  taskId: string,
  config: any,
  input: z.infer<typeof spfSearchInputSchema>,
  userId: number
) {
  const searchCost = parseFloat(config.searchCost);
  const detailCost = parseFloat(config.detailCost);
  const token = config.scrapeDoToken;
  const maxPages = SPF_CONFIG.MAX_SAFE_PAGES;
  
  const logs: Array<{ timestamp: string; message: string }> = [];
  const MAX_LOG_ENTRIES = 100;
  const MAX_MESSAGE_LENGTH = 200;
  
  const addLog = (message: string) => {
    const truncatedMessage = message.length > MAX_MESSAGE_LENGTH 
      ? message.substring(0, MAX_MESSAGE_LENGTH) + '...' 
      : message;
    
    if (logs.length >= MAX_LOG_ENTRIES) {
      logs.shift();
    }
    
    logs.push({ timestamp: new Date().toISOString(), message: truncatedMessage });
    console.log(`[SPF Task ${taskId}] ${truncatedMessage}`);
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
  
  // 初始化实时积分跟踪器
  const creditTracker = await createRealtimeCreditTracker(userId, taskId, searchCost, detailCost);
  const initialBalance = creditTracker.getCurrentBalance();
  
  // v8.2: 启动日志（统一为Anywho标杆风格）
  addLog(`═══════════════════════════════════════════════════`);
  addLog(`🚀 开始 SPF 搜索（实时扣费模式）`);
  addLog(`═══════════════════════════════════════════════════`);
  
  // 显示搜索配置
  addLog(`📋 搜索配置:`);
  const searchNames = subTasks.map(t => t.name).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
  addLog(`   • 搜索姓名: ${searchNames.join(', ')}`);
  const searchLocations = subTasks.map(t => t.location).filter(Boolean).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i);
  if (searchLocations.length > 0) {
    addLog(`   • 搜索地点: ${searchLocations.join(', ')}`);
  }
  addLog(`   • 搜索组合: ${subTasks.length} 个任务`);
  
  // 显示过滤条件
  const filters = input.filters || {};
  addLog(`📋 过滤条件:`);
  addLog(`   • 年龄范围: ${filters.minAge || 50} - ${filters.maxAge || 79} 岁`);
  if (filters.minYear) addLog(`   • 号码年份: ≥ ${filters.minYear} 年`);
  addLog(`   • 排除已故: 是`);  // SPF默认排除已故
  
  addLog(`💰 扣费模式: 实时扣费，用多少扣多少`);
  addLog(`💰 当前余额: ${initialBalance.toFixed(1)} 积分`);
  addLog(`═══════════════════════════════════════════════════`);
  
  // 更新任务状态
  await updateSpfSearchTaskProgress(taskDbId, {
    status: "running",
    totalSubTasks: subTasks.length,
    logs,
  });
  emitTaskProgress(userId, taskId, "spf", { status: "running", totalSubTasks: subTasks.length, logs });
  
  // 统计
  let totalSearchPages = 0;
  let totalDetailPages = 0;
  let totalResults = 0;
  let totalFilteredOut = 0;
  let totalSkippedDeceased = 0;
  let stoppedDueToCredits = false;
  let stoppedDueToApiExhausted = false; // API 服务额度耗尽（与用户积分不足区分）
  
  // 用于跨任务电话号码去重
  const seenPhones = new Set<string>();
  
  // 缓存保存函数（用于 CSV 导出）
  const setCachedDetails = async (items: Array<{ link: string; data: SpfDetailResult }>) => {
    const cacheDays = config.cacheDays || 180;
    await saveSpfDetailCache(items, cacheDays);
  };
  
  try {
    // ==================== 阶段一：逐个搜索（实时扣费） ====================
    
    // 收集所有详情任务
    const allDetailTasks: DetailTask[] = [];
    const subTaskResults: Map<number, { searchResults: SpfDetailResult[]; searchPages: number }> = new Map();
    
    let completedSearches = 0;
    
    for (const subTask of subTasks) {
      // 检查积分是否足够
      if (!await creditTracker.canAffordSearchPage()) {
        addLog(`⚠️ 积分不足，停止搜索`);
        stoppedDueToCredits = true;
        break;
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
        const pagesUsed = result.stats.searchPageRequests;
        
        // 实时扣除搜索页费用
        for (let i = 0; i < pagesUsed; i++) {
          const deductResult = await creditTracker.deductSearchPage();
          if (!deductResult.success) {
            stoppedDueToCredits = true;
            break;
          }
        }
        
        if (stoppedDueToCredits) break;
        
        totalSearchPages += pagesUsed;
        totalFilteredOut += result.stats.filteredOut;
        totalSkippedDeceased += result.stats.skippedDeceased || 0;
        
        // 保存搜索结果
        subTaskResults.set(subTask.index, {
          searchResults: result.searchResults,
          searchPages: pagesUsed,
        });
        
        // 收集详情任务
        for (const searchResult of result.searchResults) {
          if (searchResult.detailLink) {
            allDetailTasks.push({
              detailLink: searchResult.detailLink,
              searchName: subTask.name,
              searchLocation: subTask.location,
              searchResult,
              subTaskIndex: subTask.index,
            });
          }
        }
        
        const taskName = subTask.location ? `${subTask.name} @ ${subTask.location}` : subTask.name;
        addLog(`✅ [${subTask.index + 1}/${subTasks.length}] ${taskName} - ${result.searchResults.length} 条, ${pagesUsed} 页`);
        
        // 检查 Scrape.do API 积分耗尽
        if (result.apiCreditsExhausted) {
          addLog(`🚫 当前使用人数过多，服务繁忙，请联系客服处理`);
          addLog(`💡 已获取的结果已保存，如需继续请联系客服`);
          stoppedDueToApiExhausted = true;
          stoppedDueToCredits = true; // 仍用于停止后续任务的控制流
          break;
        }
      } else {
        // 检查是否因 API 积分耗尽导致失败
        if (result.apiCreditsExhausted) {
          addLog(`🚫 当前使用人数过多，服务繁忙，请联系客服处理`);
          addLog(`💡 已获取的结果已保存，如需继续请联系客服`);
          stoppedDueToApiExhausted = true;
          stoppedDueToCredits = true; // 仍用于停止后续任务的控制流
          break;
        }
        addLog(`❌ [${subTask.index + 1}/${subTasks.length}] 搜索失败: ${result.error}`);
      }
      
      // 更新进度
      const searchProgress = Math.round((completedSearches / subTasks.length) * 30);
      await updateSpfSearchTaskProgress(taskDbId, {
        completedSubTasks: completedSearches,
        progress: searchProgress,
        searchPageRequests: totalSearchPages,
        creditsUsed: creditTracker.getCostBreakdown().totalCost,
        logs,
      });
      emitTaskProgress(userId, taskId, "spf", { progress: searchProgress, completedSubTasks: completedSearches, totalSubTasks: subTasks.length, logs });
      emitCreditsUpdate(userId, { newBalance: creditTracker.getCurrentBalance(), deductedAmount: creditTracker.getCostBreakdown().totalCost, source: "spf", taskId });
    }
    
    // v8.2: 搜索完成过渡日志
    addLog(`════════ 进入详情获取阶段 ════════`);
    
    // ==================== 阶段二：获取详情（实时扣费，无缓存读取） ====================
    if (allDetailTasks.length > 0 && !stoppedDueToCredits) {
      addLog(`📋 待获取详情: ${allDetailTasks.length} 条`);
      addLog(`💰 当前余额: ${creditTracker.getCurrentBalance().toFixed(1)} 积分`);
      
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
        addLog(`⚠️ 积分不足，无法获取详情`);
        stoppedDueToCredits = true;
        linksToFetch = []; // 清空待获取列表，避免白调API
      } else if (affordCheck.affordableCount < uniqueLinks.length) {
        addLog(`⚠️ 积分仅够获取 ${affordCheck.affordableCount}/${uniqueLinks.length} 条详情`);
        linksToFetch = uniqueLinks.slice(0, affordCheck.affordableCount);
        stoppedDueToCredits = true;
      }
      
      // 构建详情任务（不读取缓存）
      const detailTasksToFetch: DetailTask[] = [];
      for (const link of linksToFetch) {
        const linkTasks = tasksByLink.get(link);
        if (linkTasks && linkTasks.length > 0) {
          detailTasksToFetch.push(linkTasks[0]);
        }
      }
      
      // 获取详情（不使用缓存读取）
      if (detailTasksToFetch.length > 0) {
        // v8.2: 详情进度回调 — 实时更新DB和推送WS
        let lastSpfDetailPush = 0;
        const onDetailProgress = (info: { completedDetails: number; totalDetails: number; percent: number; detailPageRequests: number; totalResults: number }) => {
          const now = Date.now();
          // 每2秒最多推送一次，或者是最后一条
          if (now - lastSpfDetailPush < 2000 && info.completedDetails < info.totalDetails) return;
          lastSpfDetailPush = now;
          
          // 详情阶段进度占 30%-95%
          const detailProgress = 30 + Math.round(info.percent * 0.65);
          
          // fire-and-forget DB更新
          updateSpfSearchTaskProgress(taskDbId, {
            progress: detailProgress,
            searchPageRequests: totalSearchPages,
            detailPageRequests: totalDetailPages + info.detailPageRequests,
            totalResults: info.totalResults,
            creditsUsed: creditTracker.getCostBreakdown().totalCost,
            logs,
          }).catch(err => console.error('[SPF] 详情进度更新DB失败:', err));
          
          // WS推送
          emitTaskProgress(userId, taskId, "spf", {
            progress: detailProgress,
            completedDetails: info.completedDetails,
            totalDetails: info.totalDetails,
            detailPageRequests: totalDetailPages + info.detailPageRequests,
            totalResults: info.totalResults,
            creditsUsed: creditTracker.getCostBreakdown().totalCost,
            logs,
          });
          emitCreditsUpdate(userId, { newBalance: creditTracker.getCurrentBalance(), deductedAmount: creditTracker.getCostBreakdown().totalCost, source: "spf", taskId });
        };
        
        // 🛡️ v9.0: 流式保存回调 - 每批结果立即保存到数据库，不在内存中累积
        const onBatchSave = async (items: Array<{ task: typeof detailTasksToFetch[0]; details: SpfDetailResult }>) => {
          const resultsBySubTask = new Map<number, SpfDetailResult[]>();
          
          for (const { task, details } of items) {
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
            
            const resultWithSearchInfo = {
              ...details,
              searchName: task.searchName,
              searchLocation: task.searchLocation,
            };
            
            resultsBySubTask.get(task.subTaskIndex)!.push(resultWithSearchInfo);
          }
          
          let batchSavedCount = 0;
          for (const [subTaskIndex, results] of Array.from(resultsBySubTask.entries())) {
            const subTask = subTasks.find(t => t.index === subTaskIndex);
            if (subTask && results.length > 0) {
              await saveSpfSearchResults(taskDbId, subTaskIndex, subTask.name, subTask.location, results);
              batchSavedCount += results.length;
            }
          }
          
          totalResults += batchSavedCount;
          return batchSavedCount;
        };
        
        const detailResult = await fetchDetailsInBatch(
          detailTasksToFetch,
          token,
          TOTAL_CONCURRENCY,
          input.filters || {},
          addLog,
          async () => new Map(), // 不读取缓存
          setCachedDetails, // 保存数据用于 CSV 导出
          onDetailProgress, // v8.2: 详情进度回调
          onBatchSave // 🛡️ v9.0: 流式保存回调
        );
        
        // 实时扣除详情页费用（逐条扣除 + 实时推送积分更新）
        for (let i = 0; i < detailResult.stats.detailPageRequests; i++) {
          const deductResult = await creditTracker.deductDetailPage();
          if (!deductResult.success) {
            stoppedDueToCredits = true;
            break;
          }
        }
        
        // 扣除后立即推送积分更新和进度更新
        emitCreditsUpdate(userId, { newBalance: creditTracker.getCurrentBalance(), deductedAmount: creditTracker.getCostBreakdown().totalCost, source: "spf", taskId });
        
        totalDetailPages += detailResult.stats.detailPageRequests;
        totalFilteredOut += detailResult.stats.filteredOut;
        
        // 检查是否因 Scrape.do API 积分耗尽停止
        if (detailResult.stats.apiCreditsExhausted) {
          addLog(`🚫 当前使用人数过多，服务繁忙，任务提前结束`);
          addLog(`💡 已获取的结果已保存，如需继续请联系客服`);
          stoppedDueToApiExhausted = true;
        }
      }
      
      // 详情完成，静默处理
    }
    
    // ==================== 搜索阶段积分耗尽时保存搜索结果 ====================
    // 如果搜索阶段积分耗尽导致详情阶段被跳过，仍需保存已获取的搜索结果
    if (stoppedDueToCredits && totalResults === 0 && allDetailTasks.length > 0) {
      addLog(`📋 保存搜索阶段已获取的 ${allDetailTasks.length} 条基础结果...`);
      
      // 按子任务分组
      const searchResultsBySubTask = new Map<number, SpfDetailResult[]>();
      
      for (const task of allDetailTasks) {
        if (!searchResultsBySubTask.has(task.subTaskIndex)) {
          searchResultsBySubTask.set(task.subTaskIndex, []);
        }
        
        // 跨任务电话号码去重
        if (task.searchResult.phone && seenPhones.has(task.searchResult.phone)) {
          continue;
        }
        if (task.searchResult.phone) {
          seenPhones.add(task.searchResult.phone);
        }
        
        // 使用搜索结果作为基础数据保存
        const resultWithSearchInfo = {
          ...task.searchResult,
          searchName: task.searchName,
          searchLocation: task.searchLocation,
        };
        
        searchResultsBySubTask.get(task.subTaskIndex)!.push(resultWithSearchInfo);
      }
      
      for (const [subTaskIndex, results] of Array.from(searchResultsBySubTask.entries())) {
        const subTask = subTasks.find(t => t.index === subTaskIndex);
        if (subTask && results.length > 0) {
          await saveSpfSearchResults(taskDbId, subTaskIndex, subTask.name, subTask.location, results);
          totalResults += results.length;
        }
      }
      
      addLog(`✅ 已保存 ${totalResults} 条搜索结果（无详情数据）`);
    }
    
    // 更新最终进度
    await updateSpfSearchTaskProgress(taskDbId, {
      progress: 100,
      totalResults,
      searchPageRequests: totalSearchPages,
      detailPageRequests: totalDetailPages,
      creditsUsed: creditTracker.getCostBreakdown().totalCost,
      logs,
    });
    emitTaskProgress(userId, taskId, "spf", { progress: 100, totalResults, logs });
    emitCreditsUpdate(userId, { newBalance: creditTracker.getCurrentBalance(), deductedAmount: creditTracker.getCostBreakdown().totalCost, source: "spf", taskId });
    
    // ==================== 任务完成日志（统一专业版） ====================
    const breakdown = creditTracker.getCostBreakdown();
    const currentBalance = creditTracker.getCurrentBalance();
    
    const costLines = formatCostBreakdown(breakdown, currentBalance, totalResults, stoppedDueToCredits, stoppedDueToApiExhausted);
    for (const line of costLines) {
      addLog(line);
    }
    
    // 记录 API 日志
    await logApi({
      userId,
      apiType: "scrape_spf",
      endpoint: "fullSearch",
      requestParams: { names: input.names.length, mode: input.mode },
      responseStatus: 200,
      responseTime: 0,
      success: true,
      creditsUsed: breakdown.totalCost,
    });
    
    const finalStatus = stoppedDueToApiExhausted ? "service_busy" : (stoppedDueToCredits ? "insufficient_credits" : "completed");
    await completeSpfSearchTask(taskDbId, {
      totalResults,
      searchPageRequests: totalSearchPages,
      detailPageRequests: totalDetailPages,
      cacheHits: 0, // 不再使用缓存命中
      creditsUsed: breakdown.totalCost,
      logs,
      stoppedDueToCredits,
      stoppedDueToApiExhausted,
    });
    emitTaskCompleted(userId, taskId, "spf", { totalResults, creditsUsed: breakdown.totalCost, status: finalStatus });
    
    // 记录用户活动日志
    await logUserActivity({
      userId,
      action: 'SPF搜索',
      details: `搜索${stoppedDueToApiExhausted ? '(服务繁忙停止)' : (stoppedDueToCredits ? '(积分不足停止)' : '完成')}: ${input.names.length}个姓名, ${totalResults}条结果, 消耗${breakdown.totalCost.toFixed(1)}积分`,
      ipAddress: undefined,
      userAgent: undefined
    });
    
  } catch (error: any) {
    const safeMsg = (error.message || '').includes('Scrape.do') ? '服务繁忙，请稍后重试' : error.message;
    addLog(`❌ 任务失败: ${safeMsg}`);
    
    // 获取已消耗的费用
    const breakdown = creditTracker.getCostBreakdown();
    
    await failSpfSearchTask(taskDbId, safeMsg, logs);
    emitTaskFailed(userId, taskId, "spf", { error: safeMsg, creditsUsed: breakdown.totalCost });
    
    await logApi({
      userId,
      apiType: "scrape_spf",
      endpoint: "fullSearch",
      requestParams: { names: input.names.length, mode: input.mode },
      responseStatus: 500,
      responseTime: 0,
      success: false,
      errorMessage: error.message,
      creditsUsed: breakdown.totalCost,
    });
  }
}
