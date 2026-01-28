import { z } from "zod";
import { TRPCError } from "@trpc/server";

// 格式化电话号码 - 确保美国号码为11位（以1开头）
function formatPhoneNumber(phone: string | undefined | null): string {
  if (!phone) return "";
  // 移除所有非数字字符
  const digits = phone.replace(/\D/g, "");
  // 如果是10位数字，在前面加1（美国国家代码）
  if (digits.length === 10) {
    return "1" + digits;
  }
  return digits;
}
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { tpsRouter } from "./tps/router";
import { anywhoRouter } from "./anywho/router";
import { spfRouter } from "./spf/router";
import { linkedinRouter } from "./linkedin/router";
import { agentRouter, adminAgentRouter } from "./agent/router";
import { sendPasswordResetEmail } from "./services/email";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { sdk } from "./_core/sdk";
import { validateAdminCredentials, generateAdminToken, verifyAdminToken, getAdminTokenFromHeader } from "./_core/adminAuth";
import {
  createUser,
  getUserByEmail,
  getUserById,
  verifyUserEmail,
  createPasswordResetToken,
  resetPassword,
  updateUserLastSignIn,
  updateUserDevice,
  getAllUsers,
  updateUserStatus,
  updateUserRole,
  getUserCredits,
  deductCredits,
  addCredits,
  getCreditTransactions,
  createSearchTask,
  getSearchTask,
  getUserSearchTasks,
  getSearchResults,
  updateSearchTaskStatus,
  createRechargeOrder,
  createRechargeOrderWithUniqueAmount,
  getRechargeOrder,
  confirmRechargeOrder,
  getUserRechargeOrders,
  getAllRechargeOrders,
  updateRechargeOrderStatus,
  cancelRechargeOrder,
  markOrderMismatch,
  resolveMismatchOrder,
  expireOldOrders,
  getApiLogs,
  getAdminLogs,
  getLoginLogs,
  logAdmin,
  logLogin,
  getConfig,
  setConfig,
  getAllConfigs,
  deleteConfig,
  getSearchStats,
  getUserStats,
  getRechargeStats,
  getAdminDashboardStats,
  getCacheStats,
  clearUserDevice,
  // 新增功能
  getUserDetail,
  adminResetPassword,
  getUserSearchHistory,
  getUserCreditHistory,
  getUserLoginHistory,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getAnnouncementsAdmin,
  getActiveAnnouncements,
  sendMessageToUser,
  sendMessageToUsers,
  getUserMessages,
  markMessageAsRead,
  markAllMessagesAsRead,
  logUserActivity,
  getUserActivityLogs,
  logError,
  getErrorLogs,
  resolveError,
  updateApiStats,
  getApiStatistics,
  refundOrder,
  searchOrders,
  // 用户反馈系统
  createFeedback,
  getUserFeedbacks,
  getAllFeedbacks,
  replyFeedback,
  updateFeedbackStatus,
  getFeedbackById,
  // 积分报表系统（新增）
  getAdvancedCreditLogs,
  getUserCreditStats,
  getGlobalCreditReport,
  exportUserCreditLogs,
  getCreditAnomalies,
} from "./db";
// Apollo 相关处理器已移除
// [已迁移到 linkedin 模块] 保留原导入以便回滚
// import { previewSearch, executeSearchV3, getSearchCreditsConfig } from "./services/searchProcessorV3";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// 管理员权限检查 - 使用独立的管理员token验证
const adminProcedure = publicProcedure.use(({ ctx, next }) => {
  const adminToken = getAdminTokenFromHeader(ctx.req.headers as Record<string, string | string[] | undefined>);
  
  if (!adminToken) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "需要管理员登录" });
  }
  
  const payload = verifyAdminToken(adminToken);
  if (!payload) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "管理员Token无效或已过期" });
  }
  
  return next({ 
    ctx: {
      ...ctx,
      adminUser: payload,
    }
  });
});

