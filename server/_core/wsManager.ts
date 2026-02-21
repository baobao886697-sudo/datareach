/**
 * WebSocket 实时推送管理器
 * 
 * 职责：
 * 1. 管理所有WebSocket连接，按userId索引
 * 2. 处理连接的认证（复用JWT Cookie）、心跳、断开
 * 3. 提供 sendToUser() 方法供业务代码调用
 * 
 * 设计原则：
 * - 独立模块，不修改任何现有代码的行为
 * - WebSocket推送失败不影响业务逻辑
 * - 所有操作都有try-catch保护，绝不抛出未捕获异常
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "http";
import type { IncomingMessage } from "http";
import { parse as parseCookieHeader } from "cookie";
import { jwtVerify } from "jose";
import { COOKIE_NAME } from "@shared/const";
import { ENV } from "./env";
import * as db from "../db";

// ==================== 消息类型定义 ====================

export interface WsMessage {
  type: "task_progress" | "task_completed" | "task_failed" | "credits_update" | "notification" | "announcement" | "pong" | "connected";
  taskId?: string;
  source?: "tps" | "spf" | "anywho" | "linkedin";
  data?: Record<string, any>;
  timestamp: string;
}

// ==================== 连接信息 ====================

interface ConnectionInfo {
  ws: WebSocket;
  userId: number;
  userName: string;
  connectedAt: Date;
  lastPong: Date;
  isAlive: boolean;
}

// ==================== WebSocket管理器 ====================

class WsManager {
  private connections: Map<number, Set<ConnectionInfo>> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private wss: WebSocketServer | null = null;

  // 每个用户最大连接数（防止同一用户打开过多标签页）
  private readonly MAX_CONNECTIONS_PER_USER = 5;
  // 心跳间隔（25秒，Railway建议20-25秒）
  private readonly HEARTBEAT_INTERVAL_MS = 25000;
  // 心跳超时（60秒未收到pong则断开）
  private readonly HEARTBEAT_TIMEOUT_MS = 60000;

  /**
   * 初始化WebSocket服务，挂载到现有HTTP Server
   * 只需在服务器启动时调用一次
   */
  init(server: HttpServer): void {
    try {
      this.wss = new WebSocketServer({ 
        server, 
        path: "/api/ws",
        // 不自动处理协议升级，我们手动验证认证后再接受
      });

      this.wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
        try {
          await this.handleConnection(ws, req);
        } catch (error) {
          console.error("[WS] Connection handling error:", error);
          ws.close(4000, "Internal error");
        }
      });

      this.wss.on("error", (error) => {
        console.error("[WS] Server error:", error);
      });

      // 启动心跳检测
      this.startHeartbeat();

      console.log("[WS] WebSocket server initialized on /api/ws");
    } catch (error) {
      console.error("[WS] Failed to initialize WebSocket server:", error);
      // 初始化失败不影响HTTP服务器正常运行
    }
  }

  /**
   * 处理新的WebSocket连接
   */
  private async handleConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    // 1. 认证：从Cookie中解析JWT
    const user = await this.authenticateFromCookie(req);
    if (!user) {
      console.warn("[WS] Unauthorized connection attempt, closing");
      ws.close(4001, "Unauthorized");
      return;
    }

    // 2. 检查连接数限制
    const existingConnections = this.connections.get(user.id);
    if (existingConnections && existingConnections.size >= this.MAX_CONNECTIONS_PER_USER) {
      // 关闭最早的连接，为新连接腾位置
      const oldest = Array.from(existingConnections).sort(
        (a, b) => a.connectedAt.getTime() - b.connectedAt.getTime()
      )[0];
      if (oldest) {
        console.log(`[WS] User ${user.id} exceeded max connections, closing oldest`);
        oldest.ws.close(4002, "Too many connections");
        existingConnections.delete(oldest);
      }
    }

    // 3. 注册连接
    const connInfo: ConnectionInfo = {
      ws,
      userId: user.id,
      userName: user.name,
      connectedAt: new Date(),
      lastPong: new Date(),
      isAlive: true,
    };

    if (!this.connections.has(user.id)) {
      this.connections.set(user.id, new Set());
    }
    this.connections.get(user.id)!.add(connInfo);

    console.log(`[WS] User ${user.name}(${user.id}) connected. Total connections for user: ${this.connections.get(user.id)!.size}`);

    // 4. 设置pong响应处理
    ws.on("pong", () => {
      connInfo.lastPong = new Date();
      connInfo.isAlive = true;
    });

    // 5. 处理客户端消息（目前只处理ping）
    ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "ping") {
          this.safeSend(ws, { type: "pong", timestamp: new Date().toISOString() });
        }
      } catch {
        // 忽略无法解析的消息
      }
    });

    // 6. 处理连接关闭
    ws.on("close", (code, reason) => {
      this.removeConnection(user.id, connInfo);
      console.log(`[WS] User ${user.name}(${user.id}) disconnected. Code: ${code}`);
    });

    // 7. 处理连接错误
    ws.on("error", (error) => {
      console.error(`[WS] Connection error for user ${user.id}:`, error.message);
      this.removeConnection(user.id, connInfo);
    });

    // 8. 发送连接成功消息
    this.safeSend(ws, {
      type: "connected",
      data: { userId: user.id, userName: user.name },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * 从HTTP请求的Cookie中解析并验证用户身份
   * 复用现有的JWT认证逻辑
   */
  private async authenticateFromCookie(req: IncomingMessage): Promise<{ id: number; name: string } | null> {
    try {
      const cookieHeader = req.headers.cookie;
      if (!cookieHeader) return null;

      const cookies = parseCookieHeader(cookieHeader);
      const sessionCookie = cookies[COOKIE_NAME];
      if (!sessionCookie) return null;

      // 复用与context.ts相同的JWT验证逻辑
      const secretKey = new TextEncoder().encode(ENV.cookieSecret);
      const { payload } = await jwtVerify(sessionCookie, secretKey, {
        algorithms: ["HS256"],
      });

      const { openId } = payload as Record<string, unknown>;
      if (typeof openId !== "string") return null;

      // 通过openId查找用户
      const user = await db.getUserByOpenId(openId);
      if (!user) return null;

      return { id: user.id, name: user.name };
    } catch (error) {
      console.warn("[WS] Authentication failed:", String(error));
      return null;
    }
  }

  /**
   * 移除连接
   */
  private removeConnection(userId: number, connInfo: ConnectionInfo): void {
    const userConnections = this.connections.get(userId);
    if (userConnections) {
      userConnections.delete(connInfo);
      if (userConnections.size === 0) {
        this.connections.delete(userId);
      }
    }
  }

  /**
   * 启动心跳检测定时器
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      
      for (const [userId, connections] of this.connections) {
        for (const connInfo of connections) {
          // 检查是否超时
          if (now - connInfo.lastPong.getTime() > this.HEARTBEAT_TIMEOUT_MS) {
            console.log(`[WS] Heartbeat timeout for user ${userId}, closing connection`);
            connInfo.ws.terminate();
            connections.delete(connInfo);
            continue;
          }

          // 发送ping
          if (connInfo.ws.readyState === WebSocket.OPEN) {
            connInfo.isAlive = false;
            connInfo.ws.ping();
          }
        }

        // 清理空集合
        if (connections.size === 0) {
          this.connections.delete(userId);
        }
      }
    }, this.HEARTBEAT_INTERVAL_MS);
  }

  // ==================== 公共API ====================

  /**
   * 向指定用户的所有连接发送消息
   * 这是业务代码调用的主要方法
   * 
   * @param userId - 目标用户ID
   * @param message - 要发送的消息
   */
  sendToUser(userId: number, message: WsMessage): void {
    try {
      const userConnections = this.connections.get(userId);
      if (!userConnections || userConnections.size === 0) {
        return; // 用户没有活跃连接，静默返回
      }

      const payload = JSON.stringify(message);

      for (const connInfo of userConnections) {
        this.safeSend(connInfo.ws, message, payload);
      }
    } catch (error) {
      // WebSocket推送失败绝不影响业务逻辑
      console.error(`[WS] Failed to send to user ${userId}:`, error);
    }
  }

  /**
   * 向所有连接的用户广播消息（用于系统通知）
   */
  broadcast(message: WsMessage): void {
    try {
      const payload = JSON.stringify(message);
      for (const [, connections] of this.connections) {
        for (const connInfo of connections) {
          this.safeSend(connInfo.ws, message, payload);
        }
      }
    } catch (error) {
      console.error("[WS] Broadcast failed:", error);
    }
  }

  /**
   * 安全发送消息，捕获所有可能的异常
   */
  private safeSend(ws: WebSocket, message: WsMessage, preStringified?: string): void {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(preStringified || JSON.stringify(message));
      }
    } catch (error) {
      // 静默处理发送失败
    }
  }

  /**
   * 获取当前连接统计信息（用于监控/调试）
   */
  getStats(): { totalUsers: number; totalConnections: number } {
    let totalConnections = 0;
    for (const connections of this.connections.values()) {
      totalConnections += connections.size;
    }
    return {
      totalUsers: this.connections.size,
      totalConnections,
    };
  }

  /**
   * 关闭WebSocket服务（用于优雅关闭）
   */
  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.wss) {
      this.wss.close();
    }
    this.connections.clear();
    console.log("[WS] WebSocket server shut down");
  }
}

// 全局单例
export const wsManager = new WsManager();
