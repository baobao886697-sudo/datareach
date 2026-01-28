/**
 * 代理系统数据库操作函数
 */

import { getDbSync } from "./db";
import { users, agentCommissions, agentWithdrawals, agentStats, agentSettings } from "../drizzle/schema";
import { eq, and, desc, sql, gte, lte, sum } from "drizzle-orm";

// 获取数据库实例
function getDb() {
  const db = getDbSync();
  if (!db) throw new Error("Database not available");
  return db;
}

// ============ 工具函数 ============

// 生成唯一邀请码
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 生成提现订单ID
export function generateWithdrawalId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `W${timestamp}${random}`.toUpperCase();
}

// 获取当前月份 YYYY-MM
export function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ============ 代理配置 ============

// 获取代理配置
export async function getAgentSetting(key: string): Promise<string | null> {
  const result = await getDb().select().from(agentSettings).where(eq(agentSettings.settingKey, key)).limit(1);
  return result[0]?.settingValue || null;
}

// 设置代理配置
export async function setAgentSetting(key: string, value: string, description?: string): Promise<void> {
  await getDb().insert(agentSettings)
    .values({ settingKey: key, settingValue: value, description })
    .onDuplicateKeyUpdate({ set: { settingValue: value } });
}

// 获取所有代理配置
export async function getAllAgentSettings(): Promise<Record<string, string>> {
  const results = await getDb().select().from(agentSettings);
  const settings: Record<string, string> = {};
  for (const row of results) {
    settings[row.settingKey] = row.settingValue;
  }
  return settings;
}

// 初始化默认代理配置
export async function initAgentSettings(): Promise<void> {
  const defaults = [
    { key: 'founder_limit', value: '100', desc: '创始代理名额限制' },
    { key: 'founder_level1_rate', value: '15', desc: '创始代理一级佣金比例' },
    { key: 'founder_level2_rate', value: '5', desc: '创始代理二级佣金比例' },
    { key: 'gold_level1_rate', value: '12', desc: '金牌代理一级佣金比例' },
    { key: 'gold_level2_rate', value: '4', desc: '金牌代理二级佣金比例' },
    { key: 'silver_level1_rate', value: '10', desc: '银牌代理一级佣金比例' },
    { key: 'silver_level2_rate', value: '3', desc: '银牌代理二级佣金比例' },
    { key: 'normal_level1_rate', value: '8', desc: '普通代理一级佣金比例' },
    { key: 'normal_level2_rate', value: '2', desc: '普通代理二级佣金比例' },
    { key: 'first_charge_bonus', value: '3', desc: '首充额外奖励比例' },
    { key: 'min_withdrawal', value: '50', desc: '最低提现金额(USDT)' },
    { key: 'settlement_days', value: '7', desc: '佣金结算冻结天数' },
    { key: 'activity_bonus', value: '3', desc: '开业活动额外奖励' },
    { key: 'activity_end_date', value: '2026-02-28', desc: '开业活动结束日期' },
  ];
  
  for (const item of defaults) {
    const existing = await getAgentSetting(item.key);
    if (!existing) {
      await setAgentSetting(item.key, item.value, item.desc);
    }
  }
}

// ============ 用户邀请码 ============

// 通过邀请码查找用户
export async function findUserByInviteCode(inviteCode: string) {
  const result = await getDb().select().from(users).where(eq(users.inviteCode, inviteCode)).limit(1);
  return result[0] || null;
}

// 为用户生成邀请码
export async function generateUserInviteCode(userId: number): Promise<string> {
  let code = generateInviteCode();
  let attempts = 0;
  
  // 确保邀请码唯一
  while (attempts < 10) {
    const existing = await findUserByInviteCode(code);
    if (!existing) break;
    code = generateInviteCode();
    attempts++;
  }
  
  await getDb().update(users).set({ inviteCode: code }).where(eq(users.id, userId));
  return code;
}

// 绑定邀请人
export async function bindInviter(userId: number, inviterId: number): Promise<boolean> {
  // 防止自己邀请自己
  if (userId === inviterId) return false;
  
  // 检查邀请人是否存在且是代理
  const inviter = await getDb().select().from(users).where(eq(users.id, inviterId)).limit(1);
  if (!inviter[0] || !inviter[0].isAgent) return false;
  
  await getDb().update(users).set({ inviterId }).where(eq(users.id, userId));
  return true;
}

