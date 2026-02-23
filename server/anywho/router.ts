/**
 * Anywho tRPC 路由
 * 独立模块，方便后期管理和修改
 * 
 * 提供 Anywho 搜索功能的 API 端点
 * 
 * 重要更新 (2026-02-06):
 * - 改为实时扣费模式，与 SPF 保持一致
 * - 用多少扣多少，积分耗尽立即停止
 * - 保证已获取的数据完整返回给用户
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { globalTaskQueue } from "../_core/taskQueue";
import { 
  searchOnly,
  convertSearchResultToDetail,
  determineAgeRanges,
  fetchDetailsFromPages,
  fetchDetailFromPage,
  ScrapeApiCreditsError,
  AnywhoFilters, 
  AnywhoDetailResult,
  AnywhoSearchResult,
  AnywhoAgeRange,
  DetailTask,
  ANYWHO_CONFIG,
} from "./scraper";
import {
  getAnywhoConfig,
  createAnywhoSearchTask,
  updateAnywhoSearchTaskProgress,
  completeAnywhoSearchTask,
  failAnywhoSearchTask,
  saveAnywhoSearchResults,
  getAnywhoSearchTask,
  getUserAnywhoSearchTasks,
  getAnywhoSearchResults,
  getCachedAnywhoDetails,
  saveAnywhoDetailCache,
  getUserCredits,
  logApi,
} from "./db";
import { getDb, logUserActivity } from "../db";
import { anywhoSearchTasks } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { 
  createAnywhoRealtimeCreditTracker, 
  AnywhoRealtimeCreditTracker,
  formatAnywhoeCostBreakdown,
  CostBreakdown,
} from "./realtimeCredits";
import { emitTaskProgress, emitTaskCompleted, emitTaskFailed, emitCreditsUpdate } from "../_core/wsEmitter";

// 并发配置
const TOTAL_CONCURRENCY = ANYWHO_CONFIG.TOTAL_CONCURRENCY;
const SEARCH_CONCURRENCY = ANYWHO_CONFIG.TASK_CONCURRENCY;

// 输入验证 schema - 新的过滤条件
const anywhoFiltersSchema = z.object({
  minAge: z.number().min(0).max(100).optional(),      // 年龄范围 0-100
  maxAge: z.number().min(0).max(100).optional(),      // 年龄范围 0-100
  minYear: z.number().min(2020).max(2030).optional(), // 号码年份 2020-2030
  excludeDeceased: z.boolean().optional(),            // 排除已故人员
  excludeMarried: z.boolean().optional(),             // 排除已婚
  excludeTMobile: z.boolean().optional(),             // 排除 T-Mobile 号码
  excludeComcast: z.boolean().optional(),             // 排除 Comcast 号码
  excludeLandline: z.boolean().optional(),            // 排除 Landline 号码
}).optional();

const anywhoSearchInputSchema = z.object({
  names: z.array(z.string().min(1, { message: "姓名不能为空" })).min(1, { message: "请至少输入一个姓名" }).max(100, { message: "姓名数量不能超过100个" }),
  locations: z.array(z.string()).optional(),
  // 新增：独立的城市、州参数（Anywho 不支持邮编搜索）
  cities: z.array(z.string()).optional(),
  states: z.array(z.string()).optional(),
  mode: z.enum(["nameOnly", "nameLocation"]),
  filters: anywhoFiltersSchema,
});

export const anywhoRouter = router({
  // 获取 Anywho 配置（用户端）
  getConfig: protectedProcedure.query(async () => {
    const config = await getAnywhoConfig();
    return {
      searchCost: parseFloat(config.searchCost),
      detailCost: parseFloat(config.detailCost),
      maxPages: config.maxPages,
      enabled: config.enabled,
      defaultMinAge: config.defaultMinAge || 50,
      defaultMaxAge: config.defaultMaxAge || 79,
    };
  }),

  // 预估搜索消耗 - 更新：双年龄搜索，费用 x2
  estimateCost: protectedProcedure
    .input(anywhoSearchInputSchema)
    .query(async ({ input }) => {
      const config = await getAnywhoConfig();
      const searchCost = parseFloat(config.searchCost);
      const maxPages = config.maxPages || 4;
      
      // 计算子任务数
      let subTaskCount = 0;
      if (input.mode === "nameOnly") {
        subTaskCount = input.names.length;
      } else {
        const locations = input.locations || [""];
        subTaskCount = input.names.length * locations.length;
      }
      
      // 根据用户年龄过滤设置确定需要搜索的年龄段数量
      const minAge = input.filters?.minAge ?? 50;
      const maxAge = input.filters?.maxAge ?? 79;
      const ageRanges = determineAgeRanges(minAge, maxAge);
      const ageRangeCount = ageRanges.length;
      
      // 搜索页费用：子任务数 × 每任务页数 × 年龄段数量
      const maxSearchPages = subTaskCount * maxPages * ageRangeCount;
      const maxSearchCost = maxSearchPages * searchCost;
      
      // 总费用 = 只有搜索页费用
      const estimatedCost = maxSearchCost;
      
      return {
        subTaskCount,
        maxPages,
        ageRangeCount,
        ageRanges,
        maxSearchPages,
        maxSearchCost: Math.ceil(maxSearchCost * 10) / 10,
        avgDetailsPerTask: 0,  // 不再需要详情页
        estimatedDetails: 0,
        estimatedDetailCost: 0,
        estimatedCost: Math.ceil(estimatedCost * 10) / 10,
        searchCost,
        detailCost: 0,  // 不再需要详情页费用
        note: `双年龄搜索 (${ageRanges.join(', ')})，实时扣费模式`,
      };
    }),

  // 提交搜索任务 - 改为实时扣费模式
  search: protectedProcedure
    .input(anywhoSearchInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user!.id;
      
      // 检查 Anywho 是否启用
      const config = await getAnywhoConfig();
      if (!config.enabled) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Anywho 功能暂未开放",
        });
      }
      
      if (!config.scrapeDoToken) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "系统配置错误，请联系管理员",
        });
      }
      
      // 获取积分配置
      const searchCost = parseFloat(config.searchCost);
      const detailCost = parseFloat(config.detailCost || config.searchCost);
      const maxPages = config.maxPages || 4;
      
      // 计算子任务
      let subTasks: Array<{ name: string; location?: string }> = [];
      if (input.mode === "nameOnly") {
        subTasks = input.names.map(name => ({ name }));
      } else {
        const locations = input.locations || [""];
        for (const name of input.names) {
          for (const location of locations) {
            subTasks.push({ name, location });
          }
        }
      }
      
      // ==================== 实时扣费模式：只检查是否有足够积分启动 ====================
      // 检查用户是否有足够积分启动任务（至少需要一次搜索的费用）
      const userCredits = await getUserCredits(userId);
      if (userCredits < searchCost) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `积分不足，至少需要 ${searchCost} 积分启动搜索，当前余额 ${userCredits} 积分`,
        });
      }
      
      // 创建任务
      const task = await createAnywhoSearchTask({
        userId,
        mode: input.mode,
        names: input.names,
        locations: input.locations || [],
        filters: input.filters || {},
        maxPages,
      });
      
      // 更新任务状态
      await updateAnywhoSearchTaskProgress(task.taskId, {
        status: "running",
        totalSubTasks: subTasks.length,
        logs: [
          { timestamp: new Date().toISOString(), message: "任务开始执行" },
          { timestamp: new Date().toISOString(), message: `💰 实时扣费模式，当前余额 ${userCredits.toFixed(1)} 积分` },
        ],
      });
      emitTaskProgress(userId, task.taskId, "anywho", { status: "running", totalSubTasks: subTasks.length });
      
      // 记录用户活动
      await logUserActivity({
        userId,
        action: "anywho_search",
        details: `开始 Anywho 搜索任务: ${task.taskId}，实时扣费模式`
      });
      
      // 🛡️ v9.0: 通过全局任务队列提交，防止过多任务同时运行导致OOM
      const queueResult = globalTaskQueue.enqueue({
        taskDbId: task.id,
        taskId: task.taskId,
        userId,
        module: 'anywho',
        enqueuedAt: Date.now(),
        execute: async () => {
          await executeAnywhoSearchRealtime(task.taskId, task.id, userId, subTasks, input.filters || {}, config);
        },
      });
      
      return {
        taskId: task.taskId,
        message: queueResult.queued 
          ? `搜索任务已提交，当前排队位置 #${queueResult.position}，请稍候...`
          : "搜索任务已提交（实时扣费模式）",
        currentBalance: userCredits,
        queued: queueResult.queued,
        queuePosition: queueResult.position,
      };
    }),

  // 获取任务状态
  getTaskStatus: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(async ({ ctx, input }) => {
      const task = await getAnywhoSearchTask(input.taskId);
      
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
      
      return task;
    }),

  // 获取任务结果
  getTaskResults: protectedProcedure
    .input(z.object({
      taskId: z.string(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const task = await getAnywhoSearchTask(input.taskId);
      
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
      
      const results = await getAnywhoSearchResults(task.id, input.page, input.pageSize);
      return results;
    }),

  // 获取搜索历史
  getHistory: protectedProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user!.id;
      return await getUserAnywhoSearchTasks(userId, input.page, input.pageSize);
    }),

  // 导出结果为 CSV（完善详细版本）
  exportResults: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const task = await getAnywhoSearchTask(input.taskId);
      
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
      
      // 允许 failed 状态导出（失败任务可能已通过流式保存获取了部分结果）
      if (task.status !== "completed" && task.status !== "insufficient_credits" && task.status !== "service_busy" && task.status !== "failed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "任务尚未完成",
        });
      }
      
      // 获取所有结果
      const allResults: any[] = [];
      let page = 1;
      const pageSize = 100;
      
      while (true) {
        const { results, total } = await getAnywhoSearchResults(task.id, page, pageSize);
        allResults.push(...results);
        
        if (allResults.length >= total || results.length === 0) {
          break;
        }
        page++;
      }
      
      if (allResults.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "没有可导出的结果",
        });
      }
      
      // 精简版 CSV 表头（14个字段）
      const headers = [
        "序号",
        "姓名",
        "年龄",
        "地点",           // 城市, 州（合并）
        "当前住址",
        "电话",
        "电话类型",
        "运营商",        // carrier
        "婚姻状况",
        "邮箱",
        "是否已故",
        "详情链接",
        "数据来源",
        "获取时间",
      ];
      
      // 格式化电话号码（添加1前缀）
      const formatPhone = (phone: string | null | undefined): string => {
        if (!phone) return "";
        const cleaned = phone.replace(/\D/g, "");
        if (cleaned.length === 10) {
          return "1" + cleaned;
        }
        return cleaned;
      };
      
      // 生成数据行
      const rows = allResults.map((r, index) => {
        // 合并城市和州为地点
        const location = [r.city, r.state].filter(Boolean).join(", ");
        // 合并邮箱
        const emails = Array.isArray(r.emails) ? r.emails.join("; ") : (r.emails || "");
        
        return [
          index + 1,                                    // 序号
          r.name || "",                                 // 姓名
          r.age ?? "",                                  // 年龄
          location,                                     // 地点（城市, 州）
          r.currentAddress || "",                       // 当前住址
          formatPhone(r.phone),                         // 电话（加1）
          r.phoneType || "",                            // 电话类型
          r.carrier || "",                              // 运营商
          r.marriageStatus || "",                       // 婚姻状况
          emails,                                       // 邮箱
          r.isDeceased ? "是" : "否",                   // 是否已故
          r.detailLink || "",                           // 详情链接
          r.fromCache ? "缓存" : "实时获取",            // 数据来源
          r.createdAt ? new Date(r.createdAt).toLocaleString("zh-CN") : "", // 获取时间
        ];
      });
      
      // 转义 CSV 特殊字符
      const escapeCSV = (cell: any): string => {
        const str = String(cell ?? "");
        // 如果包含逗号、引号、换行符，需要用引号包裹并转义内部引号
        if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };
      
      const csv = [
        headers.map(escapeCSV).join(","),
        ...rows.map(row => row.map(escapeCSV).join(",")),
      ].join("\n");
      
      // 添加 BOM 以支持中文（Excel 兼容）
      const csvWithBom = "\uFEFF" + csv;
      
      return {
        csv: csvWithBom,
        filename: `anywho_results_${task.taskId.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.csv`,
        totalRecords: allResults.length,
      };
    }),

  // 停止任务
  stopTask: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const task = await getAnywhoSearchTask(input.taskId);
      
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
      
      if (task.status !== "running") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "只能停止运行中的任务",
        });
      }
      
      // 标记任务为取消状态
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库连接失败" });
      await db.update(anywhoSearchTasks)
        .set({ status: "cancelled" })
        .where(eq(anywhoSearchTasks.taskId, input.taskId));
      
      return { success: true, message: "任务已停止" };
    }),
});

/**
 * 异步执行搜索任务 - 实时扣费版本
 * 
 * 核心理念：用多少，扣多少，扣完即停，有始有终
 * 
 * 1. 每次 API 请求后立即扣除对应积分
 * 2. 积分不足时立即停止，保存已获取的数据
 * 3. 确保用户获得所有已付费的搜索结果
 */
