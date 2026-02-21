/**
 * WebSocket 推送辅助函数
 * 
 * 为业务代码提供简洁的推送接口。
 * 所有函数都是"旁路"设计：推送失败不影响业务逻辑。
 * 
 * 使用方式：
 *   import { emitTaskProgress, emitTaskCompleted, emitCreditsUpdate } from "../_core/wsEmitter";
 *   await emitTaskProgress(userId, taskId, "tps", { progress: 50, logs: [...] });
 */

import { wsManager, type WsMessage } from "./wsManager";

/**
 * 推送任务进度更新
 */
export function emitTaskProgress(
  userId: number,
  taskId: string,
  source: "tps" | "spf" | "anywho",
  data: Record<string, any>
): void {
  try {
    wsManager.sendToUser(userId, {
      type: "task_progress",
      taskId,
      source,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // 静默处理，不影响业务
  }
}

/**
 * 推送任务完成通知
 */
export function emitTaskCompleted(
  userId: number,
  taskId: string,
  source: "tps" | "spf" | "anywho",
  data: Record<string, any>
): void {
  try {
    wsManager.sendToUser(userId, {
      type: "task_completed",
      taskId,
      source,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // 静默处理
  }
}

/**
 * 推送任务失败通知
 */
export function emitTaskFailed(
  userId: number,
  taskId: string,
  source: "tps" | "spf" | "anywho",
  data: Record<string, any>
): void {
  try {
    wsManager.sendToUser(userId, {
      type: "task_failed",
      taskId,
      source,
      data,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // 静默处理
  }
}

/**
 * 推送积分变化
 */
export function emitCreditsUpdate(
  userId: number,
  data: {
    newBalance: number;
    deductedAmount: number;
    source: string;
    taskId?: string;
  }
): void {
  try {
    wsManager.sendToUser(userId, {
      type: "credits_update",
      data,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // 静默处理
  }
}

/**
 * 广播公告给所有在线用户
 */
export function emitAnnouncement(
  data: {
    id: number;
    title: string;
    content: string;
    type?: string;
  }
): void {
  try {
    wsManager.broadcast({
      type: "announcement",
      data,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // 静默处理
  }
}

/**
 * 推送通知消息
 */
export function emitNotification(
  userId: number,
  data: {
    title: string;
    content: string;
    type?: string;
  }
): void {
  try {
    wsManager.sendToUser(userId, {
      type: "notification",
      data,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // 静默处理
  }
}
