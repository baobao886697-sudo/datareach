/**
 * LinkedIn 搜索模块 - 路由定义
 * 
 * 包含所有LinkedIn搜索相关的API路由
 */

import { router, protectedProcedure } from '../_core/trpc';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

// 从本模块导入
import {
  getUserCredits,
  getSearchTask,
  getUserSearchTasks,
  getSearchResults,
  updateSearchTaskStatus
} from './db';
import { getSearchCreditsConfig } from './config';
import { previewSearch, executeSearchV3 } from './processor';

// ============ 辅助函数 ============

/**
 * 格式化电话号码 - 转换为标准美国号码纯数字格式（11位，以1开头）
 * 例如：+1 (410) 279-7891 -> 14102797891
 *       (301) 790-1980 -> 13017901980
 */
function formatPhoneNumber(phone: string | null | undefined): string {
  if (!phone) return "";
  // 移除所有非数字字符
  const digits = phone.replace(/\D/g, '');
  // 如果是10位数字，添加1前缀（美国国家代码）
  if (digits.length === 10) {
    return `1${digits}`;
  }
  // 如果是11位且以1开头，直接返回
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits;
  }
  // 其他情况返回纯数字
  return digits;
}

// ============ 路由定义 ============

export const linkedinRouter = router({
  // 获取积分配置 - 前端用于显示动态积分价格
  creditsConfig: protectedProcedure
    .query(async () => {
      const config = await getSearchCreditsConfig();
      return {
        fuzzy: {
          searchCredits: config.fuzzySearchCredits,
          creditsPerPerson: config.fuzzyCreditsPerPerson,
        },
        exact: {
          searchCredits: config.exactSearchCredits,
          creditsPerPerson: config.exactCreditsPerPerson,
        },
      };
    }),

  // 预览搜索 - 获取总数和预估费用
  preview: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, "请输入姓名"),
        title: z.string().min(1, "请输入职位"),
        state: z.string().min(1, "请选择州"),
        limit: z.number().min(10).max(10000).optional().default(10),
        ageMin: z.number().min(18).max(80).optional(),
        ageMax: z.number().min(18).max(80).optional(),
        mode: z.enum(["fuzzy", "exact"]).optional().default("fuzzy"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await previewSearch(
          ctx.user.id,
          input.name,
          input.title,
          input.state,
          input.limit,
          input.ageMin,
          input.ageMax,
          input.mode
        );
        return result;
      } catch (error: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message || "预览搜索失败",
        });
      }
    }),

  // 开始搜索
  start: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1, "请输入姓名"),
        title: z.string().min(1, "请输入职位"),
        state: z.string().min(1, "请选择州"),
        limit: z.number().min(10).max(10000).optional().default(10),
        ageMin: z.number().min(18).max(80).optional(),
        ageMax: z.number().min(18).max(80).optional(),
        mode: z.enum(["fuzzy", "exact"]).optional().default("fuzzy"),
        enableVerification: z.boolean().optional().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // 检查积分 - 严格模式：必须足够支付全部预估费用
      const credits = await getUserCredits(ctx.user.id);
      // 从数据库获取积分配置
      const creditsConfig = await getSearchCreditsConfig();
      const searchCost = input.mode === 'exact' ? creditsConfig.exactSearchCredits : creditsConfig.fuzzySearchCredits;
      const phoneCostPerPerson = input.mode === 'exact' ? creditsConfig.exactCreditsPerPerson : creditsConfig.fuzzyCreditsPerPerson;
      const phoneCost = input.limit * phoneCostPerPerson;
      const totalCost = searchCost + phoneCost;
      
      if (credits < totalCost) {
        // 计算用户积分最多能搜索多少条
        const maxAffordable = Math.floor((credits - searchCost) / phoneCostPerPerson);
        if (maxAffordable <= 0) {
          throw new TRPCError({ 
            code: "PAYMENT_REQUIRED", 
            message: `积分不足，无法开始搜索。当前积分: ${credits}，需要至少 ${searchCost + phoneCostPerPerson} 积分` 
          });
        }
        throw new TRPCError({ 
          code: "PAYMENT_REQUIRED", 
          message: `积分不足。当前积分: ${credits}，搜索 ${input.limit} 条需要 ${totalCost} 积分。您最多可搜索 ${maxAffordable} 条，或请先充值。` 
        });
      }

      try {
        // 使用搜索处理器
        const task = await executeSearchV3(
          ctx.user.id,
          input.name,
          input.title,
          input.state,
          input.limit,
          input.ageMin,
          input.ageMax,
          input.enableVerification,
          input.mode
        );

        return {
          success: true,
          taskId: task?.taskId,
          message: "搜索任务已创建",
        };
      } catch (error: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message || "搜索失败",
        });
      }
    }),

  // 获取任务状态
  taskStatus: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(async ({ ctx, input }) => {
      const task = await getSearchTask(input.taskId);
      if (!task || task.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
      }
      return task;
    }),

  // 获取任务列表
  tasks: protectedProcedure
    .input(z.object({ limit: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      return getUserSearchTasks(ctx.user.id, 1, input.limit || 50);
    }),

  // 获取搜索结果
  results: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(async ({ ctx, input }) => {
      const task = await getSearchTask(input.taskId);
      if (!task || task.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
      }
      return getSearchResults(task.id);
    }),

  // 停止搜索任务
  stop: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const task = await getSearchTask(input.taskId);
      if (!task || task.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
      }
      
      if (task.status !== 'running' && task.status !== 'pending') {
        throw new TRPCError({ code: "BAD_REQUEST", message: "任务已完成或已停止" });
      }
      
      // 更新任务状态为已停止
      await updateSearchTaskStatus(input.taskId, 'stopped');
      
      // 记录日志
      console.log(`[LinkedIn] User ${ctx.user.id} stopped task ${input.taskId}`);
      
      return { success: true, message: "搜索任务已停止" };
    }),

  // 导出CSV
  exportCsv: protectedProcedure
    .input(z.object({ 
      taskId: z.string(),
      format: z.enum(['standard', 'detailed', 'minimal']).optional().default('standard'),
      includeUnverified: z.boolean().optional().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const task = await getSearchTask(input.taskId);
      if (!task || task.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
      }

      const results = await getSearchResults(task.id);
      const searchParams = task.params as any || {};
      
      // 根据格式选择字段
      let headers: string[];
      let getRowData: (r: any, data: any, index: number) => string[];
      
      if (input.format === 'minimal') {
        // 简洁版 - 只包含核心字段
        headers = ["姓名", "职位", "公司", "电话", "邮箱", "LinkedIn"];
        getRowData = (r, data, index) => [
          data.fullName || data.name || "",
          data.title || "",
          data.company || data.organization_name || "",
          formatPhoneNumber(data.phone || data.phoneNumber),
          data.email || "",
          data.linkedinUrl || data.linkedin_url || "",
        ];
      } else if (input.format === 'detailed') {
        // 详细版 - 包含所有字段
        headers = [
          "序号", "Apollo ID", "姓名", "名", "姓", "年龄",
          "职位", "公司", "行业", "公司规模",
          "城市", "州/省", "国家", "邮编", "完整地址",
          "主要电话", "电话类型", "运营商", "电话状态",
          "主要邮箱", "备用邮箱", "邮箱状态",
          "LinkedIn URL", "LinkedIn 用户名", "Twitter", "Facebook",
          "验证状态", "验证来源", "匹配分数", "验证时间",
          "创建时间", "更新时间", "数据来源",
          "搜索关键词", "搜索职位", "搜索地区",
        ];
        getRowData = (r, data, index) => [
          (index + 1).toString(),
          data.apolloId || r.apolloId || "",
          data.fullName || data.name || "",
          data.firstName || data.first_name || "",
          data.lastName || data.last_name || "",
          data.age?.toString() || "",
          data.title || "",
          data.company || data.organization_name || "",
          data.industry || "",
          data.companySize || "",
          data.city || "",
          data.state || "",
          data.country || "",
          data.postalCode || data.postal_code || "",
          data.fullAddress || "",
          formatPhoneNumber(data.phone || data.phoneNumber),
          data.phoneType || "",
          data.carrier || "",
          data.phoneStatus || "",
          data.email || "",
          data.secondaryEmail || "",
          data.emailStatus || "",
          data.linkedinUrl || data.linkedin_url || "",
          data.linkedinUsername || "",
          data.twitter || "",
          data.facebook || "",
          r.verified ? "已验证" : "未验证",
          r.verificationSource || data.verificationSource || "",
          r.verificationScore?.toString() || "",
          data.verifiedAt || "",
          r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN') : "",
          r.updatedAt ? new Date(r.updatedAt).toLocaleString('zh-CN') : "",
          "Apify/BrightData",
          searchParams.name || "",
          searchParams.title || "",
          searchParams.state || "",
        ];
      } else {
        // 标准版
        headers = [
          "序号", "姓名", "名", "姓", "年龄",
          "职位", "公司", "行业",
          "城市", "州", "国家",
          "电话号码", "电话类型", "电话状态",
          "邮箱",
          "LinkedIn",
          "双验证",
          "获取时间",
        ];
        getRowData = (r, data, index) => [
          (index + 1).toString(),
          data.fullName || data.name || "",
          data.firstName || data.first_name || "",
          data.lastName || data.last_name || "",
          data.age?.toString() || "",
          data.title || "",
          data.company || data.organization_name || "",
          data.industry || "",
          data.city || "",
          data.state || "",
          data.country || "",
          formatPhoneNumber(data.phone || data.phoneNumber),
          data.phoneType || "",
          data.phoneStatus || "",
          data.email || "",
          data.linkedinUrl || data.linkedin_url || "",
          r.verified ? "已验证" : "未验证",
          r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN') : "",
        ];
      }

      // 过滤未验证结果（如果需要）
      const filteredResults = input.includeUnverified 
        ? results 
        : results.filter(r => r.verified);

      const rows = filteredResults.map((r, index) => {
        const data = r.data as any || {};
        return getRowData(r, data, index);
      });

      // 添加 BOM 以支持 Excel 正确显示中文
      const BOM = '\uFEFF';
      const csvContent = BOM + [
        headers.join(","),
        ...rows.map((row) =>
          row.map((cell) => `"${(cell || "").replace(/"/g, '""')}"`).join(",")
        ),
      ].join("\n");

      // 生成文件名
      const formatSuffix = input.format === 'detailed' ? '_detailed' : input.format === 'minimal' ? '_minimal' : '';
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const filename = `DataReach_${searchParams.name || 'search'}_${searchParams.state || 'US'}_${timestamp}${formatSuffix}.csv`;

      return {
        filename,
        content: csvContent,
        mimeType: "text/csv;charset=utf-8",
        totalRecords: filteredResults.length,
        format: input.format,
      };
    }),
});

// 导出类型
export type LinkedinRouter = typeof linkedinRouter;
