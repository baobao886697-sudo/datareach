/**
 * SearchPeopleFree (SPF) tRPC 路由
 * 
 * 提供 SPF 搜索功能的 API 端点
 * 
 * SPF 独特亮点：
 * - 电子邮件信息
 * - 电话类型标注 (座机/手机)
 * - 婚姻状态和配偶信息
 * - 就业状态
 * - 数据确认日期
 * - 地理坐标
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { 
  searchAndGetDetails,
  batchSearch,
  SpfFilters, 
  SpfDetailResult,
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
  preDeductSpfCredits,
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
  excludeWireless: z.boolean().optional(),  // SPF 独特：可排除手机
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

  // 预估搜索消耗
  estimateCost: protectedProcedure
    .input(spfSearchInputSchema)
    .query(async ({ input }) => {
      const config = await getSpfConfig();
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
      
      // SPF 特点：每个搜索需要 1 次搜索页 API + 每个结果需要 1 次详情页 API
      // 预估每个任务返回 5 条结果（保守估计）
      const avgDetailsPerTask = 5;
      
      // 搜索页费用：每个子任务 1 次 API 调用
      const maxSearchPages = subTaskCount;
      const maxSearchCost = maxSearchPages * searchCost;
      
      // 详情页费用：每个结果 1 次 API 调用
      const estimatedDetails = subTaskCount * avgDetailsPerTask;
      const estimatedDetailCost = estimatedDetails * detailCost;
      
      // 总费用 = 搜索页 + 详情页
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
      
      // 计算子任务数
      let subTaskCount = 0;
      if (input.mode === "nameOnly") {
        subTaskCount = input.names.length;
      } else {
        const locations = input.locations || [""];
        subTaskCount = input.names.length * locations.length;
      }
      
      // 预估最大消耗
      const maxEstimatedCost = subTaskCount * (searchCost + detailCost);
      
      // 创建搜索任务
      const task = await createSpfSearchTask({
        userId,
        mode: input.mode,
        names: input.names,
        locations: input.locations || [],
        filters: input.filters || {},
      });
      
      // ==================== 预扣费机制 ====================
      const freezeResult = await preDeductSpfCredits(userId, maxEstimatedCost, task.taskId);
      
      if (!freezeResult.success) {
        // 预扣失败，标记任务为积分不足状态
        const database = await getDb();
        if (database) {
          await database.update(spfSearchTasks).set({
            status: "insufficient_credits",
            errorMessage: `积分不足，需要 ${maxEstimatedCost.toFixed(1)} 积分`,
            completedAt: new Date(),
          }).where(eq(spfSearchTasks.id, task.id));
        }
        
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `积分不足，预估需要 ${maxEstimatedCost.toFixed(1)} 积分，当前余额 ${freezeResult.currentBalance} 积分`,
        });
      }
      
      // 异步执行搜索任务
      executeSpfSearchTask(
        task.id,
        task.taskId,
        userId,
        input,
        config,
        maxEstimatedCost
      ).catch(err => {
        console.error(`[SPF] 任务执行失败: ${task.taskId}`, err);
      });
      
      return {
        taskId: task.taskId,
        estimatedCost: maxEstimatedCost,
        message: "搜索任务已创建",
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
      
      const results = await getAllSpfSearchResults(task.id);
      console.log('[SPF CSV Export] Results count:', results.length);
      
      // CSV 表头（包含 SPF 独特字段）
      let headers: string[];
      let getRowData: (r: any, index: number) => string[];
      
      if (input.format === 'minimal') {
        // 简洁版
        headers = ["姓名", "年龄", "电话", "电话类型", "邮箱", "城市", "州"];
        getRowData = (r, index) => [
          r.name || "",
          r.age?.toString() || "",
          r.phone || "",
          r.phoneType || "",
          r.email || "",
          r.city || "",
          r.state || "",
        ];
      } else if (input.format === 'detailed') {
        // 详细版（包含所有 SPF 独特字段）
        headers = [
          "序号", "姓名", "名", "姓", "年龄", "出生年份",
          "电话", "电话类型", "运营商",
          "邮箱", "所有邮箱",
          "婚姻状态", "配偶姓名",
          "就业状态",
          "城市", "州", "完整地址",
          "纬度", "经度",
          "数据确认日期",
          "家庭成员", "关联人", "关联企业",
          "搜索姓名", "搜索地点",
        ];
        getRowData = (r, index) => [
          (index + 1).toString(),
          r.name || "",
          r.firstName || "",
          r.lastName || "",
          r.age?.toString() || "",
          r.birthYear || "",
          r.phone || "",
          r.phoneType || "",
          r.carrier || "",
          r.email || "",
          (r.allEmails || []).join("; "),
          r.maritalStatus || "",
          r.spouseName || "",
          r.employment || "",
          r.city || "",
          r.state || "",
          r.location || "",
          r.latitude?.toString() || "",
          r.longitude?.toString() || "",
          r.confirmedDate || "",
          (r.familyMembers || []).join("; "),
          (r.associates || []).join("; "),
          (r.businesses || []).join("; "),
          r.searchName || "",
          r.searchLocation || "",
        ];
      } else {
        // 标准版
        headers = [
          "序号", "姓名", "年龄", "出生年份",
          "电话", "电话类型",
          "邮箱",
          "婚姻状态", "配偶姓名",
          "就业状态",
          "城市", "州", "地址",
          "数据确认日期",
        ];
        getRowData = (r, index) => [
          (index + 1).toString(),
          r.name || "",
          r.age?.toString() || "",
          r.birthYear || "",
          r.phone || "",
          r.phoneType || "",
          r.email || "",
          r.maritalStatus || "",
          r.spouseName || "",
          r.employment || "",
          r.city || "",
          r.state || "",
          r.location || "",
          r.confirmedDate || "",
        ];
      }
      
      // 生成 CSV 内容
      const escapeCSV = (value: string) => {
        if (!value) return "";
        if (value.includes(",") || value.includes('"') || value.includes("\n")) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      };
      
      const csvRows = [headers.join(",")];
      results.forEach((r, index) => {
        const row = getRowData(r, index).map(escapeCSV);
        csvRows.push(row.join(","));
      });
      
      const csvContent = csvRows.join("\n");
      
      // 添加 UTF-8 BOM 以确保 Excel 正确识别中文
      const BOM = "\uFEFF";
      const csvContentWithBom = BOM + csvContent;
      
      console.log('[SPF CSV Export] CSV rows count:', csvRows.length);
      console.log('[SPF CSV Export] CSV content length:', csvContentWithBom.length);
      if (results.length > 0) {
        console.log('[SPF CSV Export] First result sample:', JSON.stringify(results[0]).slice(0, 200));
      }
      
      // 生成文件名
      const searchParams = task.names as string[] || [];
      const firstNames = searchParams.slice(0, 3).join("_").replace(/[^a-zA-Z0-9_]/g, "");
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const fileName = `DataReach_SPF_${firstNames}_${date}.csv`;
      
      console.log('[SPF CSV Export] Returning fileName:', fileName, 'content length:', csvContentWithBom.length, 'results count:', results.length);
      
      return {
        fileName,
        content: csvContentWithBom,
        totalRecords: results.length,
      };
    }),
});

// ==================== 异步搜索任务执行 ====================

async function executeSpfSearchTask(
  taskDbId: number,
  taskId: string,
  userId: number,
  input: z.infer<typeof spfSearchInputSchema>,
  config: any,
  frozenAmount: number
) {
  const token = config.scrapeDoToken;
  const searchCost = parseFloat(config.searchCost);
  const detailCost = parseFloat(config.detailCost);
  
  // 日志记录
  const logs: Array<{ timestamp: string; message: string }> = [];
  const addLog = (message: string) => {
    logs.push({ timestamp: new Date().toISOString(), message });
    console.log(`[SPF Task ${taskId}] ${message}`);
  };
  
  // 统计数据
  let totalSearchPages = 0;
  let totalDetailPages = 0;
  let totalCacheHits = 0;
  let totalResults = 0;
  
  // 构建子任务列表
  const subTasks: Array<{ name: string; location: string; index: number }> = [];
  
  if (input.mode === "nameOnly") {
    input.names.forEach((name, index) => {
      subTasks.push({ name, location: "", index });
    });
  } else {
    const locations = input.locations || [""];
    let index = 0;
    for (const name of input.names) {
      for (const location of locations) {
        subTasks.push({ name, location, index: index++ });
      }
    }
  }
  
  // 更新任务状态
  await updateSpfSearchTaskProgress(taskDbId, {
    status: "running",
    totalSubTasks: subTasks.length,
    logs,
  });
  
  addLog(`═══════════════════════════════════════════════════`);
  addLog(`🔍 SearchPeopleFree 搜索任务开始`);
  addLog(`═══════════════════════════════════════════════════`);
  addLog(`📋 任务ID: ${taskId}`);
  addLog(`📋 子任务数: ${subTasks.length}`);
  addLog(`📋 模式: ${input.mode}`);
  addLog(`📋 预扣积分: ${frozenAmount.toFixed(1)}`);
  addLog(`═══════════════════════════════════════════════════`);
  
  // 用于电话号码去重
  const seenPhones = new Set<string>();
  
  try {
    // 执行搜索
    addLog(`📋 开始并发搜索 (${SEARCH_CONCURRENCY} 并发)...`);
    
    let completedSearches = 0;
    const allResults: SpfDetailResult[] = [];
    
    // 并发执行搜索
    const processSearch = async (subTask: { name: string; location: string; index: number }) => {
      const startTime = Date.now();
      
      try {
        const { results, searchPageCalls, detailPageCalls } = await searchAndGetDetails(
          subTask.name,
          subTask.location,
          token,
          input.filters || {}
        );
        
        const responseTime = Date.now() - startTime;
        totalSearchPages += searchPageCalls;
        totalDetailPages += detailPageCalls;
        
        // 记录 API 调用
        await logApi({
          userId,
          apiType: "scrape_spf",
          endpoint: "search",
          requestParams: { name: subTask.name, location: subTask.location },
          responseStatus: 200,
          responseTime,
          success: true,
        });
        
        if (results.length > 0) {
          // 电话号码去重
          for (const result of results) {
            if (result.phone && seenPhones.has(result.phone)) {
              continue;  // 跳过重复电话
            }
            if (result.phone) {
              seenPhones.add(result.phone);
            }
            allResults.push({
              ...result,
              searchName: subTask.name,
              searchLocation: subTask.location,
            } as any);
          }
          
          const taskName = subTask.location ? `${subTask.name} @ ${subTask.location}` : subTask.name;
          addLog(`✅ [${subTask.index + 1}/${subTasks.length}] ${taskName} - ${results.length} 条结果`);
        } else {
          const taskName = subTask.location ? `${subTask.name} @ ${subTask.location}` : subTask.name;
          addLog(`⚠️ [${subTask.index + 1}/${subTasks.length}] ${taskName} - 无结果`);
        }
        
      } catch (error: any) {
        const responseTime = Date.now() - startTime;
        
        await logApi({
          userId,
          apiType: "scrape_spf",
          endpoint: "search",
          requestParams: { name: subTask.name, location: subTask.location },
          responseStatus: 500,
          responseTime,
          success: false,
          errorMessage: error.message,
        });
        
        addLog(`❌ [${subTask.index + 1}/${subTasks.length}] 搜索失败: ${error.message}`);
      }
      
      completedSearches++;
      
      // 更新进度
      const progress = Math.round((completedSearches / subTasks.length) * 100);
      await updateSpfSearchTaskProgress(taskDbId, {
        completedSubTasks: completedSearches,
        progress,
        searchPageRequests: totalSearchPages,
        logs,
      });
    };
    
    // 使用并发控制
    const runConcurrentSearches = async () => {
      const queue = [...subTasks];
      let currentIndex = 0;
      
      const runNext = async (): Promise<void> => {
        while (currentIndex < queue.length) {
          const task = queue[currentIndex++];
          await processSearch(task);
        }
      };
      
      const workers = Math.min(SEARCH_CONCURRENCY, queue.length);
      const promises: Promise<void>[] = [];
      for (let i = 0; i < workers; i++) {
        promises.push(runNext());
      }
      
      await Promise.all(promises);
    };
    
    await runConcurrentSearches();
    
    addLog(`📊 搜索完成，共收集 ${allResults.length} 条结果`);
    
    // 保存结果
    if (allResults.length > 0) {
      // 按子任务分组保存
      const resultsBySubTask = new Map<number, SpfDetailResult[]>();
      
      for (const result of allResults) {
        const subTaskIndex = subTasks.findIndex(
          t => t.name === (result as any).searchName && t.location === (result as any).searchLocation
        );
        
        if (subTaskIndex >= 0) {
          if (!resultsBySubTask.has(subTaskIndex)) {
            resultsBySubTask.set(subTaskIndex, []);
          }
          resultsBySubTask.get(subTaskIndex)!.push(result);
        }
      }
      
      addLog(`💾 开始保存结果到数据库 (taskDbId: ${taskDbId})...`);
      
      for (const [subTaskIndex, results] of Array.from(resultsBySubTask.entries())) {
        const subTask = subTasks[subTaskIndex];
        addLog(`   • 保存子任务 ${subTaskIndex}: ${results.length} 条结果`);
        await saveSpfSearchResults(taskDbId, subTaskIndex, subTask.name, subTask.location, results);
        totalResults += results.length;
      }
      
      addLog(`✅ 结果保存完成，共 ${totalResults} 条`);
    } else {
      addLog(`⚠️ 无结果需要保存`);
    }
    
    // 计算实际消耗：搜索页 API + 详情页 API 分别计费
    const searchPageCost = totalSearchPages * searchCost;
    const detailPageCost = totalDetailPages * detailCost;
    const actualCost = searchPageCost + detailPageCost;
    
    // 结算积分
    const refund = await settleSpfCredits(userId, frozenAmount, actualCost, taskId);
    
    // 完成日志
    addLog(`═══════════════════════════════════════════════════`);
    addLog(`🎉 搜索任务完成`);
    addLog(`═══════════════════════════════════════════════════`);
    addLog(`📊 搜索统计:`);
    addLog(`   • 搜索页 API: ${totalSearchPages} 次`);
    addLog(`   • 详情页 API: ${totalDetailPages} 次`);
    addLog(`   • 有效结果: ${totalResults} 条`);
    addLog(`   • 缓存命中: ${totalCacheHits} 条`);
    addLog(`💰 费用明细:`);
    addLog(`   • 预扣积分: ${frozenAmount.toFixed(1)} 积分`);
    addLog(`   • 搜索页费用: ${searchPageCost.toFixed(1)} 积分 (${totalSearchPages} x ${searchCost})`);
    addLog(`   • 详情页费用: ${detailPageCost.toFixed(1)} 积分 (${totalDetailPages} x ${detailCost})`);
    addLog(`   • 实际消耗: ${actualCost.toFixed(1)} 积分`);
    if (refund > 0) {
      addLog(`   • ✅ 已退还: ${refund.toFixed(1)} 积分`);
    }
    addLog(`═══════════════════════════════════════════════════`);
    
    await completeSpfSearchTask(taskDbId, {
      totalResults,
      searchPageRequests: totalSearchPages,
      detailPageRequests: totalDetailPages,
      cacheHits: totalCacheHits,
      creditsUsed: actualCost,
      logs,
    });
    
    // 记录用户活动
    await logUserActivity({
      userId,
      action: 'SPF搜索',
      details: `搜索完成: ${input.names.length}个姓名, ${totalResults}条结果, 消耗${actualCost.toFixed(1)}积分`,
      ipAddress: undefined,
      userAgent: undefined
    });
    
  } catch (error: any) {
    addLog(`❌ 搜索任务失败: ${error.message}`);
    
    // 失败时的结算退还：搜索页 + 详情页分别计费
    const partialCost = totalSearchPages * searchCost + totalDetailPages * detailCost;
    const refund = await settleSpfCredits(userId, frozenAmount, partialCost, taskId);
    
    addLog(`💰 失败结算:`);
    addLog(`   • 预扣积分: ${frozenAmount.toFixed(1)} 积分`);
    addLog(`   • 已消耗: ${partialCost.toFixed(1)} 积分`);
    if (refund > 0) {
      addLog(`   • ✅ 已退还: ${refund.toFixed(1)} 积分`);
    }
    
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
