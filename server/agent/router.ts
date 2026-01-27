/**
 * 代理系统路由 - 独立代理后台版本
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { verifyAdminToken, getAdminTokenFromHeader } from "../_core/adminAuth";
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
import { verifyAgentToken as verifyAgentTokenAuth, getAgentTokenFromContext, getAuthenticatedAgentId } from "./agentAuth";

// JWT密钥
const AGENT_JWT_SECRET = process.env.AGENT_JWT_SECRET || process.env.JWT_SECRET || 'agent-secret-key-change-in-production';

// 代理认证中间件 - 验证代理JWT token
interface AgentContext {
  agentUser: {
    userId: number;
    email: string;
    isAgent: boolean;
    agentLevel: string;
  } | null;
}

async function verifyAgentToken(token: string): Promise<AgentContext['agentUser']> {
  try {
    const decoded = jwt.verify(token, AGENT_JWT_SECRET) as any;
    if (!decoded.userId || !decoded.isAgent) {
      return null;
    }
    // 验证用户是否仍然是代理
    const user = await getUserById(decoded.userId);
    if (!user || !user.isAgent) {
      return null;
    }
    return {
      userId: decoded.userId,
      email: decoded.email,
      isAgent: true,
      agentLevel: user.agentLevel || 'normal',
    };
  } catch (error) {
    return null;
  }
}

// 从请求头获取代理token
function getAgentTokenFromHeader(ctx: any): string | null {
  const authHeader = ctx.req?.headers?.authorization || ctx.req?.headers?.['x-agent-token'];
  if (!authHeader) return null;
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return authHeader;
}

// 获取数据库实例
function getDb() {
  const db = getDbSync();
  if (!db) throw new Error("Database not available");
  return db;
}

// 邮箱脱敏函数：保护用户隐私
function maskEmail(email: string | null | undefined): string {
  if (!email) return '用户';
  const [localPart, domain] = email.split('@');
  if (!domain) return '用户';
  
  // 显示前2个字符 + *** + @域名
  const visibleChars = Math.min(2, localPart.length);
  const masked = localPart.substring(0, visibleChars) + '***';
  return `${masked}@${domain}`;
}

// 获取用户显示名称（优先用户名，否则脱敏邮箱）
function getUserDisplayName(name: string | null | undefined, email: string | null | undefined): string {
  if (name && name.trim()) return name;
  return maskEmail(email);
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
      walletAddress: user.agentWalletAddress || '',
    },
  };
}

// 代理认证中间件 - 使用上面定义的verifyAgentToken
async function getAgentFromToken(token?: string) {
  if (!token) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
  }
  
  const agentUser = await verifyAgentToken(token);
  if (!agentUser) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Token验证失败，请重新登录" });
  }
  
  const user = await getUserById(agentUser.userId);
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
  getDashboard: publicProcedure.query(async ({ ctx }) => {
    try {
      const agentId = await getAuthenticatedAgentId(ctx);
      return await getAgentDashboardData(agentId);
    } catch (e) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
    }
  }),

  // 获取团队数据
  getTeam: publicProcedure.query(async ({ ctx }) => {
    let agentId: number;
    try {
      agentId = await getAuthenticatedAgentId(ctx);
    } catch (e) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
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
      .where(eq(users.inviterId, agentId))
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
      let totalRecharge = '0.00';
      let commission = '0.00';
      
      try {
        const rechargeResult = await db.execute(sql`
          SELECT COALESCE(SUM(orderAmount), 0) as total FROM agent_commissions 
          WHERE fromUserId = ${user.id} AND agentId = ${agentId}
        `);
        totalRecharge = parseFloat((rechargeResult[0] as any[])[0]?.total || '0').toFixed(2);
      } catch (e) {
        // 如果查询失败，使用默认值
      }
      
      try {
        const commissionResult = await db.execute(sql`
          SELECT COALESCE(SUM(COALESCE(commissionAmount, 0) + COALESCE(bonusAmount, 0)), 0) as total 
          FROM agent_commissions 
          WHERE fromUserId = ${user.id} AND agentId = ${agentId}
        `);
        commission = parseFloat((commissionResult[0] as any[])[0]?.total || '0').toFixed(2);
      } catch (e) {
        // 如果查询失败，使用默认值
      }
      
      return {
        id: user.id,
        displayName: getUserDisplayName(user.name, user.email),
        email: maskEmail(user.email), // 脱敏邮箱
        createdAt: new Date(user.createdAt).toLocaleDateString('zh-CN'),
        totalRecharge,
        commission,
      };
    }));
    
    const enrichedLevel2 = level2Users.map(user => ({
      id: user.id,
      displayName: getUserDisplayName(user.name, user.email),
      email: maskEmail(user.email), // 脱敏邮箱
      inviterEmail: maskEmail(user.inviterEmail), // 脱敏上级邮箱
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
  getCommissions: publicProcedure.query(async ({ ctx }) => {
    let agentId: number;
    try {
      agentId = await getAuthenticatedAgentId(ctx);
    } catch (e) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
    }
    
    const db = getDb();
    const result = await db.execute(sql`
      SELECT ac.*, u.email as fromUserEmail
      FROM agent_commissions ac
      LEFT JOIN users u ON ac.fromUserId = u.id
      WHERE ac.agentId = ${agentId}
      ORDER BY ac.createdAt DESC
      LIMIT 100
    `);
    
    const commissions = (result[0] as any[]).map(c => ({
      level: c.commissionLevel === 'level1' ? 1 : 2,
      fromUser: maskEmail(c.fromUserEmail),
      orderAmount: parseFloat(c.orderAmount).toFixed(2),
      rate: parseFloat(c.commissionRate).toFixed(0),
      amount: (parseFloat(c.commissionAmount) + parseFloat(c.bonusAmount || '0')).toFixed(2),
      status: c.status,
      time: new Date(c.createdAt).toLocaleDateString('zh-CN'),
    }));
    
    return { commissions };
  }),

  // 获取提现记录
  getWithdrawals: publicProcedure.query(async ({ ctx }) => {
    let agentId: number;
    try {
      agentId = await getAuthenticatedAgentId(ctx);
    } catch (e) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
    }
    
    const result = await getAgentWithdrawals(agentId, 1, 50);
    
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
  submitWithdrawal: publicProcedure
    .input(z.object({
      amount: z.number().min(50, "最低提现金额为50 USDT"),
      walletAddress: z.string().min(1, "请输入钱包地址"),
    }))
    .mutation(async ({ ctx, input }) => {
      let agentId: number;
      try {
        agentId = await getAuthenticatedAgentId(ctx);
      } catch (e) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
      }
      
      const result = await createWithdrawal(
        agentId,
        input.amount,
        input.walletAddress,
        'TRC20'
      );
      
      if (!result.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      }
      
      return result;
    }),

  // 更新钱包地址
  updateWalletAddress: publicProcedure
    .input(z.object({
      walletAddress: z.string().min(1, "请输入钱包地址"),
    }))
    .mutation(async ({ ctx, input }) => {
      let agentId: number;
      try {
        agentId = await getAuthenticatedAgentId(ctx);
      } catch (e) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
      }
      
      // 验证TRC20地址格式
      if (!input.walletAddress.startsWith('T') || input.walletAddress.length !== 34) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请输入有效的TRC20地址" });
      }
      
      const db = getDb();
      await db.update(users)
        .set({ agentWalletAddress: input.walletAddress })
        .where(eq(users.id, agentId));
      
      return { success: true, message: "钱包地址已更新" };
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
    fromUser: maskEmail(c.fromUserEmail),
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

  // 调整代理佣金余额（管理员功能）
  adjustBalance: adminProcedure
    .input(z.object({
      agentId: z.number(),
      type: z.enum(["add", "subtract", "set"]),
      amount: z.number().min(0),
      reason: z.string().min(1, "请填写调整原因"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const agent = await db.select().from(users).where(eq(users.id, input.agentId)).limit(1);
      
      if (!agent[0] || !agent[0].isAgent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "代理不存在" });
      }
      
      const currentBalance = parseFloat(agent[0].agentBalance || '0');
      let newBalance: number;
      
      if (input.type === 'add') {
        newBalance = currentBalance + input.amount;
      } else if (input.type === 'subtract') {
        newBalance = Math.max(0, currentBalance - input.amount);
      } else {
        newBalance = input.amount;
      }
      
      await db.update(users).set({
        agentBalance: newBalance.toFixed(2),
      }).where(eq(users.id, input.agentId));
      
      await logAdmin(
        (ctx as any).adminUser?.username || 'admin',
        'adjust_agent_balance',
        'agent',
        input.agentId.toString(),
        { type: input.type, amount: input.amount, reason: input.reason, oldBalance: currentBalance, newBalance }
      );
      
      return { success: true, oldBalance: currentBalance, newBalance };
    }),

  // 清除代理佣金（归零）
  clearBalance: adminProcedure
    .input(z.object({
      agentId: z.number(),
      reason: z.string().min(1, "请填写清除原因"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const agent = await db.select().from(users).where(eq(users.id, input.agentId)).limit(1);
      
      if (!agent[0] || !agent[0].isAgent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "代理不存在" });
      }
      
      const oldBalance = parseFloat(agent[0].agentBalance || '0');
      const oldFrozen = parseFloat(agent[0].agentFrozenBalance || '0');
      
      await db.update(users).set({
        agentBalance: '0',
        agentFrozenBalance: '0',
      }).where(eq(users.id, input.agentId));
      
      await logAdmin(
        (ctx as any).adminUser?.username || 'admin',
        'clear_agent_balance',
        'agent',
        input.agentId.toString(),
        { reason: input.reason, oldBalance, oldFrozen }
      );
      
      return { success: true, clearedBalance: oldBalance, clearedFrozen: oldFrozen };
    }),

  // 获取代理佣金明细（管理员查看）
  agentCommissions: adminProcedure
    .input(z.object({
      agentId: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      const page = input.page || 1;
      const limit = input.limit || 20;
      const offset = (page - 1) * limit;
      
      // 获取佣金记录
      const commissionsResult = await db.execute(sql`
        SELECT ac.*, u.email as fromUserEmail
        FROM agent_commissions ac
        LEFT JOIN users u ON ac.fromUserId = u.id
        WHERE ac.agentId = ${input.agentId}
        ORDER BY ac.createdAt DESC
        LIMIT ${limit} OFFSET ${offset}
      `);
      
      // 获取总数
      const countResult = await db.execute(sql`
        SELECT COUNT(*) as total FROM agent_commissions WHERE agentId = ${input.agentId}
      `);
      
      const commissions = (commissionsResult[0] as any[]).map(c => ({
        id: c.id,
        level: c.commissionLevel,
        fromUserEmail: c.fromUserEmail,
        orderAmount: parseFloat(c.orderAmount || '0').toFixed(2),
        commissionRate: parseFloat(c.commissionRate || '0'),
        commissionAmount: parseFloat(c.commissionAmount || '0').toFixed(2),
        bonusAmount: parseFloat(c.bonusAmount || '0').toFixed(2),
        status: c.status,
        createdAt: c.createdAt,
        settledAt: c.settledAt,
      }));
      
      return {
        commissions,
        total: (countResult[0] as any[])[0]?.total || 0,
        page,
        limit,
      };
    }),

  // 获取代理下属用户列表（管理员查看）
  getAgentUsers: adminProcedure
    .input(z.object({
      agentId: z.number(),
      page: z.number().optional(),
      limit: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      const page = input.page || 1;
      const limit = input.limit || 20;
      const offset = (page - 1) * limit;
      
      // 获取一级用户（直推）
      const level1Result = await db.execute(sql`
        SELECT u.id, u.email, u.name, u.credits, u.status, u.createdAt,
               COALESCE((SELECT SUM(orderAmount) FROM agent_commissions WHERE fromUserId = u.id AND agentId = ${input.agentId}), 0) as totalRecharge,
               COALESCE((SELECT SUM(commissionAmount + COALESCE(bonusAmount, 0)) FROM agent_commissions WHERE fromUserId = u.id AND agentId = ${input.agentId}), 0) as totalCommission
        FROM users u
        WHERE u.inviterId = ${input.agentId}
        ORDER BY u.createdAt DESC
        LIMIT ${limit} OFFSET ${offset}
      `);
      
      // 获取一级用户总数
      const level1CountResult = await db.execute(sql`
        SELECT COUNT(*) as total FROM users WHERE inviterId = ${input.agentId}
      `);
      
      // 获取二级用户（间推）
      const level1Ids = (level1Result[0] as any[]).map(u => u.id);
      let level2Users: any[] = [];
      let level2Total = 0;
      
      if (level1Ids.length > 0) {
        const level2Result = await db.execute(sql`
          SELECT u.id, u.email, u.name, u.credits, u.status, u.createdAt, u.inviterId,
                 (SELECT email FROM users WHERE id = u.inviterId) as inviterEmail
          FROM users u
          WHERE u.inviterId IN (${sql.raw(level1Ids.join(','))})
          ORDER BY u.createdAt DESC
          LIMIT 50
        `);
        level2Users = (level2Result[0] as any[]);
        
        const level2CountResult = await db.execute(sql`
          SELECT COUNT(*) as total FROM users WHERE inviterId IN (${sql.raw(level1Ids.join(','))})
        `);
        level2Total = (level2CountResult[0] as any[])[0]?.total || 0;
      }
      
      return {
        level1Users: (level1Result[0] as any[]).map(u => ({
          id: u.id,
          email: u.email,
          name: u.name,
          credits: u.credits,
          status: u.status,
          createdAt: u.createdAt,
          totalRecharge: parseFloat(u.totalRecharge || '0').toFixed(2),
          totalCommission: parseFloat(u.totalCommission || '0').toFixed(2),
        })),
        level1Total: (level1CountResult[0] as any[])[0]?.total || 0,
        level2Users: level2Users.map(u => ({
          id: u.id,
          email: u.email,
          name: u.name,
          credits: u.credits,
          status: u.status,
          createdAt: u.createdAt,
          inviterId: u.inviterId,
          inviterEmail: u.inviterEmail,
        })),
        level2Total,
        page,
        limit,
      };
    }),

  // 将用户分配给代理（手动绑定邀请关系）
  assignUserToAgent: adminProcedure
    .input(z.object({
      userId: z.number(),
      agentId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      
      // 检查用户是否存在
      const user = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!user[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
      }
      
      // 检查代理是否存在
      const agent = await db.select().from(users).where(and(eq(users.id, input.agentId), eq(users.isAgent, true))).limit(1);
      if (!agent[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "代理不存在" });
      }
      
      // 检查用户是否已经有上级
      if (user[0].inviterId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该用户已经有上级代理，无法重复分配" });
      }
      
      // 检查用户是否是代理本人
      if (input.userId === input.agentId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能将代理分配给自己" });
      }
      
      // 更新用户的邀请人
      await db.update(users).set({
        inviterId: input.agentId,
      }).where(eq(users.id, input.userId));
      
      await logAdmin(
        (ctx as any).adminUser?.username || 'admin',
        'assign_user_to_agent',
        'user',
        input.userId.toString(),
        { agentId: input.agentId, agentEmail: agent[0].email }
      );
      
      return { success: true, message: `已将用户分配给代理 ${agent[0].email}` };
    }),

  // 移除用户的代理关联
  removeUserFromAgent: adminProcedure
    .input(z.object({
      userId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      
      // 检查用户是否存在
      const user = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!user[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
      }
      
      if (!user[0].inviterId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该用户没有上级代理" });
      }
      
      const oldAgentId = user[0].inviterId;
      
      // 移除邀请关系
      await db.update(users).set({
        inviterId: null,
      }).where(eq(users.id, input.userId));
      
      await logAdmin(
        (ctx as any).adminUser?.username || 'admin',
        'remove_user_from_agent',
        'user',
        input.userId.toString(),
        { oldAgentId }
      );
      
      return { success: true, message: "已移除用户的代理关联" };
    }),
});