// ============ 代理申请与审核 ============

// 申请成为代理
export async function applyForAgent(userId: number): Promise<boolean> {
  const user = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user[0] || user[0].isAgent) return false;
  
  // 生成邀请码
  const inviteCode = await generateUserInviteCode(userId);
  
  await getDb().update(users).set({
    isAgent: true,
    agentAppliedAt: new Date(),
    agentApprovedAt: new Date(), // 自动审核通过
    inviteCode,
  }).where(eq(users.id, userId));
  
  // 检查是否为创始代理（前100名）
  const founderLimit = parseInt(await getAgentSetting('founder_limit') || '100');
  const agentCount = await getDb().select({ count: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.isAgent, true));
  
  if (agentCount[0].count <= founderLimit) {
    await getDb().update(users).set({ agentLevel: 'founder' }).where(eq(users.id, userId));
  }
  
  return true;
}

// 获取创始代理剩余名额
export async function getFounderSlotsRemaining(): Promise<number> {
  const founderLimit = parseInt(await getAgentSetting('founder_limit') || '100');
  const founderCount = await getDb().select({ count: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.agentLevel, 'founder'));
  return Math.max(0, founderLimit - founderCount[0].count);
}

// ============ 佣金计算 ============

// 获取代理佣金比例
export async function getCommissionRates(agentLevel: string): Promise<{ level1: number; level2: number }> {
  const settings = await getAllAgentSettings();
  
  const rates: Record<string, { level1: number; level2: number }> = {
    founder: {
      level1: parseFloat(settings.founder_level1_rate || '15'),
      level2: parseFloat(settings.founder_level2_rate || '5'),
    },
    gold: {
      level1: parseFloat(settings.gold_level1_rate || '12'),
      level2: parseFloat(settings.gold_level2_rate || '4'),
    },
    silver: {
      level1: parseFloat(settings.silver_level1_rate || '10'),
      level2: parseFloat(settings.silver_level2_rate || '3'),
    },
    normal: {
      level1: parseFloat(settings.normal_level1_rate || '8'),
      level2: parseFloat(settings.normal_level2_rate || '2'),
    },
  };
  
  return rates[agentLevel] || rates.normal;
}

// 检查是否在活动期间
export async function isActivityPeriod(): Promise<boolean> {
  const endDate = await getAgentSetting('activity_end_date');
  if (!endDate) return false;
  return new Date() <= new Date(endDate);
}

// 检查用户是否首充
export async function isFirstRecharge(userId: number): Promise<boolean> {
  const result = await getDb().select({ count: sql<number>`count(*)` })
    .from(agentCommissions)
    .where(eq(agentCommissions.fromUserId, userId));
  return result[0].count === 0;
}

// 计算并创建佣金记录
export async function calculateAndCreateCommission(
  orderId: string,
  userId: number,
  orderAmount: number
): Promise<void> {
  // 获取用户信息
  const user = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user[0] || !user[0].inviterId) return;
  
  const settings = await getAllAgentSettings();
  const isActivity = await isActivityPeriod();
  const isFirst = await isFirstRecharge(userId);
  const activityBonus = isActivity ? parseFloat(settings.activity_bonus || '3') : 0;
  const firstChargeBonus = isFirst ? parseFloat(settings.first_charge_bonus || '3') : 0;
  
  // 一级代理佣金
  const level1Agent = await getDb().select().from(users).where(eq(users.id, user[0].inviterId)).limit(1);
  if (level1Agent[0] && level1Agent[0].isAgent) {
    const rates = await getCommissionRates(level1Agent[0].agentLevel || 'normal');
    const baseRate = rates.level1;
    const totalBonusRate = activityBonus + firstChargeBonus;
    const commissionAmount = orderAmount * baseRate / 100;
    const bonusAmount = orderAmount * totalBonusRate / 100;
    
    // 佣金直接结算到可提现余额（实时到账）
    const totalAmount = commissionAmount + bonusAmount;
    
    await getDb().insert(agentCommissions).values({
      agentId: level1Agent[0].id,
      fromUserId: userId,
      orderId,
      orderAmount: orderAmount.toString(),
      commissionLevel: 'level1',
      commissionRate: baseRate.toString(),
      commissionAmount: commissionAmount.toString(),
      bonusType: isFirst ? 'first_charge' : (isActivity ? 'activity' : null),
      bonusAmount: bonusAmount.toString(),
      status: 'settled',  // 直接设为已结算状态
    });
    
    // 直接更新代理可提现余额（实时到账）
    await getDb().update(users).set({
      agentBalance: sql`${users.agentBalance} + ${totalAmount}`,
      agentTotalEarned: sql`${users.agentTotalEarned} + ${totalAmount}`,
    }).where(eq(users.id, level1Agent[0].id));
    
    // 二级代理佣金
    if (level1Agent[0].inviterId) {
      const level2Agent = await getDb().select().from(users).where(eq(users.id, level1Agent[0].inviterId)).limit(1);
      if (level2Agent[0] && level2Agent[0].isAgent) {
        const level2Rates = await getCommissionRates(level2Agent[0].agentLevel || 'normal');
        const level2CommissionAmount = orderAmount * level2Rates.level2 / 100;
        
        await getDb().insert(agentCommissions).values({
          agentId: level2Agent[0].id,
          fromUserId: userId,
          orderId,
          orderAmount: orderAmount.toString(),
          commissionLevel: 'level2',
          commissionRate: level2Rates.level2.toString(),
          commissionAmount: level2CommissionAmount.toString(),
          bonusType: null,
          bonusAmount: '0',
          status: 'settled',  // 直接设为已结算状态
        });
        
        // 直接更新二级代理可提现余额（实时到账）
        await getDb().update(users).set({
          agentBalance: sql`${users.agentBalance} + ${level2CommissionAmount}`,
          agentTotalEarned: sql`${users.agentTotalEarned} + ${level2CommissionAmount}`,
        }).where(eq(users.id, level2Agent[0].id));
      }
    }
  }
}

