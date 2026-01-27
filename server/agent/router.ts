/**
 * 代理系统路由 - 独立代理后台版本
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "../_core/trpc";
import { getDbSync, getUserByEmail, getUserById } from "../db";
import { users, agentCommissions, agentWithdrawals } from "../../drizzle/schema";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
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
  generateInviteCode,
} from "../agentDb";
import { logAdmin } from "../db";

// JWT密钥
const AGENT_JWT_SECRET = process.env.AGENT_JWT_SECRET || process.env.JWT_SECRET || 'agent-secret-key-change-in-production';

// 获取数据库实例
function getDb() {
  const db = getDbSync();
  if (!db) throw new Error("Database not available");
  return db;
}

// ============ 代理申请表操作 ============

// 创建代理申请
async function createAgentApplication(data: {
  name: string;
  email: string;
  phone: string;
  wechat?: string;
  company?: string;
  experience?: string;
  channels?: string;
  expectedUsers?: string;
  walletAddress?: string;
}) {
  const db = getDb();
  
  // 检查是否已有申请
  const existing = await db.execute(sql`
    SELECT id FROM agent_applications WHERE email = ${data.email} AND status = 'pending'
  `);
  if ((existing[0] as any[]).length > 0) {
    throw new Error("您已有待审核的申请，请耐心等待");
  }
  
  await db.execute(sql`
    INSERT INTO agent_applications (name, email, phone, wechat, company, experience, channels, expectedUsers, walletAddress, status)
    VALUES (${data.name}, ${data.email}, ${data.phone}, ${data.wechat || null}, ${data.company || null}, 
            ${data.experience || null}, ${data.channels || null}, ${data.expectedUsers || null}, ${data.walletAddress || null}, 'pending')
  `);
  
  return { success: true };
}

// 获取所有代理申请
async function getAgentApplications(status?: string, page: number = 1, limit: number = 20) {
  const db = getDb();
  const offset = (page - 1) * limit;
  
  let query = `SELECT * FROM agent_applications`;
  if (status) {
    query += ` WHERE status = '${status}'`;
  }
  query += ` ORDER BY createdAt DESC LIMIT ${limit} OFFSET ${offset}`;
  
  const applications = await db.execute(sql.raw(query));
  
  let countQuery = `SELECT COUNT(*) as count FROM agent_applications`;
  if (status) {
    countQuery += ` WHERE status = '${status}'`;
  }
  const countResult = await db.execute(sql.raw(countQuery));
  
  return {
    applications: (applications[0] as any[]),
    total: (countResult[0] as any[])[0]?.count || 0,
    page,
    limit,
  };
}

// 处理代理申请
async function processAgentApplication(
  applicationId: number,
  action: 'approve' | 'reject',
  adminUsername: string,
  agentLevel: 'normal' | 'silver' | 'gold' | 'founder' = 'normal',
  adminNote?: string
) {
  const db = getDb();
  
  // 获取申请信息
  const appResult = await db.execute(sql`
    SELECT * FROM agent_applications WHERE id = ${applicationId}
  `);
  const application = (appResult[0] as any[])[0];
  
  if (!application) {
    throw new Error("申请不存在");
  }
  
  if (application.status !== 'pending') {
    throw new Error("该申请已处理");
  }
  
  if (action === 'approve') {
    // 检查用户是否已存在
    let user = await getUserByEmail(application.email);
    
    if (!user) {
      // 创建新用户账号，生成随机密码
      const tempPassword = Math.random().toString(36).slice(-8);
      const passwordHash = await bcrypt.hash(tempPassword, 12);
      const openId = require('crypto').randomBytes(16).toString('hex');
      
      await db.insert(users).values({
        openId,
        email: application.email,
        passwordHash,
        name: application.name,
        credits: 100, // 注册赠送积分
      });
      
      user = await getUserByEmail(application.email);
      
      // TODO: 发送邮件通知用户临时密码
      console.log(`[Agent] Created new user for agent: ${application.email}, temp password: ${tempPassword}`);
    }
    
    if (user) {
      // 生成邀请码
      const inviteCode = generateInviteCode();
      
      // 设置为代理
      await db.update(users).set({
        isAgent: true,
        agentLevel,
        inviteCode,
        agentWalletAddress: application.walletAddress,
        agentAppliedAt: new Date(application.createdAt),
        agentApprovedAt: new Date(),
      }).where(eq(users.id, user.id));
    }
  }
  
  // 更新申请状态
  await db.execute(sql`
    UPDATE agent_applications 
    SET status = ${action === 'approve' ? 'approved' : 'rejected'},
        adminNote = ${adminNote || null},
        processedBy = ${adminUsername},
        processedAt = NOW()
    WHERE id = ${applicationId}
  `);
  
  return { success: true };
}

// 管理员直接设置用户为代理
async function setUserAsAgent(
  userId: number,
  agentLevel: 'normal' | 'silver' | 'gold' | 'founder' = 'normal'
) {
  const db = getDb();
  
  const user = await getUserById(userId);
  if (!user) {
    throw new Error("用户不存在");
  }
  
  if (user.isAgent) {
    throw new Error("该用户已经是代理");
  }
  
  // 生成邀请码
  const inviteCode = generateInviteCode();
  
  await db.update(users).set({
    isAgent: true,
    agentLevel,
    inviteCode,
    agentAppliedAt: new Date(),
    agentApprovedAt: new Date(),
  }).where(eq(users.id, userId));
  
  return { success: true, inviteCode };
}

// ============ 代理登录验证 ============

// 验证代理登录
async function verifyAgentLogin(email: string, password: string) {
  const user = await getUserByEmail(email);
  
  if (!user) {
    throw new Error("邮箱或密码错误");
  }
  
  if (!user.isAgent) {
    throw new Error("您还不是代理，请先申请成为代理");
  }
  
  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    throw new Error("邮箱或密码错误");
  }
  
  // 生成JWT token
  const token = jwt.sign(
    { 
      userId: user.id, 
      email: user.email,
      isAgent: true,
      agentLevel: user.agentLevel,
    },
    AGENT_JWT_SECRET,
    { expiresIn: '7d' }
  );
  
  return {
    token,
    agent: {
      id: user.id,
      name: user.name || user.email.split('@')[0],
      email: user.email,
      level: user.agentLevel,
      inviteCode: user.inviteCode,
      balance: user.agentBalance || '0',
      frozenBalance: user.agentFrozenBalance || '0',
      totalEarned: user.agentTotalEarned || '0',
    },
  };
}

// 验证代理token
function verifyAgentToken(token: string) {
  try {
    const decoded = jwt.verify(token, AGENT_JWT_SECRET) as any;
    if (!decoded.isAgent) {
      throw new Error("Invalid agent token");
    }
    return decoded;
  } catch (error) {
    throw new Error("Token验证失败，请重新登录");
  }
}

// 代理认证中间件
async function getAgentFromToken(token?: string) {
  if (!token) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
  }
  
  const decoded = verifyAgentToken(token);
  const user = await getUserById(decoded.userId);
  
  if (!user || !user.isAgent) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "代理身份验证失败" });
  }
  
  return user;
}

// ============ 代理后台路由 ============

export const agentRouter = router({
  // ============ 公开接口 ============

  // 获取代理规则说明
  rules: publicProcedure.query(async () => {
    const settings = await getAllAgentSettings();
    const founderRemaining = await getFounderSlotsRemaining();
    const isActivity = await isActivityPeriod();

    return {
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
      bonuses: {
        firstCharge: parseFloat(settings.first_charge_bonus || '3'),
        activity: isActivity ? parseFloat(settings.activity_bonus || '3') : 0,
        activityEndDate: settings.activity_end_date,
      },
      settlement: {
        days: parseInt(settings.settlement_days || '7'),
        minWithdrawal: parseFloat(settings.min_withdrawal || '50'),
      },
      founderSlots: {
        total: parseInt(settings.founder_limit || '100'),
        remaining: founderRemaining,
      },
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

  // 提交代理申请（简化版：只需邮箱和钱包地址）
  submitApplication: publicProcedure
    .input(z.object({
      name: z.string().optional(),
      email: z.string().email("请输入有效邮箱"),
      phone: z.string().optional(),
      wechat: z.string().optional(),
      company: z.string().optional(),
      experience: z.string().optional(),
      channels: z.string().optional(),
      expectedUsers: z.string().optional(),
      walletAddress: z.string().min(1, "请输入USDT收款地址"),
    }))
    .mutation(async ({ input }) => {
      try {
        // 检查邮箱是否已注册用户端账号
        const existingUser = await getUserByEmail(input.email);
        if (!existingUser) {
          throw new Error("该邮箱未注册用户端账号，请先注册后再申请代理");
        }
        if (existingUser.isAgent) {
          throw new Error("您已经是代理了，无需重复申请");
        }
        await createAgentApplication({
          ...input,
          name: existingUser.name || input.email.split('@')[0],
          phone: input.phone || '',
        });
        return { success: true, message: "申请已提交，请等待审核" };
      } catch (error: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
      }
    }),

  // 代理登录
  login: publicProcedure
    .input(z.object({
      email: z.string().email("请输入有效邮箱"),
      password: z.string().min(1, "请输入密码"),
    }))
    .mutation(async ({ input }) => {
      try {
        return await verifyAgentLogin(input.email, input.password);
      } catch (error: any) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: error.message });
      }
    }),

  // ============ 代理后台接口（需要代理token） ============

  // 获取仪表盘数据
  getDashboard: publicProcedure
    .input(z.object({ token: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      // 从header或input获取token
      const token = (ctx as any).req?.headers?.['x-agent-token'] || input?.token || 
                    (typeof localStorage !== 'undefined' ? localStorage.getItem('agent_token') : null);
      
      // 简化处理：从ctx获取用户信息（如果已登录）
      const user = (ctx as any).user;
      if (!user?.isAgent) {
        // 尝试从token验证
        if (!token) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
        }
        try {
          const decoded = verifyAgentToken(token);
          const agentUser = await getUserById(decoded.userId);
          if (!agentUser?.isAgent) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: "代理身份验证失败" });
          }
          return await getAgentDashboardData(agentUser.id);
        } catch (e) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
        }
      }
      
      return await getAgentDashboardData(user.id);
    }),

  // 获取团队数据
  getTeam: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user?.isAgent) {
      throw new TRPCError({ code: "FORBIDDEN", message: "您还不是代理" });
    }
    
    const db = getDb();
    
    // 获取一级用户
    const level1Users = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
    })
      .from(users)
      .where(eq(users.inviterId, ctx.user.id))
      .orderBy(desc(users.createdAt))
      .limit(50);
    
    // 获取二级用户
    const level1Ids = level1Users.map(u => u.id);
    let level2Users: any[] = [];
    
    if (level1Ids.length > 0) {
      const level2Result = await db.execute(sql`
        SELECT u.id, u.email, u.name, u.createdAt, u.inviterId,
               (SELECT email FROM users WHERE id = u.inviterId) as inviterEmail
        FROM users u
        WHERE u.inviterId IN (${sql.raw(level1Ids.join(','))})
        ORDER BY u.createdAt DESC
        LIMIT 50
      `);
      level2Users = (level2Result[0] as any[]);
    }
    
    // 计算每个用户的充值和佣金
    const enrichedLevel1 = await Promise.all(level1Users.map(async (user) => {
      const rechargeResult = await db.execute(sql`
        SELECT COALESCE(SUM(orderAmount), 0) as total FROM agent_commissions 
        WHERE fromUserId = ${user.id} AND agentId = ${ctx.user!.id}
      `);
      const commissionResult = await db.execute(sql`
        SELECT COALESCE(SUM(commissionAmount + COALESCE(bonusAmount, 0)), 0) as total 
        FROM agent_commissions 
        WHERE fromUserId = ${user.id} AND agentId = ${ctx.user!.id}
      `);
      
      return {
        ...user,
        createdAt: new Date(user.createdAt).toLocaleDateString('zh-CN'),
        totalRecharge: parseFloat((rechargeResult[0] as any[])[0]?.total || '0').toFixed(2),
        commission: parseFloat((commissionResult[0] as any[])[0]?.total || '0').toFixed(2),
      };
    }));
    
    const enrichedLevel2 = level2Users.map(user => ({
      ...user,
      createdAt: new Date(user.createdAt).toLocaleDateString('zh-CN'),
      totalRecharge: '0.00',
      commission: '0.00',
    }));
    
    return {
      level1Users: enrichedLevel1,
      level2Users: enrichedLevel2,
    };
  }),

  // 获取佣金明细
  getCommissions: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user?.isAgent) {
      throw new TRPCError({ code: "FORBIDDEN", message: "您还不是代理" });
    }
    
    const db = getDb();
    const result = await db.execute(sql`
      SELECT ac.*, u.email as fromUserEmail
      FROM agent_commissions ac
      LEFT JOIN users u ON ac.fromUserId = u.id
      WHERE ac.agentId = ${ctx.user.id}
      ORDER BY ac.createdAt DESC
      LIMIT 100
    `);
    
    const commissions = (result[0] as any[]).map(c => ({
      level: c.commissionLevel === 'level1' ? 1 : 2,
      fromUser: c.fromUserEmail?.split('@')[0] || '用户',
      orderAmount: parseFloat(c.orderAmount).toFixed(2),
      rate: parseFloat(c.commissionRate).toFixed(0),
      amount: (parseFloat(c.commissionAmount) + parseFloat(c.bonusAmount || '0')).toFixed(2),
      status: c.status,
      time: new Date(c.createdAt).toLocaleDateString('zh-CN'),
    }));
    
    return { commissions };
  }),

  // 获取提现记录
  getWithdrawals: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user?.isAgent) {
      throw new TRPCError({ code: "FORBIDDEN", message: "您还不是代理" });
    }
    
    const result = await getAgentWithdrawals(ctx.user.id, 1, 50);
    
    const withdrawals = result.withdrawals.map((w: any) => ({
      id: w.withdrawalId,
      amount: parseFloat(w.amount).toFixed(2),
      status: w.status,
      createdAt: new Date(w.createdAt).toLocaleDateString('zh-CN'),
      txId: w.txId,
    }));
    
    return { withdrawals };
  }),

  // 申请提现
  submitWithdrawal: protectedProcedure
    .input(z.object({
      amount: z.number().min(50, "最低提现金额为50 USDT"),
      walletAddress: z.string().min(1, "请输入钱包地址"),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user?.isAgent) {
        throw new TRPCError({ code: "FORBIDDEN", message: "您还不是代理" });
      }
      
      const result = await createWithdrawal(
        ctx.user.id,
        input.amount,
        input.walletAddress,
        'TRC20'
      );
      
      if (!result.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      }
      
      return result;
    }),

  // ============ 旧接口保持兼容 ============
  
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
    const inviteLink = `${baseUrl}/?ref=${inviteCode}`;

    return {
      inviteCode,
      inviteLink,
    };
  }),
});

// 获取代理仪表盘数据
async function getAgentDashboardData(agentId: number) {
  const db = getDb();
  const user = await getUserById(agentId);
  
  if (!user) {
    throw new Error("用户不存在");
  }
  
  // 今日开始时间
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // 本月开始时间
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  
  // 团队人数
  const teamCountResult = await db.execute(sql`
    SELECT COUNT(*) as count FROM users WHERE inviterId = ${agentId}
  `);
  const teamCount = (teamCountResult[0] as any[])[0]?.count || 0;
  
  // 今日新增用户
  const todayUsersResult = await db.execute(sql`
    SELECT COUNT(*) as count FROM users 
    WHERE inviterId = ${agentId} AND createdAt >= ${today}
  `);
  const todayNewUsers = (todayUsersResult[0] as any[])[0]?.count || 0;
  
  // 本月新增用户
  const monthUsersResult = await db.execute(sql`
    SELECT COUNT(*) as count FROM users 
    WHERE inviterId = ${agentId} AND createdAt >= ${monthStart}
  `);
  const monthNewUsers = (monthUsersResult[0] as any[])[0]?.count || 0;
  
  // 今日佣金
  const todayCommissionResult = await db.execute(sql`
    SELECT COALESCE(SUM(commissionAmount + COALESCE(bonusAmount, 0)), 0) as total
    FROM agent_commissions 
    WHERE agentId = ${agentId} AND createdAt >= ${today}
  `);
  const todayCommission = parseFloat((todayCommissionResult[0] as any[])[0]?.total || '0').toFixed(2);
  
  // 本月佣金
  const monthCommissionResult = await db.execute(sql`
    SELECT COALESCE(SUM(commissionAmount + COALESCE(bonusAmount, 0)), 0) as total
    FROM agent_commissions 
    WHERE agentId = ${agentId} AND createdAt >= ${monthStart}
  `);
  const monthCommission = parseFloat((monthCommissionResult[0] as any[])[0]?.total || '0').toFixed(2);
  
  // 今日团队充值
  const todayRechargeResult = await db.execute(sql`
    SELECT COALESCE(SUM(orderAmount), 0) as total
    FROM agent_commissions 
    WHERE agentId = ${agentId} AND createdAt >= ${today}
  `);
  const todayRecharge = parseFloat((todayRechargeResult[0] as any[])[0]?.total || '0').toFixed(2);
  
  // 本月团队充值
  const monthRechargeResult = await db.execute(sql`
    SELECT COALESCE(SUM(orderAmount), 0) as total
    FROM agent_commissions 
    WHERE agentId = ${agentId} AND createdAt >= ${monthStart}
  `);
  const monthRecharge = parseFloat((monthRechargeResult[0] as any[])[0]?.total || '0').toFixed(2);
  
  // 最近佣金记录
  const recentCommissionsResult = await db.execute(sql`
    SELECT ac.*, u.email as fromUserEmail
    FROM agent_commissions ac
    LEFT JOIN users u ON ac.fromUserId = u.id
    WHERE ac.agentId = ${agentId}
    ORDER BY ac.createdAt DESC
    LIMIT 5
  `);
  
  const recentCommissions = (recentCommissionsResult[0] as any[]).map(c => ({
    level: c.commissionLevel === 'level1' ? 1 : 2,
    fromUser: c.fromUserEmail?.split('@')[0] || '用户',
    amount: (parseFloat(c.commissionAmount) + parseFloat(c.bonusAmount || '0')).toFixed(2),
    time: new Date(c.createdAt).toLocaleDateString('zh-CN'),
  }));
  
  return {
    balance: parseFloat(user.agentBalance || '0').toFixed(2),
    frozenBalance: parseFloat(user.agentFrozenBalance || '0').toFixed(2),
    totalEarned: parseFloat(user.agentTotalEarned || '0').toFixed(2),
    teamCount,
    todayNewUsers,
    monthNewUsers,
    todayCommission,
    monthCommission,
    todayRecharge,
    monthRecharge,
    recentCommissions,
  };
}

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

  // 直接设置用户为代理
  setUserAsAgent: adminProcedure
    .input(z.object({
      userId: z.number(),
      level: z.enum(["normal", "silver", "gold", "founder"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await setUserAsAgent(input.userId, input.level || 'normal');
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          'set_user_as_agent',
          'user',
          input.userId.toString(),
          { level: input.level || 'normal' }
        );
        return result;
      } catch (error: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
      }
    }),

  // 获取代理申请列表
  applications: adminProcedure
    .input(z.object({
      status: z.string().optional(),
      page: z.number().optional(),
      limit: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return getAgentApplications(input?.status, input?.page || 1, input?.limit || 20);
    }),

  // 处理代理申请
  processApplication: adminProcedure
    .input(z.object({
      applicationId: z.number(),
      action: z.enum(["approve", "reject"]),
      level: z.enum(["normal", "silver", "gold", "founder"]).optional(),
      adminNote: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        await processAgentApplication(
          input.applicationId,
          input.action,
          (ctx as any).adminUser?.username || 'admin',
          input.level || 'normal',
          input.adminNote
        );
        await logAdmin(
          (ctx as any).adminUser?.username || 'admin',
          `agent_application_${input.action}`,
          'agent_application',
          input.applicationId.toString(),
          { level: input.level, note: input.adminNote }
        );
        return { success: true };
      } catch (error: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
      }
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
    const agents = await getAllAgents(1, 1000);
    
    return {
      totalAgents: agents.total,
      founderCount: agents.agents.filter((a: any) => a.agentLevel === 'founder').length,
      goldCount: agents.agents.filter((a: any) => a.agentLevel === 'gold').length,
      silverCount: agents.agents.filter((a: any) => a.agentLevel === 'silver').length,
      normalCount: agents.agents.filter((a: any) => a.agentLevel === 'normal').length,
    };
  }),
});
