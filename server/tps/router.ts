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
  freezeCredits,
  settleCredits,
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
      
      // ==================== 预扣费用计算（多扣少补策略） ====================
      // 预扣上限：最大 25 搜索页 + 200 详情页（仅用于预扣，不影响实际搜索逻辑）
      const MAX_PREDEDUCT_SEARCH_PAGES = 25;  // 预扣搜索页上限
      const MAX_PREDEDUCT_DETAIL_PAGES = 200; // 预扣详情页上限
      
      // 计算预扣费用（按上限预扣，任务完成后退还多余积分）
      const preDeductSearchPageCost = MAX_PREDEDUCT_SEARCH_PAGES * searchCost;
      const preDeductDetailCost = MAX_PREDEDUCT_DETAIL_PAGES * detailCost;
      const maxEstimatedCost = preDeductSearchPageCost + preDeductDetailCost;
      
      // 创建搜索任务（先创建任务，获取 taskId）
      const task = await createTpsSearchTask({
        userId,
        mode: input.mode,
        names: input.names,
        locations: input.locations || [],
        filters: input.filters || {},
        maxPages: config.maxPages,
      });
      
      // ==================== 预扣费机制 ====================
      // 预扣最大预估费用，确保任务能够完整执行
      const freezeResult = await freezeCredits(userId, maxEstimatedCost, task.taskId);
      
      if (!freezeResult.success) {
        // 预扣失败，标记任务为积分不足状态
        const database = await getDb();
        if (database) {
          await database.update(tpsSearchTasks).set({
            status: "insufficient_credits",
            errorMessage: freezeResult.message,
            completedAt: new Date(),
          }).where(eq(tpsSearchTasks.id, task.id));
        }
        
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `积分不足，预扣需要 ${maxEstimatedCost.toFixed(1)} 积分（搜索页 ${preDeductSearchPageCost.toFixed(1)} + 详情页 ${preDeductDetailCost.toFixed(1)}），当前余额 ${freezeResult.currentBalance} 积分`,
        });
      }
      
      // 异步执行搜索（不阻塞响应），传入预扣金额用于结算
      executeTpsSearchUnifiedQueue(task.id, task.taskId, config, input, userId, freezeResult.frozenAmount).catch(err => {
        console.error(`TPS 搜索任务 ${task.taskId} 执行失败:`, err);
      });
      
      return {
        taskId: task.taskId,
        message: "搜索任务已提交",
        frozenCredits: freezeResult.frozenAmount,
        remainingBalance: freezeResult.currentBalance,
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
        "搜索姓名", "搜索地点", "缓存命中", "详情链接", "数据来源", "获取时间"
      ];
      
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
        r.fromCache ? "是" : "否",
        r.detailLink ? `https://www.truepeoplesearch.com${r.detailLink}` : "",
        "实时获取",  // 数据来源：统一标记为实时获取
        formatDateTime(r.createdAt),  // 获取时间
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
 * 统一队列模式执行搜索 (v3.4 预扣费版)
 * 
 * 两阶段执行：
 * 1. 阶段一：并发执行所有搜索任务（4 并发），每个任务内部并发获取所有搜索页
 * 2. 阶段二：统一队列消费所有详情链接（40 并发）
 * 
 * v3.4 更新：
 * - 预扣费机制：任务开始前预扣最大预估费用
 * - 有始有终：预扣成功后任务必定完整执行
 * - 结算退还：任务完成后退还多扣的积分
 * - 移除中途积分检查：不再中途终止任务
 */