async function executeAnywhoSearchRealtime(
  taskId: string,
  taskDbId: number,
  userId: number,
  subTasks: Array<{ name: string; location?: string }>,
  filters: AnywhoFilters,
  config: any
) {
  const token = config.scrapeDoToken;
  const searchCost = parseFloat(config.searchCost);
  const detailCost = parseFloat(config.detailCost || config.searchCost);
  const maxPages = config.maxPages || 4;
  
  // 创建实时积分追踪器
  const creditTracker = await createAnywhoRealtimeCreditTracker(
    userId,
    taskId,
    searchCost,
    detailCost
  );
  
  let totalResults = 0;
  let completedSubTasks = 0;
  let totalFilteredOut = 0;
  let stoppedDueToCredits = false;
  let stoppedDueToApiExhausted = false; // API 服务额度耗尽（与用户积分不足区分）
  
  const logs: Array<{ timestamp: string; message: string }> = [];
  
  const addLog = async (message: string) => {
    logs.push({ timestamp: new Date().toISOString(), message });
    await updateAnywhoSearchTaskProgress(taskId, { logs });
  };
  
  // 检查任务是否被取消
  const checkCancelled = async (): Promise<boolean> => {
    const task = await getAnywhoSearchTask(taskId);
    return task?.status === "cancelled";
  };
  
  try {
    // ==================== 启动日志 ====================
    await addLog(`═══════════════════════════════════════════════════`);
    await addLog(`🔍 开始 Anywho 搜索（实时扣费模式）`);
    await addLog(`═══════════════════════════════════════════════════`);
    
    // 显示搜索配置
    await addLog(`📋 搜索配置:`);
    const searchNames = subTasks.map(t => t.name).filter((v, i, a) => a.indexOf(v) === i);
    await addLog(`   • 搜索姓名: ${searchNames.join(', ')}`);
    const searchLocations = subTasks.map(t => t.location).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
    if (searchLocations.length > 0) {
      await addLog(`   • 搜索地点: ${searchLocations.join(', ')}`);
    }
    await addLog(`   • 搜索组合: ${subTasks.length} 个任务`);
    await addLog(`   • 每任务最大页数: ${maxPages} 页`);
    
    // 显示过滤条件
    const minAge = filters.minAge ?? 50;
    const maxAge = filters.maxAge ?? 79;
    const minYear = filters.minYear ?? 2025;
    
    // 根据用户年龄范围确定需要搜索的 Anywho 年龄段
    const ageRangesToSearch = determineAgeRanges(minAge, maxAge);
    
    await addLog(`📋 过滤条件:`);
    await addLog(`   • 年龄范围: ${minAge} - ${maxAge} 岁`);
    await addLog(`   • 号码年份: ≥ ${minYear} 年`);
    await addLog(`   • 排除已故: ${filters.excludeDeceased !== false ? '是' : '否'}`);
    if (filters.excludeMarried) await addLog(`   • 排除已婚: 是`);
    if (filters.excludeTMobile) await addLog(`   • 排除 T-Mobile: 是`);
    if (filters.excludeComcast) await addLog(`   • 排除 Comcast: 是`);
    if (filters.excludeLandline) await addLog(`   • 排除 Landline: 是`);
    
    await addLog(`💰 扣费模式: 实时扣费，用多少扣多少`);
    await addLog(`💰 当前余额: ${creditTracker.getCurrentBalance().toFixed(1)} 积分`);
    
    await addLog(`═══════════════════════════════════════════════════`);
    
    // ==================== 搜索阶段（实时扣费）====================
    
    const allSearchResults: Array<{
      searchResult: AnywhoSearchResult;
      searchName: string;
      searchLocation?: string;
      subTaskIndex: number;
    }> = [];
    
    // 顺序处理每个子任务（便于实时扣费控制）
    for (let i = 0; i < subTasks.length; i++) {
      // 检查是否取消
      if (await checkCancelled()) {
        await addLog("⚠️ 任务已被用户取消");
        break;
      }
      
      // 检查积分是否足够继续
      if (!creditTracker.canContinue()) {
        await addLog(`⚠️ 积分不足，停止搜索`);
        stoppedDueToCredits = true;
        break;
      }
      
      const subTask = subTasks[i];
      const taskName = subTask.location ? `${subTask.name} @ ${subTask.location}` : subTask.name;
      
      try {
        // 执行搜索（内部会多次请求，每次请求后扣费）
        const searchOnlyResult = await searchOnlyWithCredits(
          subTask.name,
          subTask.location,
          maxPages,
          token,
          ageRangesToSearch,
          creditTracker,
          addLog
        );
        
        const { results, pagesSearched, ageRangesSearched } = searchOnlyResult;
        
        // 检查是否因积分不足停止
        if (creditTracker.isStopped()) {
          stoppedDueToCredits = true;
        }
        
        // 检查 Scrape.do API 积分耗尽
        if (searchOnlyResult.apiCreditsExhausted) {
          await addLog(`🚫 当前使用人数过多，服务繁忙，请联系客服处理`);
          await addLog(`💡 已获取的结果已保存，如需继续请联系客服`);
          stoppedDueToApiExhausted = true;
          stoppedDueToCredits = true; // 仍用于停止后续任务的控制流
        }
        
        // 收集搜索结果
        for (const result of results) {
          allSearchResults.push({
            searchResult: result,
            searchName: subTask.name,
            searchLocation: subTask.location,
            subTaskIndex: i,
          });
        }
        
        completedSubTasks++;
        
        // 记录每个子任务的搜索结果
        await addLog(`✅ [${completedSubTasks}/${subTasks.length}] ${taskName} - ${results.length} 条结果`);
        
        // 更新进度
        const progress = Math.floor((completedSubTasks / subTasks.length) * 80);
        await updateAnywhoSearchTaskProgress(taskId, {
          progress,
          completedSubTasks,
          searchPageRequests: creditTracker.getCostBreakdown().searchPages,
          creditsUsed: creditTracker.getCostBreakdown().totalCost.toFixed(2),
        });
        emitTaskProgress(userId, taskId, "anywho", { progress, completedSubTasks, totalSubTasks: subTasks.length });
        emitCreditsUpdate(userId, { newBalance: creditTracker.getCurrentBalance(), deductedAmount: creditTracker.getCostBreakdown().totalCost, source: "anywho", taskId });
        
        // 如果因积分不足停止，跳出循环
        if (stoppedDueToCredits) {
          break;
        }
        
      } catch (error: any) {
        completedSubTasks++;
        const safeMsg = (error.message || '').includes('Scrape.do') ? '服务繁忙，请稍后重试' : error.message;
        await addLog(`❌ [${completedSubTasks}/${subTasks.length}] ${taskName} 搜索失败: ${safeMsg}`);
      }
    }
    
    // 搜索阶段完成
    if (allSearchResults.length > 0) {
      await addLog(`📊 搜索完成，正在应用过滤条件...`);
    } else {
      await addLog(`📊 搜索完成，未找到结果`);
    }
    
    // ==================== 转换并应用过滤 ====================
    
    const allResults: Array<{
      subTaskIndex: number;
      name: string;
      firstName: string;
      lastName: string;
      searchName: string;
      searchLocation?: string;
      age: number | null;
      city: string;
      state: string;
      location: string;
      currentAddress?: string;
      phone: string;
      phoneType: string;
      carrier: string;
      allPhones: string[];
      reportYear: number | null;
      isPrimary: boolean;
      marriageStatus: string | null;
      marriageRecords: string[];
      familyMembers: string[];
      emails: string[];
      isDeceased: boolean;
      detailLink: string;
      fromCache: boolean;
    }> = [];
    
    // 转换搜索结果为详情格式
    for (const item of allSearchResults) {
      const detail = convertSearchResultToDetail(item.searchResult);
      
      allResults.push({
        subTaskIndex: item.subTaskIndex,
        name: detail.name,
        firstName: detail.firstName,
        lastName: detail.lastName,
        searchName: item.searchName,
        searchLocation: item.searchLocation,
        age: detail.age,
        city: detail.city,
        state: detail.state,
        location: detail.location,
        currentAddress: detail.currentAddress,
        phone: detail.phone,
        phoneType: detail.phoneType,
        carrier: detail.carrier,
        allPhones: detail.allPhones || [],
        reportYear: detail.reportYear,
        isPrimary: true,
        marriageStatus: detail.marriageStatus,
        marriageRecords: detail.marriageRecords || [],
        familyMembers: detail.familyMembers || [],
        emails: detail.emails || [],
        isDeceased: detail.isDeceased || false,
        detailLink: item.searchResult.detailLink,
        fromCache: false,
      });
    }
    
    // 应用过滤条件
    let filteredResults = allResults;
    const initialCount = filteredResults.length;
    
    // 1. 排除已故人员（默认启用）
    if (filters.excludeDeceased !== false) {
      filteredResults = filteredResults.filter(r => !r.isDeceased);
    }
    
    // 2. 年龄过滤（默认 50-79 岁）
    const filterMinAge = filters.minAge ?? 50;
    const filterMaxAge = filters.maxAge ?? 79;
    if (filterMinAge > 0 || filterMaxAge < 100) {
      filteredResults = filteredResults.filter(r => {
        if (r.age === null || r.age === undefined) return true;
        if (r.age < filterMinAge) return false;
        if (r.age > filterMaxAge) return false;
        return true;
      });
    }
    
    // 3. 号码年份过滤（默认 2025 年）
    const filterMinYear = filters.minYear ?? 2025;
    if (filterMinYear > 2020) {
      filteredResults = filteredResults.filter(r => {
        if (!r.reportYear) return true;
        return r.reportYear >= filterMinYear;
      });
    }
    
    // 4. 排除已婚
    if (filters.excludeMarried) {
      filteredResults = filteredResults.filter(r => {
        if (!r.marriageStatus) return true;
        return r.marriageStatus.toLowerCase() !== 'married';
      });
    }
    
    // 5. 排除 T-Mobile 号码
    if (filters.excludeTMobile) {
      filteredResults = filteredResults.filter(r => {
        if (!r.carrier) return true;
        return !r.carrier.toLowerCase().includes('t-mobile') && !r.carrier.toLowerCase().includes('tmobile');
      });
    }
    
    // 6. 排除 Comcast 号码
    if (filters.excludeComcast) {
      filteredResults = filteredResults.filter(r => {
        if (!r.carrier) return true;
        const carrierLower = r.carrier.toLowerCase();
        return !carrierLower.includes('comcast') && !carrierLower.includes('spectrum') && !carrierLower.includes('xfinity');
      });
    }
    
    // 7. 排除 Landline 号码
    if (filters.excludeLandline) {
      filteredResults = filteredResults.filter(r => {
        if (!r.phoneType) return true;
        return r.phoneType.toLowerCase() !== 'landline';
      });
    }
    
    // 计算总过滤数
    totalFilteredOut = initialCount - filteredResults.length;
    
    // 过滤阶段完成日志
    if (initialCount > 0) {
      await addLog(`📊 过滤完成: ${filteredResults.length} 条符合条件，${totalFilteredOut} 条已过滤`);
    }
    
    // ==================== 详情页获取（实时扣费）====================
    
    if (filteredResults.length > 0 && creditTracker.canContinue()) {
      await addLog(`📊 正在获取详细信息...`);
      
      // 构建搜索结果映射
      const searchResultMap = new Map<string, AnywhoSearchResult>();
      for (const item of allSearchResults) {
        searchResultMap.set(item.searchResult.detailLink, item.searchResult);
      }
      
      // 批量获取详情页（带实时扣费）
      const searchResultsForDetail = filteredResults
        .map(r => searchResultMap.get(r.detailLink))
        .filter((r): r is AnywhoSearchResult => r !== undefined);
      
      const { details, requestCount, successCount, stoppedDueToCredits: detailStopped, apiCreditsExhausted: detailApiExhausted } = await fetchDetailsWithCredits(
        searchResultsForDetail,
        token,
        creditTracker,
        async (completed, total, current) => {
          const progress = 80 + Math.floor((completed / total) * 15);
          await updateAnywhoSearchTaskProgress(taskId, {
            progress,
            detailPageRequests: creditTracker.getCostBreakdown().detailPages,
            creditsUsed: creditTracker.getCostBreakdown().totalCost.toFixed(2),
          });
          emitTaskProgress(userId, taskId, "anywho", { progress });
          emitCreditsUpdate(userId, { newBalance: creditTracker.getCurrentBalance(), deductedAmount: creditTracker.getCostBreakdown().totalCost, source: "anywho", taskId });
          if (current) {
            await addLog(`\u2705 [${completed}/${total}] ${current.name} - \u5df2\u83b7\u53d6`);
          }
        },
        // v9.0: Anywho batch save - merge details into filteredResults in real-time
        async (batchDetails) => {
          for (const item of batchDetails) {
            const searchResult = searchResultsForDetail[item.globalIdx];
            if (searchResult) {
              const fr = filteredResults.find(r => r.detailLink === searchResult.detailLink);
              if (fr && item.detail) {
                fr.carrier = item.detail.carrier || fr.carrier;
                fr.phoneType = item.detail.phoneType || fr.phoneType;
                fr.marriageStatus = item.detail.marriageStatus || fr.marriageStatus;
                fr.isDeceased = item.detail.isDeceased;
                if (item.detail.allPhones && item.detail.allPhones.length > 0) {
                  fr.allPhones = item.detail.allPhones;
                }
              }
            }
          }
        }
      );
      
      // 检查是否因 Scrape.do API 积分耗尽停止
      if (detailApiExhausted) {
        await addLog(`🚫 当前使用人数过多，服务繁忙，任务提前结束`);
        await addLog(`💡 已获取的结果已保存，如需继续请联系客服`);
        stoppedDueToApiExhausted = true;
        stoppedDueToCredits = true;
      } else if (detailStopped) {
        if (!stoppedDueToCredits) {
          await addLog(`⚠️ 积分不足，停止获取详情`);
        }
        stoppedDueToCredits = true;
      }
      
      // 更新筛选结果中的详情信息
      const detailMap = new Map<string, AnywhoDetailResult>();
      for (let i = 0; i < searchResultsForDetail.length; i++) {
        const detail = details[i];
        if (detail) {
          detailMap.set(searchResultsForDetail[i].detailLink, detail);
        }
      }
      
      // 合并详情信息到筛选结果
      for (const result of filteredResults) {
        const detail = detailMap.get(result.detailLink);
        if (detail) {
          result.carrier = detail.carrier || result.carrier;
          result.phoneType = detail.phoneType || result.phoneType;
          result.marriageStatus = detail.marriageStatus || result.marriageStatus;
          result.isDeceased = detail.isDeceased;
          if (detail.allPhones && detail.allPhones.length > 0) {
            result.allPhones = detail.allPhones;
          }
        }
      }
      
      await addLog(`📊 详细信息获取完成`);
      
      // 详情页获取后再次过滤已故人员
      let detailFilteredCount = 0;
      if (filters.excludeDeceased !== false) {
        const beforeDeceasedFilter = filteredResults.length;
        filteredResults = filteredResults.filter(r => !r.isDeceased);
        const deceasedFiltered = beforeDeceasedFilter - filteredResults.length;
        if (deceasedFiltered > 0) {
          totalFilteredOut += deceasedFiltered;
          detailFilteredCount += deceasedFiltered;
        }
      }
      
      // 排除没有电话号码的记录
      {
        const beforeNoPhoneFilter = filteredResults.length;
        filteredResults = filteredResults.filter(r => {
          const hasMainPhone = r.phone && r.phone.trim() !== '';
          return hasMainPhone;
        });
        const noPhoneFiltered = beforeNoPhoneFilter - filteredResults.length;
        if (noPhoneFiltered > 0) {
          totalFilteredOut += noPhoneFiltered;
          detailFilteredCount += noPhoneFiltered;
        }
      }
      
      // v8.2: 详情阶段二次过滤说明日志
      if (detailFilteredCount > 0) {
        await addLog(`📊 详情阶段二次过滤: ${detailFilteredCount} 条被移除（已故/无电话），剩余 ${filteredResults.length} 条`);
      }
    }
    
    totalResults = filteredResults.length;
    
    // ==================== 保存结果 ====================
    if (filteredResults.length > 0) {
      console.log(`[saveResults] 保存 ${filteredResults.length} 条结果到任务 taskDbId=${taskDbId}`);
      await saveAnywhoSearchResults(taskDbId, filteredResults);
      console.log(`[saveResults] 保存完成`);
    }
    
    // ==================== 完成任务 ====================
    const breakdown = creditTracker.getCostBreakdown();
    
    // 根据停止原因设置不同的任务状态
    const finalStatus = stoppedDueToApiExhausted ? "service_busy" : (stoppedDueToCredits ? "insufficient_credits" : "completed");
    if (stoppedDueToApiExhausted || stoppedDueToCredits) {
      // API 耗尽或积分不足停止，但保存已获取的数据
      await updateAnywhoSearchTaskProgress(taskId, {
        status: finalStatus,
        progress: 100,
        totalResults,
        creditsUsed: breakdown.totalCost.toFixed(2),
        searchPageRequests: breakdown.searchPages,
        detailPageRequests: breakdown.detailPages,
      });
    } else {
      // 正常完成
      await completeAnywhoSearchTask(taskId, {
        totalResults,
        creditsUsed: breakdown.totalCost.toFixed(2),
        searchPageRequests: breakdown.searchPages,
        detailPageRequests: breakdown.detailPages,
        cacheHits: 0,
      });
    }
    emitTaskCompleted(userId, taskId, "anywho", { totalResults, creditsUsed: breakdown.totalCost, status: finalStatus });
    
    // ==================== 完成日志（统一专业版） ====================
    const costLines = formatAnywhoeCostBreakdown(
      breakdown,
      creditTracker.getCurrentBalance(),
      totalResults,
      stoppedDueToCredits,
      stoppedDueToApiExhausted
    );
    for (const line of costLines) {
      await addLog(line);
    }
    
  } catch (error: any) {
    console.error(`[Anywho] 任务 ${taskId} 执行失败:`, error);
    
    try {
      const breakdown = creditTracker.getCostBreakdown();
      const safeErrMsg = (error.message || '').includes('Scrape.do') ? '服务繁忙，请稍后重试' : (error.message || '未知错误');
      await failAnywhoSearchTask(taskId, safeErrMsg);
      emitTaskFailed(userId, taskId, "anywho", { error: safeErrMsg, creditsUsed: breakdown.totalCost });
      await addLog(`❌ 搜索任务失败: ${safeErrMsg}`);
      await addLog(`💰 已消耗: ${breakdown.totalCost.toFixed(1)} 积分`);
      await addLog(`💰 当前余额: ${creditTracker.getCurrentBalance().toFixed(1)} 积分`);
    } catch (cleanupError: any) {
      console.error(`[Anywho] 任务 ${taskId} 失败清理时也出错:`, cleanupError.message);
    }
  }
}