// ============ 佣金结算 ============

// 结算到期佣金（7天后）
export async function settlePendingCommissions(): Promise<number> {
  const settlementDays = parseInt(await getAgentSetting('settlement_days') || '7');
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - settlementDays);
  
  // 查找待结算的佣金
  const pendingCommissions = await getDb().select()
    .from(agentCommissions)
    .where(and(
      eq(agentCommissions.status, 'pending'),
      lte(agentCommissions.createdAt, cutoffDate)
    ));
  
  let settledCount = 0;
  
  for (const commission of pendingCommissions) {
    const totalAmount = parseFloat(commission.commissionAmount) + parseFloat(commission.bonusAmount || '0');
    
    // 更新佣金状态
    await getDb().update(agentCommissions).set({
      status: 'settled',
      settledAt: new Date(),
    }).where(eq(agentCommissions.id, commission.id));
    
    // 从冻结余额转到可提现余额
    await getDb().update(users).set({
      agentFrozenBalance: sql`${users.agentFrozenBalance} - ${totalAmount}`,
      agentBalance: sql`${users.agentBalance} + ${totalAmount}`,
      agentTotalEarned: sql`${users.agentTotalEarned} + ${totalAmount}`,
    }).where(eq(users.id, commission.agentId));
    
    settledCount++;
  }
  
  return settledCount;
}

// ============ 提现 ============

// 创建提现申请
export async function createWithdrawal(
  agentId: number,
  amount: number,
  walletAddress: string,
  network: string = 'TRC20'
): Promise<{ success: boolean; message: string; withdrawalId?: string }> {
  // 检查最低提现金额
  const minWithdrawal = parseFloat(await getAgentSetting('min_withdrawal') || '50');
  if (amount < minWithdrawal) {
    return { success: false, message: `最低提现金额为 ${minWithdrawal} USDT` };
  }
  
  // 检查余额
  const agent = await getDb().select().from(users).where(eq(users.id, agentId)).limit(1);
  if (!agent[0] || parseFloat(agent[0].agentBalance || '0') < amount) {
    return { success: false, message: '可提现余额不足' };
  }
  
  const withdrawalId = generateWithdrawalId();
  
  // 创建提现记录
  await getDb().insert(agentWithdrawals).values({
    withdrawalId,
    agentId,
    amount: amount.toString(),
    walletAddress,
    network,
    status: 'pending',
  });
  
  // 扣除可提现余额
  await getDb().update(users).set({
    agentBalance: sql`${users.agentBalance} - ${amount}`,
  }).where(eq(users.id, agentId));
  
  return { success: true, message: '提现申请已提交', withdrawalId };
}