async function executeTpsSearchUnifiedQueue(
  taskDbId: number,
  taskId: string,
  config: any,
  input: z.infer<typeof tpsSearchInputSchema>,
  userId: number,
  frozenAmount: number  // 预扣金额，用于任务完成后结算
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
  addLog(`🔍 开始 TPS 搜索`);
  addLog(`═══════════════════════════════════════════════════`);
  
  // 显示搜索配置
  addLog(`📋 搜索配置:`);
  addLog(`   • 搜索模式: ${input.mode === 'nameOnly' ? '仅姓名搜索' : '姓名+地点组合搜索'}`);
  addLog(`   • 搜索姓名: ${input.names.join(', ')}`);
  if (input.mode === 'nameLocation' && input.locations) {
    addLog(`   • 搜索地点: ${input.locations.join(', ')}`);
  }
  addLog(`   • 搜索组合: ${subTasks.length} 个任务`);
  
  // 显示过滤条件
  const filters = input.filters || {};
  addLog(`📋 过滤条件:`);
  addLog(`   • 年龄范围: ${filters.minAge || 50} - ${filters.maxAge || 79} 岁`);
  if (filters.minPropertyValue && filters.minPropertyValue > 0) addLog(`   • 最低房产价值: $${filters.minPropertyValue.toLocaleString()}`);
  if (filters.excludeTMobile) addLog(`   • 排除运营商: T-Mobile`);
  if (filters.excludeComcast) addLog(`   • 排除运营商: Comcast`);
  if (filters.excludeLandline) addLog(`   • 排除座机号码`);
  
  // 显示预估费用
  const maxPagesPerTask = 25;
  const estimatedSearchPages = subTasks.length * maxPagesPerTask;
  const estimatedSearchCost = estimatedSearchPages * searchCost;
  const estimatedDetailPages = subTasks.length * 50; // 预估每个任务50条详情
  const estimatedDetailCost = estimatedDetailPages * detailCost;
  const estimatedTotalCost = estimatedSearchCost + estimatedDetailCost;
  
  addLog(`💰 费用预估 (最大值):`);
  addLog(`   • 搜索页费用: 最多 ${estimatedSearchPages} 页 × ${searchCost} = ${estimatedSearchCost.toFixed(1)} 积分`);
  addLog(`   • 详情页费用: 预估 ~${estimatedDetailPages} 页 × ${detailCost} = ${estimatedDetailCost.toFixed(1)} 积分`);
  addLog(`   • 预估总费用: ~${estimatedTotalCost.toFixed(1)} 积分 (实际费用取决于搜索结果)`);
  addLog(`   💡 提示: 缓存命中的详情不收费，可节省大量积分`);
  
  addLog(`═══════════════════════════════════════════════════`);
  addLog(`🧵 并发配置: 搜索 ${SEARCH_CONCURRENCY} 任务并发 / 详情 ${TOTAL_CONCURRENCY} 并发`);
  
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
  let totalSkippedDeceased = 0;  // 跳过的已故人员数量
  
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
    const cacheDays = config.cacheDays || 180;
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
    if (totalSkippedDeceased > 0) {
      addLog(`📊 排除已故: ${totalSkippedDeceased} 条 (Deceased)`);
    }
    
    // ==================== 预扣费机制：无需中途检查积分 ====================
    // 积分已在任务开始前预扣，任务必定完整执行
    const searchPageCostSoFar = totalSearchPages * searchCost;
    const uniqueDetailLinks = [...new Set(allDetailTasks.map(t => t.searchResult.detailLink))];
    const estimatedDetailCostRemaining = uniqueDetailLinks.length * detailCost;
    const totalEstimatedCost = searchPageCostSoFar + estimatedDetailCostRemaining;
    
    addLog(`💰 预扣积分: ${frozenAmount.toFixed(1)} 积分`);
    addLog(`💰 当前预估: ${totalEstimatedCost.toFixed(1)} 积分（搜索页 ${searchPageCostSoFar.toFixed(1)} + 详情页 ${estimatedDetailCostRemaining.toFixed(1)}）`);
    addLog(`✅ 积分已预扣，任务将完整执行`);
    
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
    
    // ==================== 结算退还机制 ====================
    // 计算实际消耗
    const actualCost = totalSearchPages * searchCost + totalDetailPages * detailCost;
    
    // 结算：退还多扣的积分
    const settlement = await settleCredits(userId, frozenAmount, actualCost, taskId);
    
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
    
    // 增强完成日志 - 让用户清楚知道积分都做了什么
    addLog(`═══════════════════════════════════════════════════`);
    addLog(`🎉 任务完成!`);
    addLog(`═══════════════════════════════════════════════════`);
    
    // 搜索结果摘要
    addLog(`📊 搜索结果摘要:`);
    addLog(`   • 有效结果: ${totalResults} 条联系人信息`);
    addLog(`   • 缓存命中: ${totalCacheHits} 条 (免费获取)`);
    addLog(`   • 过滤排除: ${totalFilteredOut} 条 (不符合筛选条件)`);
    if (totalSkippedDeceased > 0) {
      addLog(`   • 排除已故: ${totalSkippedDeceased} 条 (Deceased)`);
    }
    
    // 费用明细
    const searchPageCost = totalSearchPages * searchCost;
    const detailPageCost = totalDetailPages * detailCost;
    const savedByCache = totalCacheHits * detailCost;
    
    addLog(`💰 费用明细:`);
    addLog(`   • 搜索页费用: ${totalSearchPages} 页 × ${searchCost} = ${searchPageCost.toFixed(1)} 积分`);
    addLog(`   • 详情页费用: ${totalDetailPages} 页 × ${detailCost} = ${detailPageCost.toFixed(1)} 积分`);
    addLog(`   • 缓存节省: ${totalCacheHits} 条 × ${detailCost} = ${savedByCache.toFixed(1)} 积分`);
    addLog(`   ──────────────────────────────`);
    addLog(`   • 预扣积分: ${frozenAmount.toFixed(1)} 积分`);
    addLog(`   • 实际消耗: ${actualCost.toFixed(1)} 积分`);
    if (settlement.refundAmount > 0) {
      addLog(`   • ✅ 已退还: ${settlement.refundAmount.toFixed(1)} 积分`);
    }
    addLog(`   • 当前余额: ${settlement.newBalance.toFixed(1)} 积分`);
    
    // 费用效率分析
    addLog(`📈 费用效率:`);
    if (totalResults > 0) {
      const costPerResult = actualCost / totalResults;
      addLog(`   • 每条结果成本: ${costPerResult.toFixed(2)} 积分`);
    }
    const cacheHitRate = totalCacheHits > 0 ? ((totalCacheHits / (totalCacheHits + totalDetailPages)) * 100).toFixed(1) : '0';
    addLog(`   • 缓存命中率: ${cacheHitRate}%`);
    if (savedByCache > 0 && actualCost > 0) {
      addLog(`   • 缓存节省: ${savedByCache.toFixed(1)} 积分 (相当于 ${Math.round(savedByCache / actualCost * 100)}% 的实际费用)`);
    }
    
    addLog(`═══════════════════════════════════════════════════`);
    addLog(`💡 提示: 相同姓名/地点的后续搜索将命中缓存，节省更多积分`);
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
      ipAddress: undefined,
      userAgent: undefined
    });
    
  } catch (error: any) {
    addLog(`❌ 搜索任务失败: ${error.message}`);
    
    // ==================== 失败时的结算退还 ====================
    // 计算已完成的实际消耗（搜索页 + 详情页）
    const partialCost = totalSearchPages * searchCost + totalDetailPages * detailCost;
    
    // 结算：退还未使用的积分
    const settlement = await settleCredits(userId, frozenAmount, partialCost, taskId);
    
    addLog(`💰 失败结算:`);
    addLog(`   • 预扣积分: ${frozenAmount.toFixed(1)} 积分`);
    addLog(`   • 已消耗: ${partialCost.toFixed(1)} 积分（搜索页 ${totalSearchPages} + 详情页 ${totalDetailPages}）`);
    if (settlement.refundAmount > 0) {
      addLog(`   • ✅ 已退还: ${settlement.refundAmount.toFixed(1)} 积分`);
    }
    addLog(`   • 当前余额: ${settlement.newBalance.toFixed(1)} 积分`);
    
    await failTpsSearchTask(taskDbId, error.message, logs);
    
    await logApi({
      userId,
      apiType: "scrape_tps",
      endpoint: "fullSearch",
      requestParams: { names: input.names.length, mode: input.mode },
      responseStatus: 500,
      success: false,
      errorMessage: error.message,
      creditsUsed: partialCost,
    });
  }
}
