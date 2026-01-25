/**
 * Anywho tRPC 路由
 * 独立模块，方便后期管理和修改
 * 
 * 提供 Anywho 搜索功能的 API 端点
 * 特色功能：婚姻状况查询、运营商信息、已故排除
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { 
  searchOnly,
  fetchDetailsInBatch,
  AnywhoFilters, 
  AnywhoDetailResult,
  AnywhoSearchResult,
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

  logApi,
} from "./db";
import { getDb, logUserActivity } from "../db";
import { anywhoSearchTasks } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

// 并发配置
const TOTAL_CONCURRENCY = ANYWHO_CONFIG.TOTAL_CONCURRENCY;
const SEARCH_CONCURRENCY = ANYWHO_CONFIG.TASK_CONCURRENCY;

// 输入验证 schema
const anywhoFiltersSchema = z.object({
  minAge: z.number().min(0).max(120).optional(),
  maxAge: z.number().min(0).max(120).optional(),
  excludeDeceased: z.boolean().optional(),        // 排除已故人员
  includeMarriageStatus: z.boolean().optional(),
  includeFamilyMembers: z.boolean().optional(),
  includeEmails: z.boolean().optional(),
}).optional();

const anywhoSearchInputSchema = z.object({
  names: z.array(z.string().min(1)).min(1).max(100),
  locations: z.array(z.string()).optional(),
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
      defaultMinAge: config.defaultMinAge || 18,
      defaultMaxAge: config.defaultMaxAge || 99,
    };
  }),

  // 预估搜索消耗
  estimateCost: protectedProcedure
    .input(anywhoSearchInputSchema)
    .query(async ({ input }) => {
      const config = await getAnywhoConfig();
      const searchCost = parseFloat(config.searchCost);
      const detailCost = parseFloat(config.detailCost);
      const maxPages = config.maxPages || 10;
      
      // 计算子任务数
      let subTaskCount = 0;
      if (input.mode === "nameOnly") {
        subTaskCount = input.names.length;
      } else {
        const locations = input.locations || [""];
        subTaskCount = input.names.length * locations.length;
      }
      
      // 预估参数
      const avgDetailsPerTask = 30;
      
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
      
      // 检查用户积分
      const userCredits = await getUserCredits(userId);
      const searchCost = parseFloat(config.searchCost);
      const detailCost = parseFloat(config.detailCost);
      const maxPages = config.maxPages || 10;
      
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
      
      // 预估最小消耗
      const minEstimatedCost = subTasks.length * searchCost;
      if (userCredits < minEstimatedCost) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `积分不足，需要至少 ${minEstimatedCost.toFixed(1)} 积分`,
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
        logs: [{ timestamp: new Date().toISOString(), message: "任务开始执行" }],
      });
      
      // 记录用户活动
      await logUserActivity({
        userId,
        action: "anywho_search",
        details: `开始 Anywho 搜索任务: ${task.taskId}`
      });
      
      // 异步执行搜索
      executeAnywhoSearch(task.taskId, task.id, userId, subTasks, input.filters || {}, config);
      
      return {
        taskId: task.taskId,
        message: "搜索任务已提交",
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
      
      while (true) {
        const { results, total } = await getAnywhoSearchResults(task.id, page, pageSize);
        allResults.push(...results);
        
        if (allResults.length >= total) break;
        page++;
      }
      
      // 完善详细的 CSV 表头
      const headers = [
        "序号",
        "姓名",
        "名",
        "姓",
        "年龄",
        "婚姻状况",
        "婚姻记录",
        "城市",
        "州",
        "完整地址",
        "当前住址",
        "主号码",
        "主号码标识",
        "电话类型",
        "运营商",
        "所有电话",
        "邮箱",
        "家庭成员",
        "是否已故",
        "详情链接",
        "搜索姓名",
        "搜索地点",
        "数据来源",
        "获取时间",
      ];
      
      const rows = allResults.map((r, index) => {
        // 格式化所有电话
        const allPhones = r.allPhones ? (Array.isArray(r.allPhones) ? r.allPhones.join("; ") : r.allPhones) : "";
        // 格式化婚姻记录
        const marriageRecords = r.marriageRecords ? (Array.isArray(r.marriageRecords) ? r.marriageRecords.join("; ") : r.marriageRecords) : "";
        // 格式化家庭成员
        const familyMembers = r.familyMembers ? (Array.isArray(r.familyMembers) ? r.familyMembers.join("; ") : r.familyMembers) : "";
        // 格式化邮箱
        const emails = r.emails ? (Array.isArray(r.emails) ? r.emails.join("; ") : r.emails) : "";
        
        return [
          index + 1,                                    // 序号
          r.name || "",                                 // 姓名
          r.firstName || "",                            // 名
          r.lastName || "",                             // 姓
          r.age || "",                                  // 年龄
          r.marriageStatus || "",                       // 婚姻状况
          marriageRecords,                              // 婚姻记录
          r.city || "",                                 // 城市
          r.state || "",                                // 州
          r.location || "",                             // 完整地址
          r.currentAddress || "",                       // 当前住址
          r.phone || "",                                // 主号码
          r.isPrimary ? "是" : "否",                    // 主号码标识
          r.phoneType || "",                            // 电话类型
          r.carrier || "",                              // 运营商
          allPhones,                                    // 所有电话
          emails,                                       // 邮箱
          familyMembers,                                // 家庭成员
          r.isDeceased ? "是" : "否",                   // 是否已故
          r.detailLink || "",                           // 详情链接
          r.searchName || "",                           // 搜索姓名
          r.searchLocation || "",                       // 搜索地点
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
      await db.update(anywhoSearchTasks)
        .set({ status: "cancelled" })
        .where(eq(anywhoSearchTasks.taskId, input.taskId));
      
      return { success: true, message: "任务已停止" };
    }),
});

/**
 * 异步执行搜索任务
 */
