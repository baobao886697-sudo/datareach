import { z } from "zod";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
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
  createRechargeOrder,
  getRechargeOrder,
  confirmRechargeOrder,
  getUserRechargeOrders,
  getApiLogs,
  getConfig,
  setConfig,
  getAllConfigs,
  getSearchStats,
} from "./db";
import { executeSearch } from "./services/searchProcessor";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// 管理员权限检查
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
  }
  return next({ ctx });
});

export const appRouter = router({
  system: systemRouter,

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
        })
      )
      .mutation(async ({ input }) => {
        const existing = await getUserByEmail(input.email);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "该邮箱已被注册" });
        }

        const passwordHash = await bcrypt.hash(input.password, 12);
        const user = await createUser(input.email, passwordHash);

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

    // 邮箱登录
    login: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          password: z.string(),
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

        // 创建会话
        const openId = user.openId || `email_${user.id}`;
        const sessionToken = await sdk.createSessionToken(openId, {
          name: user.name || user.email,
          expiresInMs: ONE_YEAR_MS,
        });

        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

        await updateUserLastSignIn(user.id);

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
          // TODO: 发送重置邮件
          // await sendPasswordResetEmail(input.email, token);
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
  search: router({
    // 开始搜索
    start: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1, "请输入姓名"),
          title: z.string().min(1, "请输入职位"),
          state: z.string().min(1, "请选择州"),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // 检查积分
        const credits = await getUserCredits(ctx.user.id);
        if (credits < 1) {
          throw new TRPCError({ code: "PAYMENT_REQUIRED", message: "积分不足，请先充值" });
        }

        try {
          const task = await executeSearch(
            ctx.user.id,
            input.name,
            input.title,
            input.state
          );

          return {
            success: true,
            taskId: task?.id,
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
        return getUserSearchTasks(ctx.user.id, input.limit);
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

    // 导出CSV
    exportCsv: protectedProcedure
      .input(z.object({ taskId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const task = await getSearchTask(input.taskId);
        if (!task || task.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
        }

        const results = await getSearchResults(task.id);
        
        // 生成CSV内容
        const headers = [
          "姓名",
          "名",
          "姓",
          "年龄",
          "职位",
          "公司",
          "城市",
          "州",
          "国家",
          "电话号码",
          "电话类型",
          "运营商",
          "邮箱",
          "LinkedIn",
          "验证状态",
          "匹配分数",
        ];

        const rows = results.map((r) => {
          const data = r.data as any || {};
          return [
            data.fullName || data.name || "",
            data.firstName || data.first_name || "",
            data.lastName || data.last_name || "",
            data.age?.toString() || "",
            data.title || "",
            data.company || data.organization_name || "",
            data.city || "",
            data.state || "",
            data.country || "",
            data.phoneNumber || data.phone || "",
            data.phoneType || "",
            data.carrier || "",
            data.email || "",
            data.linkedinUrl || data.linkedin_url || "",
            r.verified ? "已验证" : "未验证",
            r.verificationScore?.toString() || "",
          ];
        });

        const csvContent = [
          headers.join(","),
          ...rows.map((row) =>
            row.map((cell) => `"${(cell || "").replace(/"/g, '""')}"`).join(",")
          ),
        ].join("\n");

        return {
          filename: `search_results_${input.taskId}_${Date.now()}.csv`,
          content: csvContent,
          mimeType: "text/csv",
        };
      }),
  }),

  // ============ 充值路由 ============
  recharge: router({
    // 创建充值订单
    create: protectedProcedure
      .input(
        z.object({
          credits: z.number().min(100, "最少充值100积分"),
          network: z.enum(["TRC20", "ERC20", "BEP20"]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // 1 USDT = 100 积分
        const usdtAmount = (input.credits / 100).toFixed(2);

        // 获取收款地址
        const walletAddress = await getConfig(`USDT_WALLET_${input.network || "TRC20"}`);
        if (!walletAddress) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "收款地址未配置",
          });
        }

        const order = await createRechargeOrder(
          ctx.user.id,
          input.credits,
          usdtAmount,
          walletAddress,
          input.network || "TRC20"
        );

        if (!order) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "创建订单失败",
          });
        }

        return {
          orderId: order.orderId,
          credits: order.credits,
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

    // 获取充值记录
    history: protectedProcedure
      .input(z.object({ limit: z.number().optional() }))
      .query(async ({ ctx, input }) => {
        return getUserRechargeOrders(ctx.user.id, input.limit);
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
      .mutation(async ({ input }) => {
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
    // 获取所有用户
    users: adminProcedure.query(async () => {
      return getAllUsers();
    }),

    // 更新用户状态
    updateUserStatus: adminProcedure
      .input(
        z.object({
          userId: z.number(),
          status: z.enum(["active", "disabled"]),
        })
      )
      .mutation(async ({ input }) => {
        await updateUserStatus(input.userId, input.status);
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
      .mutation(async ({ input }) => {
        await updateUserRole(input.userId, input.role);
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
      .mutation(async ({ input }) => {
        const result = await addCredits(
          input.userId,
          input.amount,
          "admin_add",
          input.reason
        );

        if (!result.success) {
          throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
        }

        return { success: true, newBalance: result.newBalance };
      }),

    // 获取搜索统计
    stats: adminProcedure.query(async () => {
      return getSearchStats();
    }),

    // 获取API日志
    apiLogs: adminProcedure
      .input(
        z.object({
          userId: z.number().optional(),
          taskId: z.number().optional(),
          apiType: z.string().optional(),
          limit: z.number().optional(),
        })
      )
      .query(async ({ input }) => {
        return getApiLogs(input.limit || 50);
      }),

    // 获取系统配置
    configs: adminProcedure.query(async () => {
      return getAllConfigs();
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
        await setConfig(input.key, input.value, ctx.user.email || 'admin', input.description);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
