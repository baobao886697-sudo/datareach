/**
 * WebSocket 实时推送 Hook
 * 
 * 职责：
 * 1. 管理WebSocket连接的生命周期（连接、断线重连、心跳）
 * 2. 提供消息订阅机制，各页面组件可以按消息类型订阅
 * 3. 与React Query集成，WebSocket消息可以直接更新缓存
 * 
 * 设计原则：
 * - WebSocket是增强层，断开时不影响任何现有功能
 * - 自动重连使用指数退避策略，不会给服务器造成压力
 * - 所有操作都有错误保护，绝不抛出未捕获异常
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ==================== 类型定义 ====================

export interface WsMessage {
  type: "task_progress" | "task_completed" | "task_failed" | "credits_update" | "notification" | "announcement" | "pong" | "connected";
  taskId?: string;
  source?: "tps" | "spf" | "anywho" | "linkedin";
  data?: Record<string, any>;
  timestamp: string;
}

type MessageHandler = (message: WsMessage) => void;

// ==================== 常量 ====================

// 重连策略：指数退避
const RECONNECT_BASE_DELAY = 1000;   // 初始重连延迟 1秒
const RECONNECT_MAX_DELAY = 30000;   // 最大重连延迟 30秒
const RECONNECT_MULTIPLIER = 2;      // 退避倍数

// 心跳策略
const PING_INTERVAL = 25000;         // 每25秒发送一次ping
const PONG_TIMEOUT = 10000;          // 10秒内未收到pong则认为连接断开

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUnmountedRef = useRef(false);
  const isManualCloseRef = useRef(false);

  /**
   * 构建WebSocket URL
   * 自动根据当前页面协议选择 ws:// 或 wss://
   */
  const getWsUrl = useCallback((): string => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/api/ws`;
  }, []);

  /**
   * 清理所有定时器
   */
  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (pongTimerRef.current) {
      clearTimeout(pongTimerRef.current);
      pongTimerRef.current = null;
    }
  }, []);

  /**
   * 分发消息给所有订阅者
   */
  const dispatch = useCallback((type: string, message: WsMessage) => {
    try {
      // 分发给特定类型的监听者
      const handlers = listenersRef.current.get(type);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(message);
          } catch (error) {
            console.error(`[WS] Handler error for type "${type}":`, error);
          }
        }
      }

      // 分发给 "*" 通配符监听者（监听所有消息）
      const allHandlers = listenersRef.current.get("*");
      if (allHandlers) {
        for (const handler of allHandlers) {
          try {
            handler(message);
          } catch (error) {
            console.error("[WS] Wildcard handler error:", error);
          }
        }
      }
    } catch (error) {
      console.error("[WS] Dispatch error:", error);
    }
  }, []);

  /**
   * 启动心跳机制
   */
  const startHeartbeat = useCallback(() => {
    // 清理旧的心跳定时器
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    if (pongTimerRef.current) clearTimeout(pongTimerRef.current);

    pingTimerRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify({ type: "ping" }));
          
          // 设置pong超时检测
          pongTimerRef.current = setTimeout(() => {
            console.warn("[WS] Pong timeout, reconnecting...");
            if (wsRef.current) {
              wsRef.current.close();
            }
          }, PONG_TIMEOUT);
        } catch {
          // 发送失败，连接可能已断开
        }
      }
    }, PING_INTERVAL);
  }, []);

  /**
   * 安排重连（指数退避）
   */
  const scheduleReconnect = useCallback(() => {
    if (isUnmountedRef.current || isManualCloseRef.current) return;

    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(RECONNECT_MULTIPLIER, reconnectAttemptRef.current),
      RECONNECT_MAX_DELAY
    );

    console.log(`[WS] Scheduling reconnect in ${delay}ms (attempt ${reconnectAttemptRef.current + 1})`);

    reconnectTimerRef.current = setTimeout(() => {
      reconnectAttemptRef.current++;
      connect();
    }, delay);
  }, []); // connect 会在下面定义

  /**
   * 建立WebSocket连接
   */
  const connect = useCallback(() => {
    if (isUnmountedRef.current) return;

    // 关闭现有连接
    if (wsRef.current) {
      isManualCloseRef.current = true;
      wsRef.current.close();
      isManualCloseRef.current = false;
    }

    try {
      const url = getWsUrl();
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[WS] Connected");
        setIsConnected(true);
        reconnectAttemptRef.current = 0; // 重置重连计数
        startHeartbeat();

        // 请求浏览器通知权限（仅在用户未做过选择时弹出授权框，只会弹一次）
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
          Notification.requestPermission();
        }
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const message: WsMessage = JSON.parse(event.data);
          
          // 处理pong响应：清除pong超时定时器
          if (message.type === "pong") {
            if (pongTimerRef.current) {
              clearTimeout(pongTimerRef.current);
              pongTimerRef.current = null;
            }
            return;
          }

          // 分发消息给订阅者
          dispatch(message.type, message);
        } catch {
          // 忽略无法解析的消息
        }
      };

      ws.onclose = (event) => {
        console.log(`[WS] Disconnected. Code: ${event.code}, Reason: ${event.reason}`);
        setIsConnected(false);
        clearTimers();

        // 非手动关闭时自动重连
        if (!isManualCloseRef.current && !isUnmountedRef.current) {
          // 4001 = 认证失败，不重连
          if (event.code === 4001) {
            console.warn("[WS] Authentication failed, not reconnecting");
            return;
          }
          scheduleReconnect();
        }
      };

      ws.onerror = () => {
        // onclose 会在 onerror 之后触发，重连逻辑在 onclose 中处理
      };
    } catch (error) {
      console.error("[WS] Connection error:", error);
      scheduleReconnect();
    }
  }, [getWsUrl, startHeartbeat, dispatch, clearTimers, scheduleReconnect]);

  /**
   * 订阅特定类型的消息
   * 返回取消订阅函数
   * 
   * @param type - 消息类型，或 "*" 订阅所有消息
   * @param handler - 消息处理函数
   * @returns 取消订阅函数
   */
  const subscribe = useCallback((type: string, handler: MessageHandler): (() => void) => {
    if (!listenersRef.current.has(type)) {
      listenersRef.current.set(type, new Set());
    }
    listenersRef.current.get(type)!.add(handler);

    // 返回取消订阅函数
    return () => {
      const handlers = listenersRef.current.get(type);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          listenersRef.current.delete(type);
        }
      }
    };
  }, []);

  /**
   * 手动断开连接
   */
  const disconnect = useCallback(() => {
    isManualCloseRef.current = true;
    clearTimers();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, [clearTimers]);

  // 组件挂载时自动连接，卸载时断开
  useEffect(() => {
    isUnmountedRef.current = false;
    connect();

    return () => {
      isUnmountedRef.current = true;
      disconnect();
    };
  }, []);  // 只在挂载时执行一次

  return {
    isConnected,
    subscribe,
    disconnect,
    reconnect: connect,
  };
}
