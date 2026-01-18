import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { COOKIE_NAME } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import { jwtVerify } from "jose";
import { ENV } from "./env";
import * as db from "../db";

// 管理员cookie名称
const ADMIN_COOKIE_NAME = "admin_token";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: (User & { role?: string }) | null;
};

// 解析cookies
function parseCookies(cookieHeader: string | undefined): Map<string, string> {
  if (!cookieHeader) {
    return new Map<string, string>();
  }
  const parsed = parseCookieHeader(cookieHeader);
  return new Map(Object.entries(parsed));
}

// 获取JWT密钥
function getSessionSecret() {
  const secret = ENV.cookieSecret;
  return new TextEncoder().encode(secret);
}

// 验证会话Token
async function verifySession(
  cookieValue: string | undefined | null
): Promise<{ openId: string; appId: string; name: string } | null> {
  if (!cookieValue) {
    return null;
  }

  try {
    const secretKey = getSessionSecret();
    const { payload } = await jwtVerify(cookieValue, secretKey, {
      algorithms: ["HS256"],
    });
    const { openId, appId, name } = payload as Record<string, unknown>;

    if (
      typeof openId !== "string" ||
      typeof appId !== "string" ||
      typeof name !== "string"
    ) {
      return null;
    }

    return { openId, appId, name };
  } catch (error) {
    console.warn("[Auth] Session verification failed", String(error));
    return null;
  }
}

// 验证管理员Token
async function verifyAdminToken(
  tokenValue: string | undefined | null
): Promise<{ type: string; username: string } | null> {
  if (!tokenValue) {
    return null;
  }
  try {
    const secretKey = getSessionSecret();
    const { payload } = await jwtVerify(tokenValue, secretKey, {
      algorithms: ["HS256"],
    });
    const { type, username } = payload as Record<string, unknown>;
    if (type !== "admin" || typeof username !== "string") {
      return null;
    }
    return { type: "admin", username };
  } catch (error) {
    console.warn("[Auth] Admin token verification failed", String(error));
    return null;
  }
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: (User & { role?: string }) | null = null;

  try {
    const cookies = parseCookies(opts.req.headers.cookie);
    
    // 首先检查管理员token
    const adminToken = cookies.get(ADMIN_COOKIE_NAME);
    const adminSession = await verifyAdminToken(adminToken);
    
    if (adminSession) {
      // 管理员登录，创建一个虚拟的管理员用户对象
      user = {
        id: 0,
        openId: "admin",
        appId: "admin",
        name: adminSession.username,
        credits: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: "admin",
      } as User & { role: string };
    } else {
      // 检查普通用户session
      const sessionCookie = cookies.get(COOKIE_NAME);
      const session = await verifySession(sessionCookie);
      if (session) {
        // 通过openId查找用户
        user = await db.getUserByOpenId(session.openId) || null;
      }
    }
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
