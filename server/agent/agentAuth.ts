/**
 * 代理认证辅助函数
 */

import jwt from "jsonwebtoken";
import { getUserById } from "../db";

const AGENT_JWT_SECRET = process.env.AGENT_JWT_SECRET || process.env.JWT_SECRET || 'agent-secret-key-change-in-production';

export interface AgentUser {
  userId: number;
  email: string;
  isAgent: boolean;
  agentLevel: string;
}

/**
 * 验证代理JWT token
 */
export async function verifyAgentToken(token: string): Promise<AgentUser | null> {
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
      email: decoded.email || user.email,
      isAgent: true,
      agentLevel: user.agentLevel || 'normal',
    };
  } catch (error) {
    return null;
  }
}

/**
 * 从请求上下文获取代理token
 */
export function getAgentTokenFromContext(ctx: any): string | null {
  // 从header获取
  const authHeader = ctx.req?.headers?.authorization || ctx.req?.headers?.['x-agent-token'];
  if (authHeader) {
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    return authHeader;
  }
  return null;
}

/**
 * 验证代理身份并返回用户ID
 * 优先使用代理token，其次使用session中的用户
 */
export async function getAuthenticatedAgentId(ctx: any): Promise<number> {
  // 1. 尝试从代理token验证
  const token = getAgentTokenFromContext(ctx);
  if (token) {
    const agentUser = await verifyAgentToken(token);
    if (agentUser) {
      return agentUser.userId;
    }
  }
  
  // 2. 尝试从session获取（用户端登录）
  const user = ctx.user;
  if (user?.isAgent) {
    return user.id;
  }
  
  throw new Error("UNAUTHORIZED");
}