async function executeAnywhoSearch(
  taskId: string,
  taskDbId: number,
  userId: number,
  subTasks: Array<{ name: string; location?: string }>,
  filters: AnywhoFilters,
  config: any
) {
  const token = config.scrapeDoToken;
  const searchCost = parseFloat(config.searchCost);
  const detailCost = parseFloat(config.detailCost);
  const maxPages = config.maxPages || 10;
  
  let totalSearchPages = 0;
  let totalDetailPages = 0;
  let totalCacheHits = 0;
  let totalResults = 0;
  let completedSubTasks = 0;
  
  const logs: Array<{ timestamp: string; message: string }> = [
    { timestamp: new Date().toISOString(), message: "任务开始执行" },
  ];
  
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
    // 阶段1：并发搜索
    await addLog(`开始搜索阶段，共 ${subTasks.length} 个子任务`);
    
    const allDetailTasks: DetailTask[] = [];
    
    // 分批执行搜索
    for (let i = 0; i < subTasks.length; i += SEARCH_CONCURRENCY) {
      // 检查是否取消
      if (await checkCancelled()) {
        await addLog("任务已被用户取消");
        return;
      }
      
      const batch = subTasks.slice(i, i + SEARCH_CONCURRENCY);
      
      const searchPromises = batch.map(async (subTask, batchIndex) => {
        const subTaskIndex = i + batchIndex;
        
        try {
          const { results, pagesSearched } = await searchOnly(
            subTask.name,
            subTask.location,
            maxPages,
            token
          );
          
          totalSearchPages += pagesSearched;
          
          // 收集详情任务
          for (const result of results) {
            allDetailTasks.push({
              detailLink: result.detailLink,
              searchName: subTask.name,
              searchLocation: subTask.location,
              subTaskIndex,
            });
          }
          
          return { success: true, count: results.length };
        } catch (error: any) {
          await addLog(`子任务 ${subTaskIndex + 1} 搜索失败: ${error.message}`);
          return { success: false, count: 0 };
        }
      });
      
      await Promise.all(searchPromises);
      
      completedSubTasks = Math.min(i + batch.length, subTasks.length);
      const progress = Math.floor((completedSubTasks / subTasks.length) * 50);
      
      await updateAnywhoSearchTaskProgress(taskId, {
        progress,
        completedSubTasks,
        searchPageRequests: totalSearchPages,
      });
    }
    
    await addLog(`搜索阶段完成，共找到 ${allDetailTasks.length} 条待获取详情`);
    
    // 阶段2：检查缓存
    const detailLinks = allDetailTasks.map(t => t.detailLink);
    const cachedDetails = await getCachedAnywhoDetails(detailLinks);
    const cachedMap = new Map(cachedDetails.map(c => [c.detailLink, c.data]));
    
    totalCacheHits = cachedDetails.length;
    await addLog(`缓存命中 ${totalCacheHits} 条`);
    
    // 分离缓存命中和需要获取的任务
    const tasksToFetch: DetailTask[] = [];
    const cachedResults: Array<{ task: DetailTask; detail: any }> = [];
    
    for (const task of allDetailTasks) {
      const cached = cachedMap.get(task.detailLink);
      if (cached) {
        cachedResults.push({ task, detail: cached });
      } else {
        tasksToFetch.push(task);
      }
    }
    
    // 阶段3：获取详情
    let fetchedResults: Array<{ task: DetailTask; detail: AnywhoDetailResult | null }> = [];
    
    if (tasksToFetch.length > 0) {
      await addLog(`开始获取 ${tasksToFetch.length} 条详情`);
      
      const { results, requestCount } = await fetchDetailsInBatch(
        tasksToFetch,
        token,
        filters,
        undefined,
        async (completed, total) => {
          // 检查是否取消
          if (await checkCancelled()) {
            throw new Error("任务已被用户取消");
          }
          const progress = 50 + Math.floor((completed / total) * 45);
          await updateAnywhoSearchTaskProgress(taskId, { progress });
        }
      );
      
      fetchedResults = results;
      totalDetailPages = requestCount;
      
      // 保存新获取的缓存
      const newCacheItems = fetchedResults
        .filter(r => r.detail !== null)
        .map(r => ({
          detailLink: r.task.detailLink,
          data: r.detail,
        }));
      
      if (newCacheItems.length > 0) {
        await saveAnywhoDetailCache(newCacheItems);
      }
    }
    
    // 合并结果并应用过滤
    const allResults = [
      ...cachedResults.map(r => ({
        subTaskIndex: r.task.subTaskIndex,
        name: r.detail.name,
        firstName: r.detail.firstName,
        lastName: r.detail.lastName,
        searchName: r.task.searchName,
        searchLocation: r.task.searchLocation,
        age: r.detail.age,
        city: r.detail.city,
        state: r.detail.state,
        location: r.detail.location,
        currentAddress: r.detail.currentAddress,
        phone: r.detail.phone,
        phoneType: r.detail.phoneType,
        carrier: r.detail.carrier,
        allPhones: r.detail.allPhones || [],
        reportYear: r.detail.reportYear,
        isPrimary: true,  // 第一个号码为主号码
        marriageStatus: r.detail.marriageStatus,
        marriageRecords: r.detail.marriageRecords || [],
        familyMembers: r.detail.familyMembers || [],
        emails: r.detail.emails || [],
        isDeceased: r.detail.isDeceased || false,
        detailLink: r.task.detailLink,
        fromCache: true,
      })),
      ...fetchedResults
        .filter(r => r.detail !== null)
        .map(r => ({
          subTaskIndex: r.task.subTaskIndex,
          name: r.detail!.name,
          firstName: r.detail!.firstName,
          lastName: r.detail!.lastName,
          searchName: r.task.searchName,
          searchLocation: r.task.searchLocation,
          age: r.detail!.age,
          city: r.detail!.city,
          state: r.detail!.state,
          location: r.detail!.location,
          currentAddress: r.detail!.currentAddress,
          phone: r.detail!.phone,
          phoneType: r.detail!.phoneType,
          carrier: r.detail!.carrier,
          allPhones: r.detail!.phones || [],
          reportYear: r.detail!.reportYear,
          isPrimary: true,  // 第一个号码为主号码
          marriageStatus: r.detail!.marriageStatus,
          marriageRecords: r.detail!.marriageRecords || [],
          familyMembers: r.detail!.familyMembers || [],
          emails: r.detail!.emails || [],
          isDeceased: r.detail!.isDeceased || false,
          detailLink: r.task.detailLink,
          fromCache: false,
        })),
    ];
    
    // 应用过滤条件
    let filteredResults = allResults;
    
    // 排除已故人员
    if (filters.excludeDeceased) {
      filteredResults = filteredResults.filter(r => !r.isDeceased);
      await addLog(`排除已故人员后剩余 ${filteredResults.length} 条`);
    }
    
    // 年龄过滤
    if (filters.minAge !== undefined || filters.maxAge !== undefined) {
      filteredResults = filteredResults.filter(r => {
        if (r.age === null || r.age === undefined) return true;  // 保留年龄未知的
        if (filters.minAge !== undefined && r.age < filters.minAge) return false;
        if (filters.maxAge !== undefined && r.age > filters.maxAge) return false;
        return true;
      });
      await addLog(`年龄过滤后剩余 ${filteredResults.length} 条`);
    }
    
    totalResults = filteredResults.length;
    
    // 保存结果
    if (filteredResults.length > 0) {
      await saveAnywhoSearchResults(taskDbId, filteredResults);
    }
    
    // 计算消耗积分
    const creditsUsed = (totalSearchPages * searchCost) + (totalDetailPages * detailCost);
    
    // 扣除积分
    await deductCredits(userId, creditsUsed, "search", `Anywho 搜索任务 ${taskId.slice(0, 8)}`, taskId);
    
    // 完成任务
    await completeAnywhoSearchTask(taskId, {
      totalResults,
      creditsUsed: creditsUsed.toFixed(2),
      searchPageRequests: totalSearchPages,
      detailPageRequests: totalDetailPages,
      cacheHits: totalCacheHits,
    });
    
    await addLog(`任务完成，共 ${totalResults} 条结果，消耗 ${creditsUsed.toFixed(1)} 积分`);
    
  } catch (error: any) {
    console.error(`[Anywho] 任务 ${taskId} 执行失败:`, error);
    await failAnywhoSearchTask(taskId, error.message || "未知错误");
    await addLog(`任务失败: ${error.message}`);
  }
}
