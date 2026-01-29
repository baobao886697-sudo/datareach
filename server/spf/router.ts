/**
 * SearchPeopleFree (SPF) tRPC 路由
 * 
 * v2.0 - 参考 TPS 优化版本
 * 
 * SPF 独特亮点：
 * - 电子邮件信息
 * - 电话类型标注 (座机/手机)
 * - 婚姻状态和配偶信息
 * - 就业状态
 * - 数据确认日期
 * - 地理坐标
 * 
 * 优化特性：
 * - 两阶段并发执行：先并发获取所有分页，再并发获取所有详情
 * - 预扣费机制：按最大消耗预扣（25页搜索 + 250条详情），完成后退还
 * - 详情页缓存机制：避免重复获取相同详情
 * - 无 maxResults 限制：获取所有可用数据
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
} from "./scraper";
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
  freezeSpfCredits,
  settleSpfCredits,
  logApi,
} from "./db";
import { getDb, logUserActivity } from "../db";
import { spfSearchTasks } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

// 并发配置
const TOTAL_CONCURRENCY = SPF_CONFIG.TOTAL_CONCURRENCY;  // 40 总并发
const SEARCH_CONCURRENCY = SPF_CONFIG.TASK_CONCURRENCY;  // 4 搜索并发

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
  names: z.array(z.string().min(1)).min(1).max(100),
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
        note: "预扣最大费用，实际消耗后退还多余积分",
      };
    }),

  // 提交搜索任务
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
      const maxPages = SPF_CONFIG.MAX_SAFE_PAGES;
      const maxDetailsPerTask = SPF_CONFIG.MAX_DETAILS_PER_TASK;
      
      // 计算子任务数
      let subTaskCount = 0;
      if (input.mode === "nameOnly") {
        subTaskCount = input.names.length;
      } else {
        const locations = input.locations || [""];
        subTaskCount = input.names.length * locations.length;
      }
      
      // ==================== 预扣费机制：按最大消耗预扣 ====================
      // 搜索页：任务数 × 25页 × 单价
      const maxSearchPageCost = subTaskCount * maxPages * searchCost;
      // 详情页：任务数 × 250条 × 单价
      const maxDetailCost = subTaskCount * maxDetailsPerTask * detailCost;
      // 总预扣
      const maxEstimatedCost = maxSearchPageCost + maxDetailCost;
      
      // 创建搜索任务
      const task = await createSpfSearchTask({
        userId,
        mode: input.mode,
        names: input.names,
        locations: input.locations || [],
        filters: input.filters || {},
      });
      
      // 预扣积分
      const freezeResult = await freezeSpfCredits(userId, maxEstimatedCost, task.taskId);
      
      if (!freezeResult.success) {
        // 预扣失败，标记任务为积分不足状态
        const database = await getDb();
        if (database) {
          await database.update(spfSearchTasks).set({
            status: "insufficient_credits",
            errorMessage: freezeResult.message,
            completedAt: new Date(),
          }).where(eq(spfSearchTasks.id, task.id));
        }
        
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `积分不足，预估最多需要 ${maxEstimatedCost.toFixed(1)} 积分（搜索页 ${maxSearchPageCost.toFixed(1)} + 详情页 ${maxDetailCost.toFixed(1)}），当前余额 ${freezeResult.currentBalance} 积分`,
        });
      }
      
      // 异步执行搜索任务
      executeSpfSearchUnifiedQueue(
        task.id,
        task.taskId,
        config,
        input,
        userId,
        freezeResult.frozenAmount
      ).catch(err => {
        console.error(`[SPF] 任务执行失败: ${task.taskId}`, err);
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

  // 获取搜索结果
  getResults: protectedProcedure
    .input(z.object({
      taskId: z.string(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(10).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const task = await getSpfSearchTask(input.taskId);
      
      if (!task || task.userId !== ctx.user!.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "任务不存在",
        });
      }
      
      const results = await getSpfSearchResults(task.id, input.page, input.pageSize);
      
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
      const history = await getUserSpfSearchTasks(userId, input.page, input.pageSize);
      
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

  // 导出 CSV（包含 SPF 独特字段）
  exportCsv: protectedProcedure
    .input(z.object({
      taskId: z.string(),
      format: z.enum(['standard', 'detailed', 'minimal']).optional().default('standard'),
    }))
    .mutation(async ({ ctx, input }) => {
      console.log('[SPF CSV Export] Starting export for taskId:', input.taskId);
      
      const task = await getSpfSearchTask(input.taskId);
      console.log('[SPF CSV Export] Task found:', task ? `id=${task.id}, status=${task.status}` : 'null');
      
      if (!task || task.userId !== ctx.user!.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "任务不存在",
        });
      }
      
      const allResults = await getAllSpfSearchResults(task.id);
      console.log('[SPF CSV Export] Total results from DB:', allResults.length);
      
      // 数据质量过滤：必须有年龄和电话
      const results = allResults.filter(r => r.age && r.phone);
      console.log('[SPF CSV Export] Results after quality filter (age + phone):', results.length);
      
      // 格式化电话号码为纯数字格式（前面加 1）
      const formatPhone = (phone: string | null | undefined): string => {
        if (!phone) return "";
        const digits = phone.replace(/\D/g, "");
        if (digits.startsWith("1") && digits.length === 11) {
          return digits;
        }
        if (digits.length === 10) {
          return `1${digits}`;
        }
        return digits;
      };
      
      // 定义 CSV 字段
      const headers = [
        "姓名", "年龄", "出生年份", "城市", "州", "位置",
        "电话", "电话类型", "电话年份",
        "邮箱", "婚姻状态", "配偶姓名",
        "就业信息", "教育信息",
        "搜索姓名", "搜索地点", "缓存命中"
      ];
      
      const csvRows = results.map((r: any) => [
        r.name || "",
        r.age?.toString() || "",
        r.birthYear || "",
        r.city || "",
        r.state || "",
        r.location || (r.city && r.state ? `${r.city}, ${r.state}` : (r.city || r.state || "")),
        formatPhone(r.phone),
        r.phoneType || "",
        r.phoneYear?.toString() || "",
        r.email || "",
        r.maritalStatus || "",
        r.spouseName || "",
        r.employment || "",
        r.education || "",
        r.searchName || "",
        r.searchLocation || "",
        r.fromCache ? "是" : "否",
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

// ==================== 统一队列模式搜索执行逻辑 ====================

/**
 * 统一队列模式执行搜索 (v2.0 预扣费版)
 * 
 * 两阶段执行：
 * 1. 阶段一：并发执行所有搜索任务（4 并发），每个任务内部获取所有搜索页
 * 2. 阶段二：统一队列消费所有详情链接（40 并发）
 * 
 * 预扣费机制：
 * - 任务开始前预扣最大预估费用（25页搜索 + 250条详情）
 * - 有始有终：预扣成功后任务必定完整执行
 * - 结算退还：任务完成后退还多扣的积分
 */