// 处理提现申请（管理员）
export async function processWithdrawal(
  withdrawalId: string,
  action: 'approve' | 'reject' | 'paid',
  adminUsername: string,
  txId?: string,
  adminNote?: string
): Promise<boolean> {
  const withdrawal = await getDb().select()
    .from(agentWithdrawals)
    .where(eq(agentWithdrawals.withdrawalId, withdrawalId))
    .limit(1);
  
  if (!withdrawal[0]) return false;
  
  if (action === 'reject') {
    // 退回余额
    await getDb().update(users).set({
      agentBalance: sql`${users.agentBalance} + ${withdrawal[0].amount}`,
    }).where(eq(users.id, withdrawal[0].agentId));
    
    const rejectData: any = {
      status: 'rejected',
      processedBy: adminUsername,
      processedAt: new Date(),
    };
    if (adminNote && adminNote.trim()) {
      rejectData.adminNote = adminNote.trim();
    }
    await getDb().update(agentWithdrawals).set(rejectData).where(eq(agentWithdrawals.id, withdrawal[0].id));
  } else if (action === 'approve') {
    const approveData: any = {
      status: 'approved',
      processedBy: adminUsername,
      processedAt: new Date(),
    };
    if (adminNote && adminNote.trim()) {
      approveData.adminNote = adminNote.trim();
    }
    await getDb().update(agentWithdrawals).set(approveData).where(eq(agentWithdrawals.id, withdrawal[0].id));
  } else if (action === 'paid') {
    // 构建更新对象，只有当txId有值时才更新
    const updateData: any = {
      status: 'paid',
      processedBy: adminUsername,
      processedAt: new Date(),
    };
    // 只有当txId有实际值时才更新
    if (txId && txId.trim()) {
      updateData.txId = txId.trim();
    }
    if (adminNote) {
      updateData.adminNote = adminNote;
    }
    await getDb().update(agentWithdrawals).set(updateData).where(eq(agentWithdrawals.id, withdrawal[0].id));
    
    // 更新佣金记录状态为已提现
    // 这里简化处理，实际可能需要更复杂的逻辑
  }
  
  return true;
}

// ============ 统计查询 ============

// 获取代理统计信息
export async function getAgentStats(agentId: number) {
  const agent = await getDb().select().from(users).where(eq(users.id, agentId)).limit(1);
  if (!agent[0]) return null;
  
  // 下级用户数
  const teamUsers = await getDb().select({ count: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.inviterId, agentId));
  
  // 下级代理数
  const teamAgents = await getDb().select({ count: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.inviterId, agentId), eq(users.isAgent, true)));
  
  // 今日佣金
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayCommissions = await getDb().select({
    total: sql<number>`COALESCE(SUM(${agentCommissions.commissionAmount} + ${agentCommissions.bonusAmount}), 0)`
  })
    .from(agentCommissions)
    .where(and(
      eq(agentCommissions.agentId, agentId),
      gte(agentCommissions.createdAt, today)
    ));
  
  // 本月佣金
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthCommissions = await getDb().select({
    total: sql<number>`COALESCE(SUM(${agentCommissions.commissionAmount} + ${agentCommissions.bonusAmount}), 0)`
  })
    .from(agentCommissions)
    .where(and(
      eq(agentCommissions.agentId, agentId),
      gte(agentCommissions.createdAt, monthStart)
    ));
  
  return {
    agentLevel: agent[0].agentLevel,
    inviteCode: agent[0].inviteCode,
    balance: parseFloat(agent[0].agentBalance || '0'),
    frozenBalance: parseFloat(agent[0].agentFrozenBalance || '0'),
    totalEarned: parseFloat(agent[0].agentTotalEarned || '0'),
    teamUsers: teamUsers[0].count,
    teamAgents: teamAgents[0].count,
    todayCommission: todayCommissions[0].total,
    monthCommission: monthCommissions[0].total,
    walletAddress: agent[0].agentWalletAddress,
    email: agent[0].email,
    name: agent[0].name,
  };
}

// 获取代理下级用户列表
export async function getAgentTeamUsers(agentId: number, page: number = 1, limit: number = 20) {
  const offset = (page - 1) * limit;
  
  const teamUsers = await getDb().select({
    id: users.id,
    email: users.email,
    name: users.name,
    createdAt: users.createdAt,
    isAgent: users.isAgent,
  })
    .from(users)
    .where(eq(users.inviterId, agentId))
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(offset);
  
  const totalResult = await getDb().select({ count: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.inviterId, agentId));
  const total = totalResult[0]?.count || 0;
  
  return {
    users: teamUsers,
    total,
    page,
    limit,
  };
}

