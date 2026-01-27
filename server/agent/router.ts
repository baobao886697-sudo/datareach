/**
 * 代理系统路由
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "../_core/trpc";
import {
  getAgentSetting,
  setAgentSetting,
  getAllAgentSettings,
  initAgentSettings,
  findUserByInviteCode,
  generateUserInviteCode,
  bindInviter,
  applyForAgent,
  getFounderSlotsRemaining,
  getCommissionRates,
  isActivityPeriod,
  getAgentStats,
  getAgentTeamUsers,
  getAgentCommissions,
  getAgentWithdrawals,
  createWithdrawal,
  processWithdrawal,
  getAllAgents,
  getAllWithdrawals,
  setAgentLevel,
  settlePendingCommissions,
} from "../agentDb";
import { logAdmin } from "../db";

export const agentRouter = router({
  // ============ 公开接口 ============

  // 获取代理规则说明
  rules: publicProcedure.query(async () => {
    const settings = await getAllAgentSettings();
    const founderRemaining = await getFounderSlotsRemaining();
    const isActivity = await isActivityPeriod();

    return {
      // 佣金比例
      commissionRates: {
        founder: {
          level1: parseFloat(settings.founder_level1_rate || '15'),
          level2: parseFloat(settings.founder_level2_rate || '5'),
          label: '创始代理',
          badge: '👑',
        },
        gold: {
          level1: parseFloat(settings.gold_level1_rate || '12'),
          level2: parseFloat(settings.gold_level2_rate || '4'),
          label: '金牌代理',
          badge: '🥇',
        },
        silver: {
          level1: parseFloat(settings.silver_level1_rate || '10'),
          level2: parseFloat(settings.silver_level2_rate || '3'),
          label: '银牌代理',
          badge: '🥈',
        },
        normal: {
          level1: parseFloat(settings.normal_level1_rate || '8'),
          level2: parseFloat(settings.normal_level2_rate || '2'),
          label: '普通代理',
          badge: '⭐',
        },
      },
      // 额外奖励
      bonuses: {
        firstCharge: parseFloat(settings.first_charge_bonus || '3'),
        activity: isActivity ? parseFloat(settings.activity_bonus || '3') : 0,
        activityEndDate: settings.activity_end_date,
      },
      // 结算规则
      settlement: {
        days: parseInt(settings.settlement_days || '7'),
        minWithdrawal: parseFloat(settings.min_withdrawal || '50'),
      },
      // 创始代理名额
      founderSlots: {
        total: parseInt(settings.founder_limit || '100'),
        remaining: founderRemaining,
      },
      // 是否在活动期间
      isActivityPeriod: isActivity,
    };
  }),

  // 验证邀请码
  validateInviteCode: publicProcedure
    .input(z.object({ inviteCode: z.string() }))
    .query(async ({ input }) => {
      const inviter = await findUserByInviteCode(input.inviteCode);
      if (!inviter || !inviter.isAgent) {
        return { valid: false };
      }
      return {
        valid: true,
        inviterName: inviter.name || inviter.email?.split('@')[0] || '代理',
      };
    }),

  // ============ 用户接口 ============

  // 获取我的代理信息
  info: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    if (!ctx.user.isAgent) {
      return { isAgent: false };
    }

    const stats = await getAgentStats(ctx.user.id);
    const rates = await getCommissionRates(ctx.user.agentLevel || 'normal');

    return {
      isAgent: true,
      agentLevel: ctx.user.agentLevel,
      inviteCode: ctx.user.inviteCode,
      walletAddress: ctx.user.agentWalletAddress,
      balance: stats?.balance || 0,
      frozenBalance: stats?.frozenBalance || 0,
      totalEarned: stats?.totalEarned || 0,
      teamUsers: stats?.teamUsers || 0,
      teamAgents: stats?.teamAgents || 0,
      todayCommission: stats?.todayCommission || 0,
      monthCommission: stats?.monthCommission || 0,
      commissionRates: rates,
    };
  }),

  // 申请成为代理
  applyAgent: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    if (ctx.user.isAgent) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "您已经是代理了" });
    }

    const success = await applyForAgent(ctx.user.id);
    if (!success) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "申请失败" });
    }

    return { success: true, message: "申请成功，您已成为代理！" };
  }),

  // 获取邀请链接
  inviteLink: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    if (!ctx.user.isAgent) {
      throw new TRPCError({ code: "FORBIDDEN", message: "您还不是代理" });
    }

    let inviteCode = ctx.user.inviteCode;
    if (!inviteCode) {
      inviteCode = await generateUserInviteCode(ctx.user.id);
    }

    const baseUrl = process.env.APP_URL || 'https://datareach.co';
    const inviteLink = `${baseUrl}/register?ref=${inviteCode}`;

    return {
      inviteCode,
      inviteLink,
    };
  }),

  // 获取下级用户列表
  teamUsers: protectedProcedure
    .input(z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      if (!ctx.user.isAgent) {
        throw new TRPCError({ code: "FORBIDDEN", message: "您还不是代理" });
      }

      return getAgentTeamUsers(ctx.user.id, input?.page || 1, input?.limit || 20);
    }),

  // 获取佣金明细
  commissions: protectedProcedure
    .input(z.object({
      status: z.string().optional(),
      page: z.number().optional(),
      limit: z.number().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      if (!ctx.user.isAgent) {
        throw new TRPCError({ code: "FORBIDDEN", message: "您还不是代理" });
      }

      return getAgentCommissions(
        ctx.user.id,
        input?.status,
        input?.page || 1,
        input?.limit || 20
      );
    }),

  // 获取提现记录
  withdrawals: protectedProcedure
    .input(z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      if (!ctx.user.isAgent) {
        throw new TRPCError({ code: "FORBIDDEN", message: "您还不是代理" });
      }

      return getAgentWithdrawals(ctx.user.id, input?.page || 1, input?.limit || 20);
    }),

  // 申请提现
  withdraw: protectedProcedure
    .input(z.object({
      amount: z.number().min(1, "提现金额必须大于0"),
      walletAddress: z.string().min(1, "请输入钱包地址"),
      network: z.enum(["TRC20", "ERC20", "BEP20"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      if (!ctx.user.isAgent) {
        throw new TRPCError({ code: "FORBIDDEN", message: "您还不是代理" });
      }

      const result = await createWithdrawal(
        ctx.user.id,
        input.amount,
        input.walletAddress,
        input.network || 'TRC20'
      );

      if (!result.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      }

      return result;
    }),

  // 更新收款地址
  updateWalletAddress: protectedProcedure
    .input(z.object({
      walletAddress: z.string().min(1, "请输入钱包地址"),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      if (!ctx.user.isAgent) {
        throw new TRPCError({ code: "FORBIDDEN", message: "您还不是代理" });
      }

      // 这里需要添加更新钱包地址的数据库函数
      // await updateAgentWalletAddress(ctx.user.id, input.walletAddress);

      return { success: true };
    }),
});

// ============ 管理员代理路由 ============

export const adminAgentRouter = router({
  // 获取所有代理列表
  list: adminProcedure
    .input(z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return getAllAgents(input?.page || 1, input?.limit || 20);
    }),

  // 获取代理详情
  detail: adminProcedure
    .input(z.object({ agentId: z.number() }))
    .query(async ({ input }) => {
      const stats = await getAgentStats(input.agentId);
      if (!stats) {
        throw new TRPCError({ code: "NOT_FOUND", message: "代理不存在" });
      }
      return stats;
    }),

  // 设置代理等级
  setLevel: adminProcedure
    .input(z.object({
      agentId: z.number(),
      level: z.enum(["normal", "silver", "gold", "founder"]),
    }))
    .mutation(async ({ input, ctx }) => {
      await setAgentLevel(input.agentId, input.level);
      await logAdmin(
        (ctx as any).adminUser?.username || 'admin',
        'set_agent_level',
        'agent',
        input.agentId.toString(),
        { level: input.level }
      );
      return { success: true };
    }),

  // 获取所有提现申请
  withdrawals: adminProcedure
    .input(z.object({
      status: z.string().optional(),
      page: z.number().optional(),
      limit: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return getAllWithdrawals(input?.status, input?.page || 1, input?.limit || 20);
    }),

  // 处理提现申请
  processWithdrawal: adminProcedure
    .input(z.object({
      withdrawalId: z.string(),
      action: z.enum(["approve", "reject", "paid"]),
      txId: z.string().optional(),
      adminNote: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const success = await processWithdrawal(
        input.withdrawalId,
        input.action,
        (ctx as any).adminUser?.username || 'admin',
        input.txId,
        input.adminNote
      );

      if (!success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "处理失败" });
      }

      await logAdmin(
        (ctx as any).adminUser?.username || 'admin',
        `withdrawal_${input.action}`,
        'withdrawal',
        input.withdrawalId,
        { txId: input.txId, note: input.adminNote }
      );

      return { success: true };
    }),

  // 获取代理配置
  settings: adminProcedure.query(async () => {
    return getAllAgentSettings();
  }),

  // 更新代理配置
  updateSetting: adminProcedure
    .input(z.object({
      key: z.string(),
      value: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      await setAgentSetting(input.key, input.value);
      await logAdmin(
        (ctx as any).adminUser?.username || 'admin',
        'update_agent_setting',
        'agent_setting',
        input.key,
        { value: input.value }
      );
      return { success: true };
    }),

  // 初始化代理配置
  initSettings: adminProcedure.mutation(async ({ ctx }) => {
    await initAgentSettings();
    await logAdmin(
      (ctx as any).adminUser?.username || 'admin',
      'init_agent_settings',
      'agent_setting'
    );
    return { success: true };
  }),

  // 手动结算佣金
  settleCommissions: adminProcedure.mutation(async ({ ctx }) => {
    const count = await settlePendingCommissions();
    await logAdmin(
      (ctx as any).adminUser?.username || 'admin',
      'settle_commissions',
      'commission',
      undefined,
      { settledCount: count }
    );
    return { success: true, settledCount: count };
  }),

  // 获取代理统计报表
  report: adminProcedure.query(async () => {
    // 这里可以添加更详细的统计逻辑
    const agents = await getAllAgents(1, 1000);
    
    let totalCommission = 0;
    let totalWithdrawn = 0;
    
    // 简单统计
    return {
      totalAgents: agents.total,
      founderCount: agents.agents.filter((a: any) => a.agentLevel === 'founder').length,
      goldCount: agents.agents.filter((a: any) => a.agentLevel === 'gold').length,
      silverCount: agents.agents.filter((a: any) => a.agentLevel === 'silver').length,
      normalCount: agents.agents.filter((a: any) => a.agentLevel === 'normal').length,
    };
  }),
});
