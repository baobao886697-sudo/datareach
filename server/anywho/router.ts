/**
 * Anywho tRPC 路由
 * 独立模块，方便后期管理和修改
 * 
 * 提供 Anywho 搜索功能的 API 端点
 * 
 * 重要更新 (2026-01-26):
 * - 直接从搜索结果页提取完整数据，避免访问详情页被 CAPTCHA 阻止
 * - 大幅减少 API 请求数量和费用（只需搜索页请求）
 * - 保留过滤功能：年龄、已故、已婚、运营商等
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { 
  searchOnly,
  convertSearchResultToDetail,
  determineAgeRanges,
  fetchDetailsFromPages,
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
  deductCredits,
  getUserCredits,
  freezeCreditsAnywho,
  settleCreditsAnywho,
  logApi,
} from "./db";
import { getDb, logUserActivity } from "../db";
import { anywhoSearchTasks } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

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
  names: z.array(z.string().min(1)).min(1).max(100),
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
        note: `双年龄搜索 (${ageRanges.join(', ')})，直接从搜索结果页提取数据`,
      };
    }),

  // 提交搜索任务
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
      
      // 根据用户年龄过滤设置确定需要搜索的年龄段数量
      const minAge = input.filters?.minAge ?? 50;
      const maxAge = input.filters?.maxAge ?? 79;
      const ageRanges = determineAgeRanges(minAge, maxAge);
      const ageRangeCount = ageRanges.length;
      
      // ==================== 预扣费机制：计算最大预估费用 ====================
      // 搜索页费用：子任务数 × 每任务最大页数 × 年龄段数量 × 单价
      const maxSearchPages = subTasks.length * maxPages * ageRangeCount;
      const maxSearchCost = maxSearchPages * searchCost;
      // 详情页费用：预估每个搜索结果都需要获取详情（保守估计）
      const estimatedResults = subTasks.length * 10 * ageRangeCount; // 每个子任务预估10条结果
      const maxDetailCost = estimatedResults * detailCost;
      // 总预估费用
      const maxEstimatedCost = maxSearchCost + maxDetailCost;
      
      // 检查用户积分是否足够预扣
      const userCredits = await getUserCredits(userId);
      if (userCredits < maxEstimatedCost) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `积分不足，预估最大消耗 ${maxEstimatedCost.toFixed(1)} 积分，当前余额 ${userCredits} 积分`,
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
      
      // ==================== 预扣费机制：执行预扣 ====================
      const freezeResult = await freezeCreditsAnywho(userId, maxEstimatedCost, task.taskId);
      if (!freezeResult.success) {
        // 预扣失败，更新任务状态并抛出错误
        await updateAnywhoSearchTaskProgress(task.taskId, {
          status: "insufficient_credits",
          logs: [{ timestamp: new Date().toISOString(), message: `积分不足: ${freezeResult.message}` }],
        });
        throw new TRPCError({
          code: "FORBIDDEN",
          message: freezeResult.message,
        });
      }
      
      // 更新任务状态
      await updateAnywhoSearchTaskProgress(task.taskId, {
        status: "running",
        totalSubTasks: subTasks.length,
        logs: [
          { timestamp: new Date().toISOString(), message: "任务开始执行" },
          { timestamp: new Date().toISOString(), message: `✅ 已预扣 ${freezeResult.frozenAmount.toFixed(1)} 积分，余额 ${freezeResult.balanceAfter.toFixed(1)} 积分` },
        ],
      });
      
      // 记录用户活动
      await logUserActivity({
        userId,
        action: "anywho_search",
        details: `开始 Anywho 搜索任务: ${task.taskId}，预扣 ${freezeResult.frozenAmount.toFixed(1)} 积分`
      });
      
      // 异步执行搜索（传递预扣金额）
      executeAnywhoSearch(task.taskId, task.id, userId, subTasks, input.filters || {}, config, freezeResult.frozenAmount);
      
      return {
        taskId: task.taskId,
        message: "搜索任务已提交",
        frozenCredits: freezeResult.frozenAmount,
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
      
      if (task.status !== "completed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "任务未完成，无法导出",
        });
      }
      
      // 获取所有结果
      const allResults: any[] = [];
      let page = 1;
      const pageSize = 1000;
      
      console.log(`[exportResults] 开始导出任务 ${input.taskId}, task.id=${task.id}`);
      
      while (true) {
        const { results, total } = await getAnywhoSearchResults(task.id, page, pageSize);
        console.log(`[exportResults] 获取第 ${page} 页, 结果数=${results.length}, 总数=${total}`);
        allResults.push(...results);
        
        if (allResults.length >= total) break;
        page++;
      }
      
      console.log(`[exportResults] 总共获取 ${allResults.length} 条结果`);
      
      // CSV 表头
      const headers = [
        "序号",
        "姓名",
        "名",
        "姓",
        "年龄",
        "婚姻状况",
        "城市",
        "州",
        "完整地址",
        "当前住址",
        "主号码",
        "主号码标识",
        "电话类型",
        "运营商",
        "邮箱",
        "是否已故",
        "详情链接",
        "搜索姓名",
        "数据来源",
        "获取时间",
      ];
      
      const rows = allResults.map((r, index) => {
        // 格式化邮箱
        const emails = r.emails ? (Array.isArray(r.emails) ? r.emails.join("; ") : r.emails) : "";
        
        // 格式化电话号码（加美国国际区号 1）
        const formatPhone = (phone: string | null | undefined): string => {
          if (!phone) return "";
          // 移除所有非数字字符
          const cleanPhone = phone.replace(/\D/g, "");
          // 如果已经以 1 开头且长度为 11 位，则不重复添加
          if (cleanPhone.startsWith("1") && cleanPhone.length === 11) {
            return cleanPhone;
          }
          // 否则在前面加 1
          return cleanPhone ? "1" + cleanPhone : "";
        };
        
        return [
          index + 1,                                    // 序号
          r.name || "",                                 // 姓名
          r.firstName || "",                            // 名
          r.lastName || "",                             // 姓
          r.age || "",                                  // 年龄
          r.marriageStatus || "",                       // 婚姻状况
          r.city || "",                                 // 城市
          r.state || "",                                // 州
          r.location || "",                             // 完整地址
          r.currentAddress || "",                       // 当前住址
          formatPhone(r.phone),                         // 主号码（加1）
          r.isPrimary ? "是" : "否",                    // 主号码标识
          r.phoneType || "",                            // 电话类型
          r.carrier || "",                              // 运营商
          emails,                                       // 邮箱
          r.isDeceased ? "是" : "否",                   // 是否已故
          r.detailLink || "",                           // 详情链接
          r.searchName || "",                           // 搜索姓名
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
 * 异步执行搜索任务 - 新版本
 * 直接从搜索结果页提取数据，不访问详情页
 * 
 * @param frozenAmount 预扣积分金额，用于任务完成后结算
 */