/**
 * 带实时扣费的搜索函数
 * 每次 API 请求后立即扣除积分
 */
async function searchOnlyWithCredits(
  name: string,
  location: string | undefined,
  maxPages: number,
  token: string,
  ageRanges: AnywhoAgeRange[],
  creditTracker: AnywhoRealtimeCreditTracker,
  addLog: (msg: string) => Promise<void>
): Promise<{
  results: AnywhoSearchResult[];
  pagesSearched: number;
  ageRangesSearched: AnywhoAgeRange[];
  apiCreditsExhausted?: boolean;
}> {
  const allResults: AnywhoSearchResult[] = [];
  let totalPagesSearched = 0;
  const searchedAgeRanges: AnywhoAgeRange[] = [];
  
  // 对每个年龄段进行搜索
  for (const ageRange of ageRanges) {
    // 检查是否可以继续
    if (!creditTracker.canContinue()) {
      break;
    }
    
    // 检查是否有足够积分进行搜索
    if (!(await creditTracker.canAffordSearchPage())) {
      break;
    }
    
    try {
      // 执行搜索（这里调用原始的 searchOnly，但我们需要在每页后扣费）
      // 由于 searchOnly 内部会处理分页，我们需要修改逻辑
      // 这里简化处理：假设每次搜索消耗一定的页数
      const searchResult = await searchOnly(
        name,
        location,
        maxPages,
        token,
        [ageRange]
      );
      
      const { results, pagesSearched } = searchResult;
      
      // 实时扣除搜索页费用
      for (let i = 0; i < pagesSearched; i++) {
        const deductResult = await creditTracker.deductSearchPage();
        if (!deductResult.success) {
          // 积分不足，停止
          break;
        }
      }
      
      allResults.push(...results);
      totalPagesSearched += pagesSearched;
      searchedAgeRanges.push(ageRange);
      
      // 检查 API 积分耗尽
      if (searchResult.apiCreditsExhausted) {
        await addLog(`🚫 当前使用人数过多，服务繁忙，请联系客服处理`);
        const uniqueResults = allResults.filter((result, index, self) =>
          index === self.findIndex(r => r.detailLink === result.detailLink)
        );
        return {
          results: uniqueResults,
          pagesSearched: totalPagesSearched,
          ageRangesSearched: searchedAgeRanges,
          apiCreditsExhausted: true,
        };
      }
      
    } catch (error: any) {
      console.error(`[Anywho] 搜索 ${name} (${ageRange}) 失败:`, error.message);
    }
  }
  
  // 去重
  const uniqueResults = allResults.filter((result, index, self) =>
    index === self.findIndex(r => r.detailLink === result.detailLink)
  );
  
  return {
    results: uniqueResults,
    pagesSearched: totalPagesSearched,
    ageRangesSearched: searchedAgeRanges,
  };
}

