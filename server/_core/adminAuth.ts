/**
 * 独立管理员认证系统 (V6蓝图)
 * 
 * 管理员认证完全独立于用户认证系统，不使用Manus OAuth，
 * 而是使用环境变量配置的固定管理员账户。
 */

import jwt from "jsonwebtoken";
import { ENV } from "./env";

// 管理员JWT payload
interface AdminJwtPayload {
  type: "admin";
  username: string;
  iat: number;
  exp: number;
}

// 管理员登录验证
export function validateAdminCredentials(username: string, password: string): boolean {
  return username === ENV.adminUsername && password === ENV.adminPassword;
}

// 生成管理员JWT (24小时过期)
export function generateAdminToken(username: string): string {
  return jwt.sign(
    { type: "admin", username },
    ENV.adminJwtSecret,
    { expiresIn: "24h" }
  );
}

// 验证管理员JWT
export function verifyAdminToken(token: string): AdminJwtPayload | null {
  try {
    const payload = jwt.verify(token, ENV.adminJwtSecret) as AdminJwtPayload;
    if (payload.type !== "admin") {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

// 从请求头获取管理员token
export function getAdminTokenFromHeader(headers: Record<string, string | string[] | undefined>): string | null {
  const authHeader = headers["x-admin-token"];
  if (typeof authHeader === "string") {
    return authHeader;
  }
  if (Array.isArray(authHeader) && authHeader.length > 0) {
    return authHeader[0];
  }
  return null;
}