export const appRouter = router({
  system: systemRouter,
  tps: tpsRouter,  // TruePeopleSearch 路由
  anywho: anywhoRouter,  // Anywho 路由
  spf: spfRouter,  // SearchPeopleFree 路由
  agent: agentRouter,  // 代理系统路由

  // ============ 认证路由 ============
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),

    // 邮箱注册
    register: publicProcedure
      .input(
        z.object({
          email: z.string().email("请输入有效的邮箱地址"),
          password: z.string().min(8, "密码至少8位"),
          name: z.string().optional(),
          inviteCode: z.string().optional(), // 邀请码
        })
      )
      .mutation(async ({ input }) => {
        const existing = await getUserByEmail(input.email);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "该邮箱已被注册" });
        }

        // 验证邀请码
        let inviterId: number | undefined;
        if (input.inviteCode) {
          const { findUserByInviteCode } = await import("./agentDb");
          const inviter = await findUserByInviteCode(input.inviteCode);
          if (inviter && inviter.isAgent) {
            inviterId = inviter.id;
          }
        }

        const passwordHash = await bcrypt.hash(input.password, 12);
        const user = await createUser(input.email, passwordHash, input.name, inviterId);

        if (!user) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "注册失败" });
        }

        // TODO: 发送验证邮件
        // await sendVerificationEmail(user.email, user.verificationToken);

        return {
          success: true,
          message: "注册成功，请查收验证邮件",
          userId: user.id,
        };
      }),

    // 邮箱登录（支持单设备限制）
    login: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          password: z.string(),
          deviceId: z.string().optional(),
          force: z.boolean().optional(), // 强制登录，踢掉其他设备
        })
      )
      .mutation(async ({ input, ctx }) => {
        const user = await getUserByEmail(input.email);
        if (!user || !user.passwordHash) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "邮箱或密码错误" });
        }

        const valid = await bcrypt.compare(input.password, user.passwordHash);
        if (!valid) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "邮箱或密码错误" });
        }

        if (user.status === "disabled") {
          throw new TRPCError({ code: "FORBIDDEN", message: "账户已被禁用" });
        }

        // 单设备登录检查
        const deviceId = input.deviceId || `unknown_${Date.now()}`;
        if (user.currentDeviceId && user.currentDeviceId !== deviceId && !input.force) {
          // 已在其他设备登录
          const loginTime = user.currentDeviceLoginAt 
            ? new Date(user.currentDeviceLoginAt).toLocaleString()
            : "未知时间";
          throw new TRPCError({ 
            code: "FORBIDDEN", 
            message: `账户已在其他设备登录（${loginTime}）。如需在此设备登录，请点击"强制登录"` 
          });
        }

        // 更新设备信息
        await updateUserDevice(user.id, deviceId);

        // 记录登录日志
        const ipAddress = ctx.req.headers["x-forwarded-for"] as string || ctx.req.socket?.remoteAddress || null;
        const userAgent = ctx.req.headers["user-agent"] || null;
        await logLogin(user.id, deviceId, ipAddress, userAgent, true);

        // 记录用户活动日志
        await logUserActivity({
          userId: user.id,
          action: input.force ? '强制登录' : '用户登录',
          details: `设备ID: ${deviceId}`,
          ipAddress,
          userAgent
        });

        // 创建会话
        const openId = user.openId || `email_${user.id}`;
        const sessionToken = await sdk.createSessionToken(openId, {
          name: user.name || user.email,
          expiresInMs: ONE_YEAR_MS,
        });

        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

        return {
          success: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            credits: user.credits,
            role: user.role,
          },
        };
      }),

    // 验证邮箱
    verifyEmail: publicProcedure
      .input(z.object({ token: z.string() }))
      .mutation(async ({ input }) => {
        const success = await verifyUserEmail(input.token);
        if (!success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "验证链接无效或已过期" });
        }
        return { success: true, message: "邮箱验证成功" };
      }),

    // 请求密码重置
    requestPasswordReset: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(async ({ input }) => {
        const token = await createPasswordResetToken(input.email);
        if (token) {
          // 发送密码重置邮件
          await sendPasswordResetEmail(input.email, token);
        }
        // 无论是否存在都返回成功，防止邮箱枚举
        return { success: true, message: "如果该邮箱已注册，您将收到重置链接" };
      }),

    // 重置密码
    resetPassword: publicProcedure
      .input(
        z.object({
          token: z.string(),
          newPassword: z.string().min(8),
        })
      )
      .mutation(async ({ input }) => {
        const passwordHash = await bcrypt.hash(input.newPassword, 12);
        const success = await resetPassword(input.token, passwordHash);
        if (!success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "重置链接无效或已过期" });
        }
        return { success: true, message: "密码重置成功" };
      }),
  }),

  // ============ 用户路由 ============
  user: router({
    // 获取当前用户信息
    profile: protectedProcedure.query(async ({ ctx }) => {
      const user = await getUserById(ctx.user.id);
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
      }
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        credits: user.credits,
        role: user.role,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
      };
    }),

    // 获取积分余额
    credits: protectedProcedure.query(async ({ ctx }) => {
      const credits = await getUserCredits(ctx.user.id);
      return { credits };
    }),

    // 获取积分交易记录
    creditHistory: protectedProcedure
      .input(z.object({ limit: z.number().optional() }))
      .query(async ({ ctx, input }) => {
        return getCreditTransactions(ctx.user.id, input.limit);
      }),
  }),

  // ============ 搜索路由 ============
  // [已迁移到 linkedin 独立模块] 使用新的 linkedinRouter
  search: linkedinRouter,

  // ============ [备份] 旧搜索路由代码 - 保留以便回滚 ============
  // 如需回滚，取消下面的注释并注释掉上面的 linkedinRouter
  /*
  search_backup: router({
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

    // 开始搜索（增强版 V2）
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
          // 使用 Apify 搜索处理器 V3（替代 Apollo）
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
        console.log(`[TASK] User ${ctx.user.id} stopped task ${input.taskId}`);
        
        return { success: true, message: "搜索任务已停止" };
      }),

    // 导出CSV（增强版 - 40+ 字段）
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
            // 序号和基本信息
            "序号", "Apollo ID", "姓名", "名", "姓", "年龄",
            // 职业信息
            "职位", "公司", "行业", "公司规模",
            // 地理位置
            "城市", "州/省", "国家", "邮编", "完整地址",
            // 联系方式
            "主要电话", "电话类型", "运营商", "电话状态",
            "主要邮箱", "备用邮箱", "邮箱状态",
            // 社交媒体
            "LinkedIn URL", "LinkedIn 用户名", "Twitter", "Facebook",
            // 验证信息
            "验证状态", "验证来源", "匹配分数", "验证时间",
            // 元数据
            "创建时间", "更新时间", "数据来源",
            // 搜索信息
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
            "Apollo + Scrape.do",
            searchParams.name || "",
            searchParams.title || "",
            searchParams.state || "",
          ];
        } else {
          // 标准版 - 精简字段选择（删除运营商/匹配分数/验证来源）
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
  }),
  */
  // ============ [备份结束] 旧搜索路由代码 ============

  // ============ 充值路由 ============
  recharge: router({
    // 创建充值订单（带唯一尾数）
    create: protectedProcedure
      .input(
        z.object({
          credits: z.number().min(5000, "最少充值5000积分"),
          network: z.enum(["TRC20", "ERC20", "BEP20"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // 从数据库获取积分兑换比例配置（默认 1 USDT = 100 积分）
        const creditsPerUsdtStr = await getConfig('CREDITS_PER_USDT');
        const creditsPerUsdt = creditsPerUsdtStr ? parseInt(creditsPerUsdtStr, 10) : 100;
        
        // 计算需要支付的 USDT 金额
        const baseAmount = input.credits / creditsPerUsdt;
        
        // 阶梯优惠规则：根据USDT金额计算赠送比例（保守方案）
        const bonusTiers = [
          { minUsdt: 10000, bonusPercent: 15 },  // 10000+ USDT: 15%
          { minUsdt: 5000, bonusPercent: 14 },   // 5000-9999 USDT: 14%
          { minUsdt: 3000, bonusPercent: 12 },   // 3000-4999 USDT: 12%
          { minUsdt: 1000, bonusPercent: 10 },   // 1000-2999 USDT: 10%
          { minUsdt: 500, bonusPercent: 8 },     // 500-999 USDT: 8%
          { minUsdt: 300, bonusPercent: 6 },     // 300-499 USDT: 6%
          { minUsdt: 200, bonusPercent: 4 },     // 200-299 USDT: 4%
          { minUsdt: 100, bonusPercent: 2 },     // 100-199 USDT: 2%
          { minUsdt: 0, bonusPercent: 0 },       // 50-99 USDT: 无赠送
        ];
        
        // 查找适用的优惠档位
        const applicableTier = bonusTiers.find(tier => baseAmount >= tier.minUsdt) || { bonusPercent: 0 };
        const bonusPercent = applicableTier.bonusPercent;
        const bonusCredits = Math.floor(input.credits * bonusPercent / 100);
        const totalCredits = input.credits + bonusCredits;

        // 获取收款地址
        const walletAddress = await getConfig(`USDT_WALLET_${input.network || "TRC20"}`);
        if (!walletAddress) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "收款地址未配置",
          });
        }

        // 使用唯一尾数创建订单（使用总积分数 = 基础积分 + 赠送积分）
        const order = await createRechargeOrderWithUniqueAmount(
          ctx.user.id,
          totalCredits,  // 使用包含赠送的总积分
          baseAmount,
          walletAddress,
          input.network || "TRC20"
        );

        if (!order) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "创建订单失败",
          });
        }

        // 记录用户活动日志
        const bonusInfo = bonusCredits > 0 ? `, 赠送${bonusCredits}积分(${bonusPercent}%)` : '';
        await logUserActivity({
          userId: ctx.user.id,
          action: '创建充值订单',
          details: `订单号: ${order.orderId}, 充值${input.credits}积分${bonusInfo}, 实际获得${totalCredits}积分, 金额${order.amount}USDT`,
          ipAddress: ctx.req.headers["x-forwarded-for"] as string || ctx.req.socket?.remoteAddress || null,
          userAgent: ctx.req.headers["user-agent"] || null
        });

        return {
          orderId: order.orderId,
          credits: order.credits,
          baseCredits: input.credits,      // 基础积分
          bonusCredits: bonusCredits,      // 赠送积分
          bonusPercent: bonusPercent,      // 赠送比例
          usdtAmount: order.amount,
          walletAddress: order.walletAddress,
          network: order.network,
          expiresAt: order.expiresAt,
        };
      }),

    // 获取订单状态
    status: protectedProcedure
      .input(z.object({ orderId: z.string() }))
      .query(async ({ ctx, input }) => {
        const order = await getRechargeOrder(input.orderId);
        if (!order || order.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "订单不存在" });
        }
        return order;
      }),

    // 获取充值配置（公开接口，用于前端显示积分价格）
    config: publicProcedure.query(async () => {
      // 从数据库获取充值相关配置
      const creditsPerUsdtStr = await getConfig('CREDITS_PER_USDT');
      const minRechargeCreditsStr = await getConfig('MIN_RECHARGE_CREDITS');
      
      // 阶梯优惠规则：根据USDT金额给予不同比例的赠送（保守方案）
      const bonusTiers = [
        { minUsdt: 10000, bonusPercent: 15 },  // 10000+ USDT: 15%
        { minUsdt: 5000, bonusPercent: 14 },   // 5000-9999 USDT: 14%
        { minUsdt: 3000, bonusPercent: 12 },   // 3000-4999 USDT: 12%
        { minUsdt: 1000, bonusPercent: 10 },   // 1000-2999 USDT: 10%
        { minUsdt: 500, bonusPercent: 8 },     // 500-999 USDT: 8%
        { minUsdt: 300, bonusPercent: 6 },     // 300-499 USDT: 6%
        { minUsdt: 200, bonusPercent: 4 },     // 200-299 USDT: 4%
        { minUsdt: 100, bonusPercent: 2 },     // 100-199 USDT: 2%
        { minUsdt: 0, bonusPercent: 0 },       // 50-99 USDT: 无赠送
      ];
      
      return {
        // 1 USDT 兑换的积分数（默认 100）
        creditsPerUsdt: creditsPerUsdtStr ? parseInt(creditsPerUsdtStr, 10) : 100,
        // 最低充值积分数（默认 5000，对应 50 USDT）
        minRechargeCredits: minRechargeCreditsStr ? parseInt(minRechargeCreditsStr, 10) : 5000,
        // 阶梯优惠规则
        bonusTiers,
      };
    }),

    // 获取充值记录
    history: protectedProcedure
      .input(z.object({ limit: z.number().optional(), page: z.number().optional() }))
      .query(async ({ ctx, input }) => {
        return getUserRechargeOrders(ctx.user.id, input.page || 1, input.limit || 20);
      }),

    // 手动确认支付（管理员或webhook调用）
    confirm: adminProcedure
      .input(
        z.object({
          orderId: z.string(),
          txHash: z.string(),
          actualAmount: z.string(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const success = await confirmRechargeOrder(
          input.orderId,
          input.txHash,
          input.actualAmount
        );

        if (!success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "确认支付失败",
          });
        }

        // 记录管理员操作日志
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'confirm_order',
          'order',
          input.orderId,
          { txHash: input.txHash, actualAmount: input.actualAmount }
        );

        return { success: true };
      }),
  }),

  // ============ 管理员认证路由（独立系统）============
  adminAuth: router({
    // 管理员登录
    login: publicProcedure
      .input(
        z.object({
          username: z.string(),
          password: z.string(),
        })
      )
      .mutation(async ({ input }) => {
        if (!validateAdminCredentials(input.username, input.password)) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "用户名或密码错误",
          });
        }

        const token = generateAdminToken(input.username);
        return {
          success: true,
          token,
          expiresIn: 24 * 60 * 60, // 24小时
        };
      }),

    // 验证管理员token
    verify: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(({ input }) => {
        const payload = verifyAdminToken(input.token);
        if (!payload) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "管理员Token无效或已过期",
          });
        }
        return {
          valid: true,
          username: payload.username,
        };
      }),

    // 管理员登出（前端清除token即可）
    logout: publicProcedure.mutation(() => {
      return { success: true };
    }),
  }),

  // ============ 管理员路由 ============
  admin: router({
    // 获取完整仪表盘统计
    dashboardStats: adminProcedure.query(async () => {
      return getAdminDashboardStats();
    }),

    // 获取所有用户
    users: adminProcedure
      .input(z.object({
        page: z.number().optional(),
        limit: z.number().optional(),
        search: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        return getAllUsers(input?.page || 1, input?.limit || 20, input?.search);
      }),

    // 更新用户状态
    updateUserStatus: adminProcedure
      .input(
        z.object({
          userId: z.number(),
          status: z.enum(["active", "disabled"]),
        })
      )
      .mutation(async ({ input, ctx }) => {
        await updateUserStatus(input.userId, input.status);
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'update_user_status',
          'user',
          input.userId.toString(),
          { status: input.status }
        );
        return { success: true };
      }),

    // 更新用户角色
    updateUserRole: adminProcedure
      .input(
        z.object({
          userId: z.number(),
          role: z.enum(["user", "admin"]),
        })
      )
      .mutation(async ({ input, ctx }) => {
        await updateUserRole(input.userId, input.role);
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'update_user_role',
          'user',
          input.userId.toString(),
          { role: input.role }
        );
        return { success: true };
      }),

    // 强制用户下线（清除设备绑定）
    forceLogout: adminProcedure
      .input(z.object({ userId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await clearUserDevice(input.userId);
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'force_logout',
          'user',
          input.userId.toString()
        );
        return { success: true };
      }),

    // 调整用户积分
    adjustCredits: adminProcedure
      .input(
        z.object({
          userId: z.number(),
          amount: z.number(),
          reason: z.string(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const result = await addCredits(
          input.userId,
          input.amount,
          "admin_add",
          input.reason
        );

        if (!result.success) {
          throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
        }

        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          input.amount > 0 ? 'add_credits' : 'deduct_credits',
          'user',
          input.userId.toString(),
          { amount: input.amount, reason: input.reason, newBalance: result.newBalance }
        );

        return { success: true, newBalance: result.newBalance };
      }),

    // 获取搜索统计
    stats: adminProcedure.query(async () => {
      return getSearchStats();
    }),

    // ============ 订单管理 ============
    
    // 获取所有充值订单
    orders: adminProcedure
      .input(z.object({
        page: z.number().optional(),
        limit: z.number().optional(),
        status: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        return getAllRechargeOrders(input?.page || 1, input?.limit || 20, input?.status);
      }),

    // 获取单个订单详情
    orderDetail: adminProcedure
      .input(z.object({ orderId: z.string() }))
      .query(async ({ input }) => {
        const order = await getRechargeOrder(input.orderId);
        if (!order) {
          throw new TRPCError({ code: "NOT_FOUND", message: "订单不存在" });
        }
        // 获取用户信息
        const user = await getUserById(order.userId);
        return { ...order, user };
      }),

    // 手动确认订单到账
    confirmOrder: adminProcedure
      .input(z.object({
        orderId: z.string(),
        txId: z.string(),
        receivedAmount: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const success = await confirmRechargeOrder(input.orderId, input.txId, input.receivedAmount);
        if (!success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "确认失败，订单可能已处理或不存在" });
        }
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'confirm_order',
          'order',
          input.orderId,
          { txId: input.txId, receivedAmount: input.receivedAmount }
        );
        return { success: true };
      }),

    // 取消订单
    cancelOrder: adminProcedure
      .input(z.object({
        orderId: z.string(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const success = await cancelRechargeOrder(input.orderId, input.reason);
        if (!success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "取消失败，订单可能已处理" });
        }
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'cancel_order',
          'order',
          input.orderId,
          { reason: input.reason }
        );
        return { success: true };
      }),

    // 标记订单金额不匹配
    markOrderMismatch: adminProcedure
      .input(z.object({
        orderId: z.string(),
        receivedAmount: z.string(),
        txId: z.string(),
        adminNote: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const success = await markOrderMismatch(input.orderId, input.receivedAmount, input.txId, input.adminNote);
        if (!success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "操作失败" });
        }
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'mark_order_mismatch',
          'order',
          input.orderId,
          { receivedAmount: input.receivedAmount, txId: input.txId }
        );
        return { success: true };
      }),

    // 处理金额不匹配订单
    resolveMismatchOrder: adminProcedure
      .input(z.object({
        orderId: z.string(),
        actualCredits: z.number(),
        adminNote: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const success = await resolveMismatchOrder(input.orderId, input.actualCredits, input.adminNote);
        if (!success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "处理失败" });
        }
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'resolve_mismatch_order',
          'order',
          input.orderId,
          { actualCredits: input.actualCredits }
        );
        return { success: true };
      }),

    // ============ 日志管理 ============

    // 获取API日志
    apiLogs: adminProcedure
      .input(z.object({
        page: z.number().optional(),
        limit: z.number().optional(),
        apiType: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        return getApiLogs(input?.page || 1, input?.limit || 50, input?.apiType);
      }),

    // 获取管理员操作日志
    adminLogs: adminProcedure
      .input(z.object({
        page: z.number().optional(),
        limit: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        return getAdminLogs(input?.page || 1, input?.limit || 50);
      }),

    // 获取登录日志
    loginLogs: adminProcedure
      .input(z.object({
        page: z.number().optional(),
        limit: z.number().optional(),
        userId: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        return getLoginLogs(input?.page || 1, input?.limit || 50, input?.userId);
      }),

    // ============ 系统配置 ============

    // 获取系统配置
    configs: adminProcedure.query(async () => {
      return getAllConfigs();
    }),

    // 获取单个配置
    getConfig: adminProcedure
      .input(z.object({ key: z.string() }))
      .query(async ({ input }) => {
        const value = await getConfig(input.key);
        return { key: input.key, value };
      }),

    // 更新系统配置
    setConfig: adminProcedure
      .input(
        z.object({
          key: z.string(),
          value: z.string(),
          description: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        await setConfig(input.key, input.value, (ctx as any).adminUser?.username || 'admin', input.description);
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'update_config',
          'config',
          input.key,
          { value: input.value }
        );
        return { success: true };
      }),

    // 删除系统配置
    deleteConfig: adminProcedure
      .input(z.object({ key: z.string() }))
      .mutation(async ({ input, ctx }) => {
        await deleteConfig(input.key);
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'delete_config',
          'config',
          input.key
        );
        return { success: true };
      }),

    // 批量设置默认配置
    initDefaultConfigs: adminProcedure.mutation(async ({ ctx }) => {
      const defaultConfigs = [
        { key: 'USDT_WALLET_TRC20', value: '', description: 'TRC20 USDT收款地址' },
        { key: 'USDT_WALLET_ERC20', value: '', description: 'ERC20 USDT收款地址' },
        { key: 'USDT_WALLET_BEP20', value: '', description: 'BEP20 USDT收款地址' },
        { key: 'MIN_RECHARGE_CREDITS', value: '100', description: '最低充值积分数' },
        { key: 'CREDITS_PER_USDT', value: '100', description: '1 USDT兑换积分数' },
        { key: 'ORDER_EXPIRE_MINUTES', value: '30', description: '订单过期时间(分钟)' },
        { key: 'CACHE_TTL_DAYS', value: '180', description: '缓存有效期(天)' },
        { key: 'SEARCH_CREDITS_PER_PERSON', value: '2', description: '每条搜索结果消耗积分' },
        { key: 'PREVIEW_CREDITS', value: '1', description: '预览搜索消耗积分' },
        { key: 'VERIFICATION_SCORE_THRESHOLD', value: '60', description: '电话验证通过分数阈值(0-100)' },
      ];

      for (const config of defaultConfigs) {
        const existing = await getConfig(config.key);
        if (!existing) {
          await setConfig(config.key, config.value, (ctx as any).adminUser?.username || 'admin', config.description);
        }
      }

      await logAdmin(
        (ctx as any).adminUser?.username || 'admin',
        'init_default_configs',
        'config',
        undefined,
        { count: defaultConfigs.length }
      );

      return { success: true, message: '默认配置已初始化' };
    }),

    // ============ 缓存管理 ============

    // 获取缓存统计
    cacheStats: adminProcedure.query(async () => {
      const stats = await getCacheStats();
      // 转换为前端期望的格式
      const hitRate = stats.totalEntries > 0 
        ? Math.round((stats.totalHits / (stats.totalEntries + stats.totalHits)) * 100) 
        : 0;
      return {
        entries: stats.totalEntries,
        hitRate: hitRate,
        memoryUsage: "N/A",  // 数据库缓存无法直接获取内存使用
        // 保留原始数据以便其他地方使用
        totalEntries: stats.totalEntries,
        searchCache: stats.searchCache,
        personCache: stats.personCache,
        verificationCache: stats.verificationCache,
        totalHits: stats.totalHits,
      };
    }),

    // ============ TRC20钱包监控 ============

    // 获取钱包余额
    getWalletBalance: adminProcedure
      .input(z.object({
        walletAddress: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        try {
          // 如果没有传入地址，从配置中获取
          let walletAddress: string | undefined = input?.walletAddress;
          if (!walletAddress) {
            const configAddr = await getConfig('USDT_WALLET_TRC20');
            walletAddress = configAddr || undefined;
          }
          
          if (!walletAddress) {
            return { usdtBalance: 0, trxBalance: 0, error: '未配置收款地址' };
          }
          
          // 获取TRX余额
          const accountUrl = `https://api.trongrid.io/v1/accounts/${walletAddress}`;
          const accountResponse = await fetch(accountUrl);
          const accountData = await accountResponse.json();
          
          let trxBalance = 0;
          let usdtBalance = 0;
          
          if (accountData.success && accountData.data && accountData.data.length > 0) {
            const account = accountData.data[0];
            // TRX余额 (1 TRX = 1,000,000 SUN)
            trxBalance = (account.balance || 0) / 1000000;
            
            // 查找USDT余额
            const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
            if (account.trc20) {
              const usdtToken = account.trc20.find((token: any) => 
                Object.keys(token)[0] === USDT_CONTRACT
              );
              if (usdtToken) {
                // USDT有6位小数
                usdtBalance = Number(usdtToken[USDT_CONTRACT]) / 1000000;
              }
            }
          }
          
          return { usdtBalance, trxBalance, walletAddress };
        } catch (error) {
          console.error('获取钱包余额失败:', error);
          return { usdtBalance: 0, trxBalance: 0, error: '获取余额失败' };
        }
      }),

    // 获取最近交易记录
    getRecentTransfers: adminProcedure
      .input(z.object({
        walletAddress: z.string().optional(),
        limit: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        try {
          let walletAddress: string | undefined = input?.walletAddress;
          if (!walletAddress) {
            const configAddr = await getConfig('USDT_WALLET_TRC20');
            walletAddress = configAddr || undefined;
          }
          
          if (!walletAddress) {
            return { transfers: [], error: '未配置收款地址' };
          }
          
          const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
          const limit = input?.limit || 20;
          const url = `https://api.trongrid.io/v1/accounts/${walletAddress}/transactions/trc20?limit=${limit}&contract_address=${USDT_CONTRACT}`;
          
          const response = await fetch(url);
          const data = await response.json();
          
          if (!data.success || !data.data) {
            return { transfers: [], error: 'API请求失败' };
          }
          
          const transfers = data.data.map((tx: any) => ({
            transactionId: tx.transaction_id,
            amount: Number(tx.value) / 1000000,
            from: tx.from,
            to: tx.to,
            timestamp: tx.block_timestamp,
            type: tx.to === walletAddress ? 'in' : 'out',
          }));
          
          return { transfers, walletAddress };
        } catch (error) {
          console.error('获取交易记录失败:', error);
          return { transfers: [], error: '获取交易记录失败' };
        }
      }),

    // 手动检查支付
    checkPaymentManually: adminProcedure
      .input(z.object({
        orderId: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        try {
          const order = await getRechargeOrder(input.orderId);
          if (!order) {
            return { found: false, error: '订单不存在' };
          }
          
          if (order.status !== 'pending') {
            return { found: false, error: '订单状态不是待支付' };
          }
          
          const walletAddress = order.walletAddress;
          const expectedAmount = parseFloat(order.amount);
          const createdAfter = new Date(order.createdAt).getTime() - 60000;
          
          const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
          const url = `https://api.trongrid.io/v1/accounts/${walletAddress}/transactions/trc20?limit=50&only_to=true&contract_address=${USDT_CONTRACT}&min_timestamp=${createdAfter}`;
          
          const response = await fetch(url);
          const data = await response.json();
          
          if (!data.success || !data.data) {
            return { found: false, error: 'API请求失败' };
          }
          
          // 查找匹配的转账
          const expectedValue = Math.round(expectedAmount * 1000000).toString();
          
          const matchingTransfer = data.data.find((tx: any) => {
            return tx.value === expectedValue && tx.to === walletAddress;
          });
          
          if (matchingTransfer) {
            // 找到匹配的转账，确认订单
            await confirmRechargeOrder(input.orderId, matchingTransfer.transaction_id, expectedAmount.toString());
            
            await logAdmin(
              (ctx as any).adminUser?.username || 'admin',
              'manual_check_payment',
              'order',
              input.orderId,
              { txId: matchingTransfer.transaction_id, amount: expectedAmount }
            );
            
            return {
              found: true,
              transactionId: matchingTransfer.transaction_id,
              amount: Number(matchingTransfer.value) / 1000000,
              from: matchingTransfer.from,
              timestamp: matchingTransfer.block_timestamp,
            };
          }
          
          return { found: false, message: '未找到匹配的转账记录' };
        } catch (error) {
          console.error('手动检查支付失败:', error);
          return { found: false, error: '检查支付失败' };
        }
      }),

    // ============ 用户管理增强 ============

    // 获取用户详情（包含统计信息）
    getUserDetail: adminProcedure
      .input(z.object({ userId: z.number() }))
      .query(async ({ input }) => {
        const detail = await getUserDetail(input.userId);
        if (!detail) {
          throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
        }
        return detail;
      }),

    // 重置用户密码
    resetUserPassword: adminProcedure
      .input(z.object({
        userId: z.number(),
        newPassword: z.string().min(6, "密码至少6位"),
      }))
      .mutation(async ({ input, ctx }) => {
        const passwordHash = await bcrypt.hash(input.newPassword, 10);
        const success = await adminResetPassword(input.userId, passwordHash);
        if (!success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "重置密码失败" });
        }
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'reset_user_password',
          'user',
          input.userId.toString()
        );
        return { success: true };
      }),

    // 获取用户搜索历史
    getUserSearchHistory: adminProcedure
      .input(z.object({
        userId: z.number(),
        page: z.number().optional(),
        limit: z.number().optional(),
      }))
      .query(async ({ input }) => {
        return getUserSearchHistory(input.userId, input.page || 1, input.limit || 20);
      }),

    // 获取用户积分变动记录
    getUserCreditHistory: adminProcedure
      .input(z.object({
        userId: z.number(),
        page: z.number().optional(),
        limit: z.number().optional(),
      }))
      .query(async ({ input }) => {
        return getUserCreditHistory(input.userId, input.page || 1, input.limit || 20);
      }),

    // 获取用户登录记录
    getUserLoginHistory: adminProcedure
      .input(z.object({
        userId: z.number(),
        page: z.number().optional(),
        limit: z.number().optional(),
      }))
      .query(async ({ input }) => {
        return getUserLoginHistory(input.userId, input.page || 1, input.limit || 20);
      }),

    // 获取用户活动日志
    getUserActivityLogs: adminProcedure
      .input(z.object({
        userId: z.number(),
        page: z.number().optional(),
        limit: z.number().optional(),
      }))
      .query(async ({ input }) => {
        return getUserActivityLogs(input.userId, input.page || 1, input.limit || 50);
      }),

    // ============ 订单管理增强 ============

    // 搜索订单
    searchOrders: adminProcedure
      .input(z.object({
        query: z.string(),
        page: z.number().optional(),
        limit: z.number().optional(),
      }))
      .query(async ({ input }) => {
        return searchOrders(input.query, input.page || 1, input.limit || 20);
      }),

    // 退款订单
    refundOrder: adminProcedure
      .input(z.object({
        orderId: z.string(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const success = await refundOrder(input.orderId, input.reason);
        if (!success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "退款失败，订单可能不存在或未支付" });
        }
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'refund_order',
          'order',
          input.orderId,
          { reason: input.reason }
        );
        return { success: true };
      }),

    // ============ 公告系统 ============

    // 获取公告列表
    getAnnouncements: adminProcedure
      .input(z.object({
        page: z.number().optional(),
        limit: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        return getAnnouncementsAdmin(input?.page || 1, input?.limit || 20);
      }),

    // 创建公告
    createAnnouncement: adminProcedure
      .input(z.object({
        title: z.string().min(1, "标题不能为空"),
        content: z.string().min(1, "内容不能为空"),
        type: z.enum(["info", "warning", "success", "error"]).optional(),
        isPinned: z.boolean().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const announcement = await createAnnouncement({
          title: input.title,
          content: input.content,
          type: input.type,
          isPinned: input.isPinned,
          startTime: input.startTime ? new Date(input.startTime) : undefined,
          endTime: input.endTime ? new Date(input.endTime) : undefined,
          createdBy: (ctx as any).adminUser?.username || 'admin',
        });
        if (!announcement) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "创建公告失败" });
        }
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'create_announcement',
          'announcement',
          announcement.id.toString(),
          { title: input.title }
        );
        return announcement;
      }),

    // 更新公告
    updateAnnouncement: adminProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().optional(),
        content: z.string().optional(),
        type: z.enum(["info", "warning", "success", "error"]).optional(),
        isPinned: z.boolean().optional(),
        isActive: z.boolean().optional(),
        startTime: z.string().nullable().optional(),
        endTime: z.string().nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { id, startTime, endTime, ...rest } = input;
        const success = await updateAnnouncement(id, {
          ...rest,
          startTime: startTime ? new Date(startTime) : null,
          endTime: endTime ? new Date(endTime) : null,
        });
        if (!success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "更新公告失败" });
        }
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'update_announcement',
          'announcement',
          id.toString()
        );
        return { success: true };
      }),

    // 删除公告
    deleteAnnouncement: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const success = await deleteAnnouncement(input.id);
        if (!success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "删除公告失败" });
        }
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'delete_announcement',
          'announcement',
          input.id.toString()
        );
        return { success: true };
      }),

    // ============ 用户消息系统 ============

    // 发送消息给单个用户
    sendMessage: adminProcedure
      .input(z.object({
        userId: z.number(),
        title: z.string().min(1, "标题不能为空"),
        content: z.string().min(1, "内容不能为空"),
        type: z.enum(["system", "support", "notification", "promotion"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const message = await sendMessageToUser({
          userId: input.userId,
          title: input.title,
          content: input.content,
          type: input.type,
          createdBy: (ctx as any).adminUser?.username || 'admin',
        });
        if (!message) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "发送消息失败" });
        }
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'send_message',
          'user',
          input.userId.toString(),
          { title: input.title }
        );
        return message;
      }),

    // 批量发送消息
    sendBulkMessage: adminProcedure
      .input(z.object({
        userIds: z.array(z.number()),
        title: z.string().min(1, "标题不能为空"),
        content: z.string().min(1, "内容不能为空"),
        type: z.enum(["system", "support", "notification", "promotion"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const count = await sendMessageToUsers(input.userIds, {
          title: input.title,
          content: input.content,
          type: input.type,
          createdBy: (ctx as any).adminUser?.username || 'admin',
        });
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'send_bulk_message',
          'users',
          undefined,
          { count, title: input.title }
        );
        return { success: true, count };
      }),

    // ============ 系统监控 ============

    // 获取API统计
    getApiStatistics: adminProcedure
      .input(z.object({ days: z.number().optional() }).optional())
      .query(async ({ input }) => {
        return getApiStatistics(input?.days || 30);
      }),

    // 获取错误日志
    getErrorLogs: adminProcedure
      .input(z.object({
        page: z.number().optional(),
        limit: z.number().optional(),
        level: z.string().optional(),
        resolved: z.boolean().optional(),
      }).optional())
      .query(async ({ input }) => {
        return getErrorLogs(input?.page || 1, input?.limit || 50, input?.level, input?.resolved);
      }),

    // 标记错误已解决
    resolveError: adminProcedure
      .input(z.object({ errorId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const success = await resolveError(input.errorId, (ctx as any).adminUser?.username || 'admin');
        if (!success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "标记失败" });
        }
        return { success: true };
      }),

    // ============ 积分报表系统（新增） ============

    /**
     * 高级积分查询 - 支持多条件筛选
     * 用于管理员查看用户详细积分记录
     */
    getAdvancedCreditLogs: adminProcedure
      .input(z.object({
        userId: z.number(),
        page: z.number().optional(),
        limit: z.number().optional(),
        startDate: z.string().optional(),  // ISO 日期字符串
        endDate: z.string().optional(),
        type: z.string().optional(),       // 积分类型筛选
        minAmount: z.number().optional(),  // 最小金额
        maxAmount: z.number().optional(),  // 最大金额
      }))
      .query(async ({ input }) => {
        return getAdvancedCreditLogs(input.userId, {
          page: input.page,
          limit: input.limit,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          endDate: input.endDate ? new Date(input.endDate) : undefined,
          type: input.type,
          minAmount: input.minAmount,
          maxAmount: input.maxAmount,
        });
      }),

    /**
     * 获取用户积分统计概览
     * 包含累计充值、消费、退款等汇总数据
     */
    getUserCreditStats: adminProcedure
      .input(z.object({ userId: z.number() }))
      .query(async ({ input }) => {
        return getUserCreditStats(input.userId);
      }),

    /**
     * 获取全局积分统计报表
     * 平台级别的积分流水统计
     */
    getGlobalCreditReport: adminProcedure
      .input(z.object({ days: z.number().optional() }).optional())
      .query(async ({ input }) => {
        return getGlobalCreditReport(input?.days || 30);
      }),

    /**
     * 导出用户积分记录为 CSV
     * 返回 CSV 格式字符串，前端可直接下载
     */
    exportUserCreditLogs: adminProcedure
      .input(z.object({
        userId: z.number(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        type: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const csv = await exportUserCreditLogs(input.userId, {
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          endDate: input.endDate ? new Date(input.endDate) : undefined,
          type: input.type,
        });
        return { csv };
      }),

    /**
     * 获取积分异常检测报告
     * 检测大额变动等异常情况
     */
    getCreditAnomalies: adminProcedure
      .input(z.object({ threshold: z.number().optional() }).optional())
      .query(async ({ input }) => {
        return getCreditAnomalies(input?.threshold || 1000);
      }),

    // ============ 代理管理 ============
    agent: adminAgentRouter,
  }),

  // ============ 用户端公告和消息 API ============
  
  notification: router({
    // 获取活跃公告
    getAnnouncements: publicProcedure.query(async () => {
      return getActiveAnnouncements();
    }),

    // 获取用户消息
    getMessages: protectedProcedure
      .input(z.object({
        page: z.number().optional(),
        limit: z.number().optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        if (!ctx.user) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        return getUserMessages(ctx.user.id, input?.page || 1, input?.limit || 20);
      }),

    // 标记消息已读
    markAsRead: protectedProcedure
      .input(z.object({ messageId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        await markMessageAsRead(input.messageId, ctx.user.id);
        return { success: true };
      }),

    // 标记所有消息已读
    markAllAsRead: protectedProcedure.mutation(async ({ ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      await markAllMessagesAsRead(ctx.user.id);
      return { success: true };
    }),

    // 获取未读消息数量
    getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      const result = await getUserMessages(ctx.user.id, 1, 1);
      return { count: result.unreadCount };
    }),
  }),

  // ============ 用户反馈系统 ============
  feedback: router({
    // 提交反馈（用户端）
    submit: protectedProcedure
      .input(z.object({
        type: z.enum(['question', 'suggestion', 'business', 'custom_dev', 'other']),
        title: z.string().min(1, "标题不能为空").max(200, "标题不能超过200字"),
        content: z.string().min(10, "内容至少10字").max(2000, "内容不能超过2000字"),
        contactInfo: z.string().max(200).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        const feedback = await createFeedback({
          userId: ctx.user.id,
          type: input.type,
          title: input.title,
          content: input.content,
          contactInfo: input.contactInfo || undefined,
        });
        if (!feedback) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "提交反馈失败" });
        }
        return { success: true, feedback };
      }),

    // 获取我的反馈列表（用户端）
    myFeedbacks: protectedProcedure
      .input(z.object({
        page: z.number().optional(),
        limit: z.number().optional(),
      }).optional())
      .query(async ({ ctx, input }) => {
        if (!ctx.user) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        return getUserFeedbacks(ctx.user.id, input?.page || 1, input?.limit || 20);
      }),

    // 获取所有反馈列表（管理员）
    list: adminProcedure
      .input(z.object({
        page: z.number().optional(),
        limit: z.number().optional(),
        status: z.enum(['pending', 'processing', 'resolved', 'closed']).optional(),
        type: z.enum(['question', 'suggestion', 'business', 'custom_dev', 'other']).optional(),
      }).optional())
      .query(async ({ input }) => {
        return getAllFeedbacks(
          input?.page || 1, 
          input?.limit || 20,
          input?.status,
          input?.type
        );
      }),

    // 获取反馈详情（管理员）
    detail: adminProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const feedback = await getFeedbackById(input.id);
        if (!feedback) {
          throw new TRPCError({ code: "NOT_FOUND", message: "反馈不存在" });
        }
        return feedback;
      }),

    // 回复反馈（管理员）
    reply: adminProcedure
      .input(z.object({
        feedbackId: z.number(),
        reply: z.string().min(1, "回复内容不能为空"),
        status: z.enum(['pending', 'processing', 'resolved', 'closed']).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const success = await replyFeedback(
          input.feedbackId,
          input.reply,
          (ctx as any).adminUser?.username || 'admin',
          input.status
        );
        if (!success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "回复失败" });
        }
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'reply_feedback',
          'feedback',
          input.feedbackId.toString()
        );
        return { success: true };
      }),

    // 更新反馈状态（管理员）
    updateStatus: adminProcedure
      .input(z.object({
        feedbackId: z.number(),
        status: z.enum(['pending', 'processing', 'resolved', 'closed']),
      }))
      .mutation(async ({ input, ctx }) => {
        const success = await updateFeedbackStatus(input.feedbackId, input.status);
        if (!success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "更新状态失败" });
        }
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'update_feedback_status',
          'feedback',
          input.feedbackId.toString(),
          { status: input.status }
        );
        return { success: true };
      }),
  }),

  // ============ 代理管理独立路由 ============
  adminAgent: adminAgentRouter,
});

export type AppRouter = typeof appRouter;