// ==================== Anywho 详情获取分批配置 ====================
const ANYWHO_DETAIL_BATCH_CONFIG = {
  BATCH_SIZE: 5,           // 每批并发数（Anywho详情页需render+customWait，单请求慢，5并发合理）
  BATCH_DELAY_MS: 800,     // 批间延迟(ms)
  RETRY_BATCH_SIZE: 3,     // 重试批大小
  RETRY_BATCH_DELAY_MS: 1500, // 重试批间延迟(ms)
  RETRY_WAIT_MS: 3000,     // 重试前等待(ms)
};

/**
 * 带实时扣费的详情页获取函数（v2 分批并行模式）
 * 
 * 改造自串行逐条模式，借鉴 TPS v8.0 的"分批+延迟"架构：
 * - 每批 BATCH_SIZE 个请求并行发出
 * - 批间等待 BATCH_DELAY_MS
 * - 失败的链接延后统一重试
 * - 每条成功的详情实时扣费并推送进度
 */
async function fetchDetailsWithCredits(
  searchResults: AnywhoSearchResult[],
  token: string,
  creditTracker: AnywhoRealtimeCreditTracker,
  onProgress?: (completed: number, total: number, current?: AnywhoDetailResult) => Promise<void>,
  /** 🛡️ v9.0: 流式保存回调 - 每批结果立即保存到数据库 */
  onBatchSave?: (batchDetails: Array<{ globalIdx: number; detail: AnywhoDetailResult }>) => Promise<void>
): Promise<{
  details: (AnywhoDetailResult | null)[];
  requestCount: number;
  successCount: number;
  stoppedDueToCredits: boolean;
  apiCreditsExhausted: boolean;
}> {
  const { BATCH_SIZE, BATCH_DELAY_MS, RETRY_BATCH_SIZE, RETRY_BATCH_DELAY_MS, RETRY_WAIT_MS } = ANYWHO_DETAIL_BATCH_CONFIG;
  
  // 结果数组，与 searchResults 一一对应
  const details: (AnywhoDetailResult | null)[] = new Array(searchResults.length).fill(null);
  let requestCount = 0;
  let successCount = 0;
  let stoppedDueToCredits = false;
  let apiCreditsExhausted = false;
  let completedCount = 0; // 已处理的总数（成功+失败）
  
  // 记录失败的索引，用于延后重试
  const failedIndices: number[] = [];
  
  // ==================== 第一轮：分批并行获取 ====================
  const totalBatches = Math.ceil(searchResults.length / BATCH_SIZE);
  
  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    // 积分检查
    if (stoppedDueToCredits || !creditTracker.canContinue() || !(await creditTracker.canAffordDetailPage())) {
      stoppedDueToCredits = true;
      break;
    }
    
    const startIdx = batchIdx * BATCH_SIZE;
    const endIdx = Math.min(startIdx + BATCH_SIZE, searchResults.length);
    const batchItems = searchResults.slice(startIdx, endIdx);
    
    // 并行发出本批请求
    
    const batchPromises = batchItems.map(async (searchResult, localIdx) => {
      const globalIdx = startIdx + localIdx;
      try {
        const { detail, success } = await fetchDetailFromPage(
          searchResult.detailLink,
          token,
          searchResult,
          undefined
        );
        return { globalIdx, detail, success, error: false, isApiCreditsError: false };
      } catch (error: any) {
        const isApiCreditsError = error instanceof ScrapeApiCreditsError;
        if (!isApiCreditsError) {
          console.error(`[Anywho] 获取详情失败 [${globalIdx}]:`, error.message);
        }
        return { globalIdx, detail: null, success: false, error: true, isApiCreditsError };
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    // 检查本批是否有 API 积分耗尽错误
    if (batchResults.some(r => r.isApiCreditsError)) {
      apiCreditsExhausted = true;
      console.error(`[Anywho] Scrape.do API 积分耗尽，停止详情获取`);
    }
    
    // 处理本批结果
    for (const result of batchResults) {
      // 积分不足时立即停止处理后续结果，避免保存未付费的数据
      if (stoppedDueToCredits) break;
      
      requestCount++;
      completedCount++;
      
      if (result.detail && result.success) {
        // 先扣费，成功后才保存结果
        const deductResult = await creditTracker.deductDetailPage();
        if (!deductResult.success) {
          stoppedDueToCredits = true;
          break;
        }
        details[result.globalIdx] = result.detail;
        successCount++;
      } else if (result.error) {
        // API 积分耗尽的不加入重试队列
        if (!result.isApiCreditsError) {
          failedIndices.push(result.globalIdx);
        }
      } else if (result.detail && !result.success) {
        // fetchDetailFromPage返回了fallback数据（success=false但detail不为null）
        // 先扣费，成功后才保存结果
        const deductResult = await creditTracker.deductDetailPage();
        if (!deductResult.success) {
          stoppedDueToCredits = true;
          break;
        }
        details[result.globalIdx] = result.detail;
        successCount++;
      }
      
      // 进度回调
      if (onProgress) {
        await onProgress(completedCount, searchResults.length, result.detail || undefined);
      }
    }
    
    if (stoppedDueToCredits || apiCreditsExhausted) break;
    
    // 🛡️ v9.0: 流式保存 - 每批处理完后立即保存到数据库
    if (onBatchSave) {
      const batchSaveItems: Array<{ globalIdx: number; detail: AnywhoDetailResult }> = [];
      for (let i = startIdx; i < endIdx && i < details.length; i++) {
        if (details[i]) {
          batchSaveItems.push({ globalIdx: i, detail: details[i]! });
          details[i] = null; // 释放内存，已保存到数据库
        }
      }
      if (batchSaveItems.length > 0) {
        try {
          await onBatchSave(batchSaveItems);
        } catch (err: any) {
          console.error('[Anywho] 流式保存失败:', err.message);
        }
      }
    }
    
    // 批间延迟
    if (batchIdx < totalBatches - 1) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  
  // ==================== 第二轮：延后重试失败的请求 ====================
  // API 积分耗尽时跳过重试
  if (failedIndices.length > 0 && !stoppedDueToCredits && !apiCreditsExhausted) {
    console.log(`[Anywho] 延后重试 ${failedIndices.length} 个失败请求`);
    await new Promise(resolve => setTimeout(resolve, RETRY_WAIT_MS));
    
    const retryBatches = Math.ceil(failedIndices.length / RETRY_BATCH_SIZE);
    
    for (let retryBatchIdx = 0; retryBatchIdx < retryBatches; retryBatchIdx++) {
      if (stoppedDueToCredits || !creditTracker.canContinue() || !(await creditTracker.canAffordDetailPage())) {
        stoppedDueToCredits = true;
        break;
      }
      
      const retryStart = retryBatchIdx * RETRY_BATCH_SIZE;
      const retryEnd = Math.min(retryStart + RETRY_BATCH_SIZE, failedIndices.length);
      const retryItems = failedIndices.slice(retryStart, retryEnd);
      
      const retryPromises = retryItems.map(async (globalIdx) => {
        try {
          const { detail, success } = await fetchDetailFromPage(
            searchResults[globalIdx].detailLink,
            token,
            searchResults[globalIdx],
            undefined
          );
          return { globalIdx, detail, success };
        } catch (error: any) {
          console.error(`[Anywho] 重试获取详情失败 [${globalIdx}]:`, error.message);
          return { globalIdx, detail: null, success: false };
        }
      });
      
      const retryResults = await Promise.all(retryPromises);
      
      for (const result of retryResults) {
        // 积分不足时立即停止处理后续结果
        if (stoppedDueToCredits) break;
        
        requestCount++;
        
        if (result.detail) {
          // 先扣费，成功后才保存结果
          const deductResult = await creditTracker.deductDetailPage();
          if (!deductResult.success) {
            stoppedDueToCredits = true;
            break;
          }
          details[result.globalIdx] = result.detail;
          if (result.success) successCount++;
        }
      }
      
      if (stoppedDueToCredits) break;
      
      // 🛡️ v9.0: 重试阶段也流式保存
      if (onBatchSave) {
        const retrySaveItems: Array<{ globalIdx: number; detail: AnywhoDetailResult }> = [];
        for (const idx of retryItems) {
          if (details[idx]) {
            retrySaveItems.push({ globalIdx: idx, detail: details[idx]! });
            details[idx] = null;
          }
        }
        if (retrySaveItems.length > 0) {
          try {
            await onBatchSave(retrySaveItems);
          } catch (err: any) {
            console.error('[Anywho] 重试流式保存失败:', err.message);
          }
        }
      }
      
      // 重试批间延迟
      if (retryBatchIdx < retryBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_BATCH_DELAY_MS));
      }
    }
  }
  
  return {
    details,
    requestCount,
    successCount,
    stoppedDueToCredits,
    apiCreditsExhausted,
  };
}
