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

// v9.3: 分组流水线配置
const SEARCH_CONCURRENCY = 3;  // 搜索并发：每组内3个组合同时搜索
const GROUP_SIZE = 3;          // 每组3个搜索组合，搜完立即获取详情

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
      
      // 允许 completed、insufficient_credits、service_busy、failed 和 cancelled 状态导出（停止/失败任务可能已通过流式保存获取了部分结果）
      if (task.status !== "completed" && task.status !== "insufficient_credits" && task.status !== "service_busy" && task.status !== "failed" && task.status !== "cancelled") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "任务尚未完成，无法导出",
        });
      }
      
      // 🛡️ BUG-FIX: 移除硬编码的 10000 条上限，先查询总数，再一次性获取所有结果
      const countCheck = await getTpsSearchResults(task.id, 1, 1);
      const totalRecords = countCheck.total;
      
      if (totalRecords === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "该任务没有可导出的结果数据",
        });
      }
      
      console.log(`[TPS CSV] 导出任务 ${task.taskId}: 总记录数 ${totalRecords}`);
      const results = await getTpsSearchResults(task.id, 1, Math.max(totalRecords, 1));
      
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

  // ==================== v9.3: 停止搜索任务 ====================
  
  stopTask: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user!.id;
      
      // 验证任务存在且属于当前用户
      const task = await getTpsSearchTask(input.taskId);
      if (!task) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "任务不存在",
        });
      }
      if (task.userId !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "无权操作此任务",
        });
      }
      
      // 只有运行中的任务可以停止
      if (task.status !== "running" && task.status !== "pending" && task.status !== "queued") {
        return {
          success: false,
          message: "任务已完成或已停止，无法再次停止",
        };
      }
      
      // 通过全局任务队列发送 AbortSignal
      const aborted = globalTaskQueue.abortTask(input.taskId);
      
      if (aborted) {
        console.log(`[TPS v9.3] 用户 ${userId} 手动停止任务 ${input.taskId}`);
        
        // 更新数据库状态为 cancelled（数据库 enum 已支持）
        const database = await getDb();
        if (database) {
          try {
            await database.update(tpsSearchTasks).set({
              status: 'cancelled',
              completedAt: new Date(),
            }).where(eq(tpsSearchTasks.id, task.id));
          } catch (dbError: any) {
            console.error(`[TPS v9.3] cancelled 状态更新失败:`, dbError.message);
            try {
              await database.update(tpsSearchTasks).set({
                status: 'failed',
                errorMessage: '用户手动停止',
                completedAt: new Date(),
              }).where(eq(tpsSearchTasks.id, task.id));
            } catch (e) {
              console.error(`[TPS v9.3] fallback 也失败:`, (e as Error).message);
            }
          }
        }
        
        // 通知前端任务已停止
        emitTaskCompleted(userId, input.taskId, "tps", {
          totalResults: task.totalResults || 0,
          creditsUsed: parseFloat(task.creditsUsed) || 0,
          status: 'cancelled',
        });
        
        return {
          success: true,
          message: "任务已停止，已获取的结果已保存",
        };
      } else {
        return {
          success: false,
          message: "任务不在运行中，可能已完成",
        };
      }
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
  // 🛡️ BUG-FIX: 限制日志条数和消息长度，防止内存无限增长
  const MAX_LOG_ENTRIES = 200;
  const MAX_MESSAGE_LENGTH = 300;
  const addLog = (message: string) => {
    const truncatedMsg = message.length > MAX_MESSAGE_LENGTH 
      ? message.substring(0, MAX_MESSAGE_LENGTH) + '...' 
      : message;
    if (logs.length >= MAX_LOG_ENTRIES) {
      logs.shift(); // 移除最旧的日志
    }
    logs.push({ timestamp: new Date().toISOString(), message: truncatedMsg });
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
  let totalSearchPageFailed = 0;  // v9.1: 搜索页502失败总数（仅后端日志）
  let totalDetailPageFailed = 0;  // v9.1: 详情页502失败总数（仅后端日志）
  let stoppedDueToCredits = false;
  let stoppedDueToApiExhausted = false; // API 服务额度耗尽（与用户积分不足区分）
  let stoppedByUser = false; // v9.3: 用户手动停止标志（区别于积分不足）
  
  // 缓存保存函数（只保存，不读取）
  const setCachedDetails = async (items: Array<{ link: string; data: TpsDetailResult }>) => {
    const cacheDays = config.cacheDays || 180;
    await saveTpsDetailCache(items, cacheDays);
  };
  
  // 用于跨任务电话号码去重
  const seenPhones = new Set<string>();
  
  try {
    // ==================== v9.3: 分组流水线模式 ====================
    // 每 GROUP_SIZE(3) 个搜索组合为一组，每组完成搜索后立即获取详情
    // 避免大量组合时内存堆积，同时让用户更快看到结果
    
    const totalGroups = Math.ceil(subTasks.length / GROUP_SIZE);
    addLog(`📋 分组流水线模式: ${subTasks.length} 个组合, 分 ${totalGroups} 组执行 (每组 ${GROUP_SIZE} 个)`);
    
    let completedSearches = 0;
    
    // ==================== 流式保存回调（所有组共享） ====================
    const onBatchSave = async (items: BatchSaveItem[]): Promise<number> => {
      const resultsBySubTask = new Map<number, TpsDetailResult[]>();
      
      for (const { task, details } of items) {
        if (!resultsBySubTask.has(task.subTaskIndex)) {
          resultsBySubTask.set(task.subTaskIndex, []);
        }
        
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
      
      let batchSavedCount = 0;
      for (const [subTaskIndex, results] of Array.from(resultsBySubTask.entries())) {
        const subTask = subTasks.find(t => t.index === subTaskIndex);
        if (subTask && results.length > 0) {
          try {
            await saveTpsSearchResults(taskDbId, subTaskIndex, subTask.name, subTask.location, results);
            batchSavedCount += results.length;
          } catch (saveErr: any) {
            console.error(`[TPS v9.3] onBatchSave 子任务 ${subTaskIndex} 保存失败 (${results.length}条):`, saveErr.message);
          }
        }
      }
      
      totalResults += batchSavedCount;
      return batchSavedCount;
    };
    
    // ==================== 逐组执行流水线 ====================
    for (let groupIndex = 0; groupIndex < totalGroups; groupIndex++) {
      // 检查停止条件
      if (stoppedDueToCredits || stoppedDueToApiExhausted || stoppedByUser || signal?.aborted) break;
      
      const groupStart = groupIndex * GROUP_SIZE;
      const groupEnd = Math.min(groupStart + GROUP_SIZE, subTasks.length);
      const groupTasks = subTasks.slice(groupStart, groupEnd);
      
      addLog(`════════ 第 ${groupIndex + 1}/${totalGroups} 组 (${groupTasks.length} 个组合) ════════`);
      
      // ---------- 组内搜索阶段 ----------
      const groupDetailTasks: DetailTaskWithIndex[] = [];
      
      const processSearch = async (subTask: { name: string; location: string; index: number }) => {
        if (signal?.aborted) {
          stoppedByUser = true;
          return;
        }
        if (stoppedDueToCredits || creditTracker.isStopped()) {
          return;
        }
        
        const canAfford = await creditTracker.canAffordSearchPage();
        if (!canAfford) {
          stoppedDueToCredits = true;
          addLog(`⚠️ 积分不足，停止搜索`);
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
          totalSearchPageFailed += result.stats.searchPageFailed || 0;
          
          for (const searchResult of result.searchResults) {
            groupDetailTasks.push({
              searchResult,
              subTaskIndex: subTask.index,
              name: subTask.name,
              location: subTask.location,
            });
          }
          
          const taskName = subTask.location ? `${subTask.name} @ ${subTask.location}` : subTask.name;
          addLog(`✅ [${subTask.index + 1}/${subTasks.length}] ${taskName} - ${result.searchResults.length} 条结果, ${result.stats.searchPageRequests} 页成功`);
          
          if (result.apiCreditsExhausted) {
            addLog(`🚫 当前使用人数过多，服务繁忙，请联系客服处理`);
            stoppedDueToApiExhausted = true;
            stoppedDueToCredits = true;
            return;
          }
        } else {
          if (result.stats.searchPageRequests > 0) {
            for (let i = 0; i < result.stats.searchPageRequests; i++) {
              const deductResult = await creditTracker.deductSearchPage();
              if (!deductResult.success) {
                stoppedDueToCredits = true;
                break;
              }
            }
            totalSearchPages += result.stats.searchPageRequests;
            totalSearchPageFailed += result.stats.searchPageFailed || 0;
          }
          
          if (result.apiCreditsExhausted) {
            addLog(`🚫 当前使用人数过多，服务繁忙，请联系客服处理`);
            stoppedDueToApiExhausted = true;
            stoppedDueToCredits = true;
            return;
          }
          addLog(`[${subTask.index + 1}/${subTasks.length}] 未找到匹配结果`);
        }
        
        // 更新进度（搜索阶段占 0-30% 的总进度）
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
      
      // 组内并发搜索（最多 SEARCH_CONCURRENCY 个 worker）
      const runGroupSearch = async () => {
        let idx = 0;
        const runNext = async (): Promise<void> => {
          while (idx < groupTasks.length && !stoppedDueToCredits && !signal?.aborted) {
            const task = groupTasks[idx++];
            await processSearch(task);
          }
        };
        const workers = Math.min(SEARCH_CONCURRENCY, groupTasks.length);
        const workerPromises: Promise<void>[] = [];
        for (let i = 0; i < workers; i++) {
          workerPromises.push(runNext());
        }
        await Promise.all(workerPromises);
      };
      
      await runGroupSearch();
      
      // 检查停止条件
      if (stoppedDueToCredits || stoppedDueToApiExhausted || stoppedByUser || signal?.aborted) {
        // 如果搜索阶段积分耗尽或用户停止，保存已获取的搜索结果
        if (groupDetailTasks.length > 0 && totalResults === 0) {
          addLog(`📋 保存第 ${groupIndex + 1} 组搜索结果...`);
          const searchResultsBySubTask = new Map<number, TpsDetailResult[]>();
          for (const task of groupDetailTasks) {
            if (!searchResultsBySubTask.has(task.subTaskIndex)) {
              searchResultsBySubTask.set(task.subTaskIndex, []);
            }
            const locationParts = task.searchResult.location?.split(',').map(s => s.trim()) || [];
            searchResultsBySubTask.get(task.subTaskIndex)!.push({
              name: task.searchResult.name,
              age: task.searchResult.age,
              city: locationParts[0] || '',
              state: locationParts[1] || '',
              location: task.searchResult.location,
              detailLink: task.searchResult.detailLink,
            });
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
        break;
      }
      
      // ---------- 组内详情获取阶段 ----------
      if (groupDetailTasks.length > 0) {
        addLog(`📋 第 ${groupIndex + 1} 组详情获取: ${groupDetailTasks.length} 条`);
        addLog(`💰 当前余额: ${creditTracker.getCurrentBalance().toFixed(1)} 积分`);
        
        // 详情进度回调
        let lastDetailProgressPush = 0;
        const onDetailProgress = (info: DetailProgressInfo) => {
          const now = Date.now();
          if (now - lastDetailProgressPush < 2000 && info.completedDetails < info.totalDetails) return;
          lastDetailProgressPush = now;
          
          // 详情阶段进度：基于已完成的组数和当前组内进度计算
          const groupBaseProgress = 30 + Math.round((groupIndex / totalGroups) * 65);
          const groupDetailProgress = Math.round((info.percent / 100) * (65 / totalGroups));
          const detailProgress = Math.min(95, groupBaseProgress + groupDetailProgress);
          const phase = info.phase === 'retrying' ? '重试中' : '获取详情';
          
          updateTpsSearchTaskProgress(taskDbId, {
            progress: detailProgress,
            searchPageRequests: totalSearchPages,
            detailPageRequests: totalDetailPages + info.detailPageRequests,
            totalResults: totalResults + (info.totalResults || 0),
            creditsUsed: creditTracker.getTotalDeducted(),
            logs,
          }).catch(err => console.error('[TPS] 详情进度更新DB失败:', err));
          
          emitTaskProgress(userId, taskId, "tps", {
            progress: detailProgress,
            phase,
            completedDetails: info.completedDetails,
            totalDetails: info.totalDetails,
            detailPageRequests: totalDetailPages + info.detailPageRequests,
            totalResults: totalResults + (info.totalResults || 0),
            creditsUsed: creditTracker.getTotalDeducted(),
            logs,
          });
          emitCreditsUpdate(userId, { newBalance: creditTracker.getCurrentBalance(), deductedAmount: creditTracker.getTotalDeducted(), source: "tps", taskId });
        };
        
        const detailResult = await fetchDetailsWithSmartPool(
          groupDetailTasks,
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
        totalDetailPageFailed += detailResult.stats.detailPageFailed || 0;
        
        if (detailResult.stats.stoppedDueToCredits || creditTracker.isStopped()) {
          stoppedDueToCredits = true;
        }
        
        if (detailResult.stats.stoppedDueToApiCredits) {
          addLog(`🚫 当前使用人数过多，服务繁忙，任务提前结束`);
          stoppedDueToApiExhausted = true;
        }
      } else {
        addLog(`📋 第 ${groupIndex + 1} 组无详情需获取，跳过`);
      }
      
      // 🛡️ 内存优化：每组完成后释放该组的详情任务
      groupDetailTasks.length = 0;
      
      addLog(`✅ 第 ${groupIndex + 1}/${totalGroups} 组完成`);
    }
    
    // 🛡️ 内存优化：所有组完成后释放
    seenPhones.clear();
    
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
    // v9.3: 如果是用户手动停止，跳过状态更新（stopTask 已设置 cancelled 状态）
    if (stoppedByUser || signal?.aborted) {
      console.log(`[TPS v9.3] 任务被用户手动停止，跳过状态覆盖 (taskId=${taskId})`);
      // 只更新统计数据，不覆盖 cancelled 状态
      const database = await getDb();
      if (database) {
        try {
          await database.update(tpsSearchTasks).set({
            totalResults,
            searchPageRequests: totalSearchPages,
            detailPageRequests: totalDetailPages,
            cacheHits: 0,
            creditsUsed: creditTracker.getTotalDeducted().toFixed(2),
            logs,
          }).where(eq(tpsSearchTasks.id, taskDbId));
        } catch (e: any) {
          console.error(`[TPS v9.3] 手动停止后更新统计失败:`, e.message);
        }
      }
      // 发送最终的 emitTaskCompleted（带最新统计数据）
      emitTaskCompleted(userId, taskId, "tps", { totalResults, creditsUsed: creditTracker.getTotalDeducted(), status: 'cancelled' });
      recordTaskComplete(taskId, true);
      console.log(`[TPS v9.3] 用户 ${userId} 手动停止任务完成`);
      return;
    }
    
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
    
    // v9.1: 502统计汇总（仅后端日志，不推送给用户）
    console.log(`[TPS 502-Monitor] 任务汇总: taskId=${taskId}, 名字数=${input.names.length}, 搜索页总数=${totalSearchPages}, 搜索页失败=${totalSearchPageFailed}, 详情页总数=${totalDetailPages}, 详情页失败=${totalDetailPageFailed}, 最终结果=${totalResults}条`);
    if (totalSearchPageFailed > 0 || totalDetailPageFailed > 0) {
      const searchLoss = totalSearchPageFailed * 10; // 每页约10条搜索结果
      console.error(`[TPS 502-Monitor] ❗ 数据丢失估算: 搜索页失败${totalSearchPageFailed}页(约丢失${searchLoss}条搜索结果), 详情页失败${totalDetailPageFailed}条(直接丢失${totalDetailPageFailed}条详情数据)`);
    }

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
    addLog(`任务已结束，已获取的结果已保存`);
    
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