// 获取代理佣金明细
export async function getAgentCommissions(
  agentId: number,
  status?: string,
  page: number = 1,
  limit: number = 20
) {
  const offset = (page - 1) * limit;
  const db = getDb();
  
  const whereCondition = status 
    ? and(eq(agentCommissions.agentId, agentId), eq(agentCommissions.status, status as any))
    : eq(agentCommissions.agentId, agentId);
  
  const commissions = await db.select()
    .from(agentCommissions)
    .where(whereCondition)
    .orderBy(desc(agentCommissions.createdAt))
    .limit(limit)
    .offset(offset);
  
  const totalResult = await db.select({ count: sql<number>`count(*)` })
    .from(agentCommissions)
    .where(eq(agentCommissions.agentId, agentId));
  const total = totalResult[0]?.count || 0;
  
  return {
    commissions,
    total,
    page,
    limit,
  };
}

// 获取代理提现记录
export async function getAgentWithdrawals(agentId: number, page: number = 1, limit: number = 20) {
  const offset = (page - 1) * limit;
  
  const withdrawals = await getDb().select()
    .from(agentWithdrawals)
    .where(eq(agentWithdrawals.agentId, agentId))
    .orderBy(desc(agentWithdrawals.createdAt))
    .limit(limit)
    .offset(offset);
  
  const totalResult = await getDb().select({ count: sql<number>`count(*)` })
    .from(agentWithdrawals)
    .where(eq(agentWithdrawals.agentId, agentId));
  const total = totalResult[0]?.count || 0;
  
  return {
    withdrawals,
    total,
    page,
    limit,
  };
}

// ============ 管理员功能 ============

// 获取所有代理列表
export async function getAllAgents(page: number = 1, limit: number = 20, search?: string) {
  const offset = (page - 1) * limit;
  
  let whereClause = eq(users.isAgent, true);
  if (search) {
    whereClause = and(
      eq(users.isAgent, true),
      or(
        like(users.email, `%${search}%`),
        like(users.name, `%${search}%`),
        like(users.inviteCode, `%${search}%`)
      )
    ) as any;
  }
  
  const agents = await getDb().select({
    id: users.id,
    email: users.email,
    name: users.name,
    agentLevel: users.agentLevel,
    agentBalance: users.agentBalance,
    agentFrozenBalance: users.agentFrozenBalance,
    agentTotalEarned: users.agentTotalEarned,
    inviteCode: users.inviteCode,
    agentApprovedAt: users.agentApprovedAt,
    createdAt: users.createdAt,
  })
    .from(users)
    .where(whereClause)
    .orderBy(desc(users.agentApprovedAt))
    .limit(limit)
    .offset(offset);
  
  const totalResult = await getDb().select({ count: sql<number>`count(*)` })
    .from(users)
    .where(whereClause);
  const total = totalResult[0]?.count || 0;
  
  return {
    agents,
    total,
    page,
    limit,
  };
}

// 获取所有提现申请
export async function getAllWithdrawals(status?: string, page: number = 1, limit: number = 20) {
  const offset = (page - 1) * limit;
  
  let whereClause = (status && status !== 'all') ? eq(agentWithdrawals.status, status as any) : undefined;
  
  const withdrawals = await getDb().select({
    withdrawal: agentWithdrawals,
    agentEmail: users.email,
    agentName: users.name,
  })
    .from(agentWithdrawals)
    .leftJoin(users, eq(agentWithdrawals.agentId, users.id))
    .where(whereClause)
    .orderBy(desc(agentWithdrawals.createdAt))
    .limit(limit)
    .offset(offset);
  
  const totalResult = await getDb().select({ count: sql<number>`count(*)` })
    .from(agentWithdrawals)
    .where(whereClause);
  const total = totalResult[0]?.count || 0;
  
  return {
    withdrawals,
    total,
    page,
    limit,
  };
}

// 设置代理等级
export async function setAgentLevel(agentId: number, level: 'normal' | 'silver' | 'gold' | 'founder'): Promise<boolean> {
  const result = await getDb().update(users)
    .set({ agentLevel: level })
    .where(and(eq(users.id, agentId), eq(users.isAgent, true)));
  return true;
}