async function executeSpfSearchUnifiedQueue(
  taskDbId: number,
  taskId: string,
  config: any,
  input: z.infer<typeof spfSearchInputSchema>,
  userId: number,
  frozenAmount: number
) {
  const searchCost = parseFloat(config.searchCost);
  const detailCost = parseFloat(config.detailCost);
  const token = config.scrapeDoToken;
  const maxPages = SPF_CONFIG.MAX_SAFE_PAGES;
  
  const logs: Array<{ timestamp: string; message: string }> = [];
  const MAX_LOG_ENTRIES = 100;  // 限制日志条数
  const MAX_MESSAGE_LENGTH = 200;  // 限制每条消息长度
  
  const addLog = (message: string) => {
    // 截断过长的消息
    const truncatedMessage = message.length > MAX_MESSAGE_LENGTH 
      ? message.substring(0, MAX_MESSAGE_LENGTH) + '...' 
      : message;
    
    // 如果日志已满，移除最早的条目
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
  
  // 增强启动日志
  addLog(`═══════════════════════════════════════════════════`);
  addLog(`[搜索] 开始 SPF 搜索`);
  addLog(`═══════════════════════════════════════════════════`);
  
  // 显示搜索配置
  addLog(`[配置] 搜索配置:`);
  addLog(`   • 搜索模式: ${input.mode === 'nameOnly' ? '仅姓名搜索' : '姓名+地点组合搜索'}`);
  addLog(`   • 搜索姓名: ${input.names.join(', ')}`);
  if (input.mode === 'nameLocation' && input.locations) {
    addLog(`   • 搜索地点: ${input.locations.join(', ')}`);
  }
  addLog(`   • 搜索组合: ${subTasks.length} 个任务`);
  
  // 显示过滤条件
  const filters = input.filters || {};
  addLog(`[配置] 过滤条件:`);
  addLog(`   • 年龄范围: ${filters.minAge || 50} - ${filters.maxAge || 79} 岁`);
  if (filters.excludeLandline) addLog(`   • 排除座机号码`);
  if (filters.excludeWireless) addLog(`   • 排除手机号码`);
  
  // 显示预估费用
  const maxPagesPerTask = SPF_CONFIG.MAX_SAFE_PAGES;
  const maxDetailsPerTask = SPF_CONFIG.MAX_DETAILS_PER_TASK;
  const estimatedSearchPages = subTasks.length * maxPagesPerTask;
  const estimatedSearchCost = estimatedSearchPages * searchCost;
  const estimatedDetailPages = subTasks.length * maxDetailsPerTask;
  const estimatedDetailCost = estimatedDetailPages * detailCost;
  const estimatedTotalCost = estimatedSearchCost + estimatedDetailCost;
  
  addLog(`[费用] 费用预估 (最大值):`);
  addLog(`   • 搜索页费用: 最多 ${estimatedSearchPages} 页 × ${searchCost} = ${estimatedSearchCost.toFixed(1)} 积分`);
  addLog(`   • 详情页费用: 最多 ${estimatedDetailPages} 页 × ${detailCost} = ${estimatedDetailCost.toFixed(1)} 积分`);
  addLog(`   • 预估总费用: ~${estimatedTotalCost.toFixed(1)} 积分 (实际费用取决于搜索结果)`);
  addLog(`   [提示] 提示: 缓存命中的详情不收费，可节省大量积分`);
  
  addLog(`═══════════════════════════════════════════════════`);
  addLog(`[并发] 并发配置: 搜索 ${SEARCH_CONCURRENCY} 任务并发 / 详情 ${TOTAL_CONCURRENCY} 并发`);
  
  // 更新任务状态
  await updateSpfSearchTaskProgress(taskDbId, {
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
  let totalSkippedDeceased = 0;
  
  // 缓存函数
  const getCachedDetails = async (links: string[]) => {
    const cached = await getCachedSpfDetails(links);
    const map = new Map<string, SpfDetailResult>();
    for (const item of cached) {
      if (item.data) {
        map.set(item.detailLink, item.data as SpfDetailResult);
      }
    }
    return map;
  };
  
  const setCachedDetails = async (items: Array<{ link: string; data: SpfDetailResult }>) => {
    const cacheDays = config.cacheDays || 180;
    await saveSpfDetailCache(items, cacheDays);
  };
  
  // 用于跨任务电话号码去重
  const seenPhones = new Set<string>();
  
  try {
    // ==================== 阶段一：并发搜索 ====================
    addLog(`[配置] 阶段一：并发搜索 (${SEARCH_CONCURRENCY} 任务并发 × ${maxPages}页)...`);
    
    // 收集所有详情任务
    const allDetailTasks: DetailTask[] = [];
    const subTaskResults: Map<number, { searchResults: SpfDetailResult[]; searchPages: number }> = new Map();
    
    let completedSearches = 0;
    
    // 并发执行搜索
    const searchQueue = [...subTasks];
    
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
        addLog(`[成功] [${subTask.index + 1}/${subTasks.length}] ${taskName} - ${result.searchResults.length} 条结果, ${result.stats.searchPageRequests} 页, 过滤 ${result.stats.filteredOut} 条`);
      } else {
        addLog(`[失败] [${subTask.index + 1}/${subTasks.length}] 搜索失败: ${result.error}`);
      }
      
      // 更新进度（搜索阶段占 30%）
      const searchProgress = Math.round((completedSearches / subTasks.length) * 30);
      await updateSpfSearchTaskProgress(taskDbId, {
        completedSubTasks: completedSearches,
        progress: searchProgress,
        searchPageRequests: totalSearchPages,
        logs,
      });
    };
    
    // 使用并发控制
    const runConcurrentSearches = async () => {
      let currentIndex = 0;
      
      const runNext = async (): Promise<void> => {
        while (currentIndex < searchQueue.length) {
          const task = searchQueue[currentIndex++];
          await processSearch(task);
        }
      };
      
      const workers = Math.min(SEARCH_CONCURRENCY, searchQueue.length);
      const promises: Promise<void>[] = [];
      for (let i = 0; i < workers; i++) {
        promises.push(runNext());
      }
      
      await Promise.all(promises);
    };
    
    await runConcurrentSearches();
    
    // 增强搜索阶段完成日志
    addLog(`════════ 搜索阶段完成 ════════`);
    addLog(`[统计] 搜索页请求: ${totalSearchPages} 页`);
    addLog(`[统计] 待获取详情: ${allDetailTasks.length} 条`);
    addLog(`[统计] 年龄预过滤: ${totalFilteredOut} 条被排除`);
    if (totalSkippedDeceased > 0) {
      addLog(`[统计] 排除已故: ${totalSkippedDeceased} 条 (Deceased)`);
    }
    
    // 显示预扣费信息
    const searchPageCostSoFar = totalSearchPages * searchCost;
    const uniqueDetailLinks = [...new Set(allDetailTasks.map(t => t.detailLink))];
    const estimatedDetailCostRemaining = uniqueDetailLinks.length * detailCost;
    const totalEstimatedCost = searchPageCostSoFar + estimatedDetailCostRemaining;
    
    addLog(`[费用] 预扣积分: ${frozenAmount.toFixed(1)} 积分`);
    addLog(`[费用] 当前预估: ${totalEstimatedCost.toFixed(1)} 积分（搜索页 ${searchPageCostSoFar.toFixed(1)} + 详情页 ${estimatedDetailCostRemaining.toFixed(1)}）`);
    addLog(`[成功] 积分已预扣，任务将完整执行`);
    
    // ==================== 阶段二：统一队列获取详情 ====================
    if (allDetailTasks.length > 0) {
      addLog(`[配置] 阶段二：统一队列获取详情（${TOTAL_CONCURRENCY} 并发）...`);
      
      // 去重详情链接
      const uniqueLinks = [...new Set(allDetailTasks.map(t => t.detailLink))];
      addLog(`[链接] 去重后 ${uniqueLinks.length} 个唯一详情链接`);
      
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
      const resultsBySubTask = new Map<number, SpfDetailResult[]>();
      
      for (const { task, details } of detailResult.results) {
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
      for (const [subTaskIndex, results] of resultsBySubTask) {
        const subTask = subTasks.find(t => t.index === subTaskIndex);
        if (subTask && results.length > 0) {
          await saveSpfSearchResults(taskDbId, subTaskIndex, subTask.name, subTask.location, results);
          totalResults += results.length;
        }
      }
      
      addLog(`════════ 详情阶段完成 ════════`);
      addLog(`[统计] 详情页请求: ${totalDetailPages} 页`);
      addLog(`[统计] 缓存命中: ${totalCacheHits} 条`);
      addLog(`[统计] 详情过滤: ${totalFilteredOut} 条被排除`);
      addLog(`[统计] 有效结果: ${totalResults} 条`);
    }
    
    // 更新最终进度
    await updateSpfSearchTaskProgress(taskDbId, {
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
    const settlement = await settleSpfCredits(userId, frozenAmount, actualCost, taskId);
    
    // 记录 API 日志
    await logApi({
      userId,
      apiType: "scrape_spf",
      endpoint: "fullSearch",
      requestParams: { names: input.names.length, mode: input.mode },
      responseStatus: 200,
      responseTime: 0,
      success: true,
      creditsUsed: actualCost,
    });
    
    // 增强完成日志
    addLog(`═══════════════════════════════════════════════════`);
    addLog(`[完成] 任务完成!`);
    addLog(`═══════════════════════════════════════════════════`);
    
    // 搜索结果摘要
    addLog(`[统计] 搜索结果摘要:`);
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
    
    addLog(`[费用] 费用明细:`);
    addLog(`   • 搜索页费用: ${totalSearchPages} 页 × ${searchCost} = ${searchPageCost.toFixed(1)} 积分`);
    addLog(`   • 详情页费用: ${totalDetailPages} 页 × ${detailCost} = ${detailPageCost.toFixed(1)} 积分`);
    addLog(`   • 缓存节省: ${totalCacheHits} 条 × ${detailCost} = ${savedByCache.toFixed(1)} 积分`);
    addLog(`   ──────────────────────────────`);
    addLog(`   • 预扣积分: ${frozenAmount.toFixed(1)} 积分`);
    addLog(`   • 实际消耗: ${actualCost.toFixed(1)} 积分`);
    if (settlement.refundAmount > 0) {
      addLog(`   • [成功] 已退还: ${settlement.refundAmount.toFixed(1)} 积分`);
    }
    addLog(`   • 当前余额: ${settlement.newBalance.toFixed(1)} 积分`);
    
    // 费用效率分析
    addLog(`[效率] 费用效率:`);
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
    addLog(`[提示] 提示: 相同姓名/地点的后续搜索将命中缓存，节省更多积分`);
    addLog(`═══════════════════════════════════════════════════`);
    
    await completeSpfSearchTask(taskDbId, {
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
      details: `搜索完成: ${input.names.length}个姓名, ${totalResults}条结果, 消耗${actualCost.toFixed(1)}积分`,
      ipAddress: undefined,
      userAgent: undefined
    });
    
  } catch (error: any) {
    addLog(`[失败] 搜索任务失败: ${error.message}`);
    
    // ==================== 失败时的结算退还 ====================
    const partialCost = totalSearchPages * searchCost + totalDetailPages * detailCost;
    
    // 结算：退还未使用的积分
    const settlement = await settleSpfCredits(userId, frozenAmount, partialCost, taskId);
    
    addLog(`[费用] 失败结算:`);
    addLog(`   • 预扣积分: ${frozenAmount.toFixed(1)} 积分`);
    addLog(`   • 已消耗: ${partialCost.toFixed(1)} 积分（搜索页 ${totalSearchPages} + 详情页 ${totalDetailPages}）`);
    if (settlement.refundAmount > 0) {
      addLog(`   • [成功] 已退还: ${settlement.refundAmount.toFixed(1)} 积分`);
    }
    addLog(`   • 当前余额: ${settlement.newBalance.toFixed(1)} 积分`);
    
    await failSpfSearchTask(taskDbId, error.message, logs);
    
    await logApi({
      userId,
      apiType: "scrape_spf",
      endpoint: "fullSearch",
      requestParams: { names: input.names.length, mode: input.mode },
      responseStatus: 500,
      responseTime: 0,
      success: false,
      errorMessage: error.message,
      creditsUsed: partialCost,
    });
  }
}