async function executeAnywhoSearch(
  taskId: string,
  taskDbId: number,
  userId: number,
  subTasks: Array<{ name: string; location?: string }>,
  filters: AnywhoFilters,
  config: any,
  frozenAmount: number = 0
) {
  const token = config.scrapeDoToken;
  const searchCost = parseFloat(config.searchCost);
  const detailCost = parseFloat(config.detailCost || config.searchCost);
  const maxPages = config.maxPages || 4;
  
  let totalSearchPages = 0;
  let totalResults = 0;
  let completedSubTasks = 0;
  let totalFilteredOut = 0;  // 过滤掉的记录数
  
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
    await addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    await addLog(`🔍 开始搜索`);
    await addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
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
    
    // 显示预估费用（双年龄搜索）
    const estimatedSearchPages = subTasks.length * maxPages * ageRangesToSearch.length;
    const estimatedSearchCost = estimatedSearchPages * searchCost;
    
    await addLog(`💰 费用预估:`);
    await addLog(`   • 预估最大费用: ~${estimatedSearchCost.toFixed(1)} 积分`);
    
    await addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    // ==================== 双年龄搜索并提取数据 ====================
    
    const allSearchResults: Array<{
      searchResult: AnywhoSearchResult;
      searchName: string;
      searchLocation?: string;
      subTaskIndex: number;
    }> = [];
    
    // Worker 池模式并发搜索（参考 TPS 高效实现）
    // 4 个 worker 持续从队列获取任务，任务完成后立即获取下一个
    const searchQueue = subTasks.map((task, index) => ({ ...task, index }));
    let currentSearchIndex = 0;
    
    const processSearch = async (subTask: { name: string; location?: string; index: number }) => {
      const taskName = subTask.location ? `${subTask.name} @ ${subTask.location}` : subTask.name;
      
      try {
        // 使用双年龄搜索
        const { results, pagesSearched, ageRangesSearched } = await searchOnly(
          subTask.name,
          subTask.location,
          maxPages,
          token,
          ageRangesToSearch  // 传入需要搜索的年龄段
        );
        
        totalSearchPages += pagesSearched;
        
        // 收集搜索结果
        for (const result of results) {
          allSearchResults.push({
            searchResult: result,
            searchName: subTask.name,
            searchLocation: subTask.location,
            subTaskIndex: subTask.index,
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
          searchPageRequests: totalSearchPages,
        });
        
        return { success: true, count: results.length };
      } catch (error: any) {
        completedSubTasks++;
        await addLog(`❌ [${completedSubTasks}/${subTasks.length}] ${taskName} 搜索失败: ${error.message}`);
        return { success: false, count: 0 };
      }
    };
    
    // Worker 池：4 个 worker 持续运行
    const runConcurrentSearches = async () => {
      const runWorker = async (): Promise<void> => {
        while (currentSearchIndex < searchQueue.length) {
          // 检查是否取消
          if (await checkCancelled()) {
            return;
          }
          
          const task = searchQueue[currentSearchIndex++];
          if (task) {
            await processSearch(task);
          }
        }
      };
      
      // 启动 4 个 worker
      const workers = Math.min(SEARCH_CONCURRENCY, searchQueue.length);
      const workerPromises: Promise<void>[] = [];
      for (let i = 0; i < workers; i++) {
        workerPromises.push(runWorker());
      }
      
      await Promise.all(workerPromises);
    };
    
    await runConcurrentSearches();
    
    // 检查是否被取消
    if (await checkCancelled()) {
      await addLog("任务已被用户取消");
      return;
    }
    
    // 搜索阶段完成
    await addLog(`📊 搜索完成，正在应用过滤条件...`);
    
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
    let filteredDeceased = 0;
    let filteredAge = 0;
    let filteredYear = 0;
    let filteredMarried = 0;
    let filteredTMobile = 0;
    let filteredComcast = 0;
    let filteredLandline = 0;
    
    // 1. 排除已故人员（默认启用）
    if (filters.excludeDeceased !== false) {
      const beforeCount = filteredResults.length;
      filteredResults = filteredResults.filter(r => !r.isDeceased);
      filteredDeceased = beforeCount - filteredResults.length;
    }
    
    // 2. 年龄过滤（默认 50-79 岁）
    const filterMinAge = filters.minAge ?? 50;
    const filterMaxAge = filters.maxAge ?? 79;
    if (filterMinAge > 0 || filterMaxAge < 100) {
      const beforeCount = filteredResults.length;
      filteredResults = filteredResults.filter(r => {
        if (r.age === null || r.age === undefined) return true;
        if (r.age < filterMinAge) return false;
        if (r.age > filterMaxAge) return false;
        return true;
      });
      filteredAge = beforeCount - filteredResults.length;
    }
    
    // 3. 号码年份过滤（默认 2025 年）
    const filterMinYear = filters.minYear ?? 2025;
    if (filterMinYear > 2020) {
      const beforeCount = filteredResults.length;
      filteredResults = filteredResults.filter(r => {
        if (!r.reportYear) return true;
        return r.reportYear >= filterMinYear;
      });
      filteredYear = beforeCount - filteredResults.length;
    }
    
    // 4. 排除已婚
    if (filters.excludeMarried) {
      const beforeCount = filteredResults.length;
      filteredResults = filteredResults.filter(r => {
        if (!r.marriageStatus) return true;
        return r.marriageStatus.toLowerCase() !== 'married';
      });
      filteredMarried = beforeCount - filteredResults.length;
    }
    
    // 5. 排除 T-Mobile 号码
    if (filters.excludeTMobile) {
      const beforeCount = filteredResults.length;
      filteredResults = filteredResults.filter(r => {
        if (!r.carrier) return true;
        return !r.carrier.toLowerCase().includes('t-mobile') && !r.carrier.toLowerCase().includes('tmobile');
      });
      filteredTMobile = beforeCount - filteredResults.length;
    }
    
    // 6. 排除 Comcast 号码
    if (filters.excludeComcast) {
      const beforeCount = filteredResults.length;
      filteredResults = filteredResults.filter(r => {
        if (!r.carrier) return true;
        const carrierLower = r.carrier.toLowerCase();
        return !carrierLower.includes('comcast') && !carrierLower.includes('spectrum') && !carrierLower.includes('xfinity');
      });
      filteredComcast = beforeCount - filteredResults.length;
    }
    
    // 7. 排除 Landline 号码
    if (filters.excludeLandline) {
      const beforeCount = filteredResults.length;
      filteredResults = filteredResults.filter(r => {
        if (!r.phoneType) return true;
        return r.phoneType.toLowerCase() !== 'landline';
      });
      filteredLandline = beforeCount - filteredResults.length;
    }
    
    // 计算总过滤数
    totalFilteredOut = initialCount - filteredResults.length;
    
    // 过滤阶段完成日志
    await addLog(`📊 过滤完成: ${filteredResults.length} 条符合条件，${totalFilteredOut} 条已过滤`);
    
    // ==================== 混合模式：获取详情页完整信息 ====================
    let totalDetailPages = 0;
    let detailSuccessCount = 0;
    
    if (filteredResults.length > 0) {
      await addLog(`📊 正在获取详细信息...`);
      
      // 构建搜索结果映射
      const searchResultMap = new Map<string, AnywhoSearchResult>();
      for (const item of allSearchResults) {
        searchResultMap.set(item.searchResult.detailLink, item.searchResult);
      }
      
      // 批量获取详情页
      const searchResultsForDetail = filteredResults
        .map(r => searchResultMap.get(r.detailLink))
        .filter((r): r is AnywhoSearchResult => r !== undefined);
      
      const { details, requestCount, successCount } = await fetchDetailsFromPages(
        searchResultsForDetail,
        token,
        25,  // 并发数（保守优化模式）
        async (completed, total, current) => {
          const progress = 80 + Math.floor((completed / total) * 15);  // 详情页占 15% 进度
          await updateAnywhoSearchTaskProgress(taskId, {
            progress,
            detailPageRequests: completed,
          });
          if (current) {
            await addLog(`✅ [${completed}/${total}] ${current.name} - 已获取`);
          }
        },
        (msg) => addLog(msg)
      );
      
      totalDetailPages = requestCount;
      detailSuccessCount = successCount;
      
      // 更新筛选结果中的详情信息
      const detailMap = new Map<string, AnywhoDetailResult>();
      for (let i = 0; i < searchResultsForDetail.length; i++) {
        if (details[i]) {
          detailMap.set(searchResultsForDetail[i].detailLink, details[i]);
        }
      }
      
      // 合并详情信息到筛选结果
      // 信任搜索页的号码作为主号码，详情页提供补充信息
      for (const result of filteredResults) {
        const detail = detailMap.get(result.detailLink);
        if (detail) {
          // 保留搜索页的号码作为主号码，不替换
          // 从详情页获取运营商和电话类型信息
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
      
      // ==================== 详情页获取后再次过滤已故人员 ====================
      if (filters.excludeDeceased !== false) {
        const beforeDeceasedFilter = filteredResults.length;
        filteredResults = filteredResults.filter(r => !r.isDeceased);
        const deceasedFiltered = beforeDeceasedFilter - filteredResults.length;
        if (deceasedFiltered > 0) {
          // 已故过滤完成，不显示日志
          totalFilteredOut += deceasedFiltered;
        }
      }
      
      // ==================== 排除没有电话号码的记录 ====================
      {
        const beforeNoPhoneFilter = filteredResults.length;
        filteredResults = filteredResults.filter(r => {
          // 只保留有主号码的记录，确保 CSV 导出的每条记录都有电话号码
          // 主号码是经过智能选择的最佳号码（优先 Mobile + 地址匹配）
          const hasMainPhone = r.phone && r.phone.trim() !== '';
          return hasMainPhone;
        });
        const noPhoneFiltered = beforeNoPhoneFilter - filteredResults.length;
        if (noPhoneFiltered > 0) {
          // 无电话过滤完成，不显示日志
          totalFilteredOut += noPhoneFiltered;
        }
      }
    }
    
    totalResults = filteredResults.length;
    
    // 保存结果
    if (filteredResults.length > 0) {
      console.log(`[saveResults] 保存 ${filteredResults.length} 条结果到任务 taskDbId=${taskDbId}`);
      await saveAnywhoSearchResults(taskDbId, filteredResults);
      console.log(`[saveResults] 保存完成`);
    } else {
      console.log(`[saveResults] 没有结果需要保存, filteredResults.length=${filteredResults.length}`);
    }
    
    // ==================== 预扣费机制：计算实际消耗并结算 ====================
    const creditsUsed = (totalSearchPages * searchCost) + (totalDetailPages * detailCost);
    
    // 结算退还多扣的积分
    const settlement = await settleCreditsAnywho(userId, frozenAmount, creditsUsed, taskId);
    
    // 完成任务
    await completeAnywhoSearchTask(taskId, {
      totalResults,
      creditsUsed: creditsUsed.toFixed(2),
      searchPageRequests: totalSearchPages,
      detailPageRequests: totalDetailPages,
      cacheHits: 0,
    });
    
    // ==================== 完成日志 ====================
    await addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    await addLog(`🎉 搜索完成!`);
    await addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    // 搜索结果摘要
    await addLog(`📊 搜索结果:`);
    await addLog(`   • 有效结果: ${totalResults} 条联系人`);
    await addLog(`   • 已过滤: ${totalFilteredOut} 条`);
    
    // 费用明细（预扣费机制）
    const searchCredits = totalSearchPages * searchCost;
    const detailCredits = totalDetailPages * detailCost;
    
    await addLog(`💰 费用结算:`);
    await addLog(`   • 预扣积分: ${frozenAmount.toFixed(1)} 积分`);
    await addLog(`   • 搜索费用: ${searchCredits.toFixed(1)} 积分`);
    await addLog(`   • 详情费用: ${detailCredits.toFixed(1)} 积分`);
    await addLog(`   ──────────────────────────────`);
    await addLog(`   • 实际消耗: ${creditsUsed.toFixed(1)} 积分`);
    if (settlement.refundAmount > 0) {
      await addLog(`   • ✅ 已退还: ${settlement.refundAmount.toFixed(1)} 积分`);
    }
    await addLog(`   • 当前余额: ${settlement.newBalance.toFixed(1)} 积分`);
    if (totalResults > 0) {
      const costPerResult = creditsUsed / totalResults;
      await addLog(`   • 每条成本: ${costPerResult.toFixed(2)} 积分`);
    }
    await addLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
  } catch (error: any) {
    console.error(`[Anywho] 任务 ${taskId} 执行失败:`, error);
    
    // ==================== 预扣费机制：失败时结算退还 ====================
    // 计算已消耗的积分（搜索页 + 详情页）
    const actualCost = (totalSearchPages * searchCost) + (totalDetailPages * detailCost);
    const settlement = await settleCreditsAnywho(userId, frozenAmount, actualCost, taskId);
    
    await failAnywhoSearchTask(taskId, error.message || "未知错误");
    await addLog(`❗ 搜索失败: ${error.message}`);
    await addLog(`💰 失败结算:`);
    await addLog(`   • 预扣积分: ${frozenAmount.toFixed(1)} 积分`);
    await addLog(`   • 已消耗: ${actualCost.toFixed(1)} 积分`);
    if (settlement.refundAmount > 0) {
      await addLog(`   • ✅ 已退还: ${settlement.refundAmount.toFixed(1)} 积分`);
    }
    await addLog(`   • 当前余额: ${settlement.newBalance.toFixed(1)} 积分`);
  }
}
