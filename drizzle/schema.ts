import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, decimal, boolean } from "drizzle-orm/mysql-core";

/**
 * LeadHunter Pro - 完整数据库Schema (V6蓝图)
 */

// 用户表
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  name: text("name"),
  credits: int("credits").default(0).notNull(), // 初始0积分
  status: mysqlEnum("status", ["active", "disabled"]).default("active").notNull(),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  emailVerified: boolean("emailVerified").default(false),
  resetToken: varchar("resetToken", { length: 100 }),
  resetTokenExpires: timestamp("resetTokenExpires"),
  // 单设备锁定
  currentDeviceId: varchar("currentDeviceId", { length: 100 }),
  currentDeviceLoginAt: timestamp("currentDeviceLoginAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// 系统配置表
export const systemConfigs = mysqlTable("system_configs", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  updatedBy: varchar("updatedBy", { length: 50 }),
});

export type SystemConfig = typeof systemConfigs.$inferSelect;

// 充值订单表
export const rechargeOrders = mysqlTable("recharge_orders", {
  id: int("id").autoincrement().primaryKey(),
  orderId: varchar("orderId", { length: 32 }).notNull().unique(),
  userId: int("userId").notNull(),
  credits: int("credits").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  walletAddress: varchar("walletAddress", { length: 100 }).notNull(),
  network: varchar("network", { length: 20 }).default("TRC20").notNull(),
  status: mysqlEnum("status", ["pending", "paid", "cancelled", "expired", "mismatch"]).default("pending").notNull(),
  txId: varchar("txId", { length: 100 }),
  receivedAmount: decimal("receivedAmount", { precision: 10, scale: 2 }),
  adminNote: text("adminNote"),
  expiresAt: timestamp("expiresAt").notNull(),
  paidAt: timestamp("paidAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RechargeOrder = typeof rechargeOrders.$inferSelect;

// 搜索任务表
export const searchTasks = mysqlTable("search_tasks", {
  id: int("id").autoincrement().primaryKey(),
  taskId: varchar("taskId", { length: 32 }).notNull().unique(),
  userId: int("userId").notNull(),
  searchHash: varchar("searchHash", { length: 32 }).notNull(),
  params: json("params").notNull(),
  requestedCount: int("requestedCount").notNull(),
  actualCount: int("actualCount").default(0),
  creditsUsed: int("creditsUsed").default(0),
  status: mysqlEnum("status", ["pending", "running", "completed", "failed"]).default("pending").notNull(),
  progress: int("progress").default(0),
  logs: json("logs").$type<Array<{ timestamp: string; level: string; message: string }>>(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type SearchTask = typeof searchTasks.$inferSelect;

// 搜索结果表
export const searchResults = mysqlTable("search_results", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  apolloId: varchar("apolloId", { length: 64 }).notNull(),
  data: json("data").notNull(),
  verified: boolean("verified").default(false),
  verificationScore: int("verificationScore"),
  verificationDetails: json("verificationDetails"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SearchResult = typeof searchResults.$inferSelect;

// 全局缓存表 (180天)
export const globalCache = mysqlTable("global_cache", {
  id: int("id").autoincrement().primaryKey(),
  cacheKey: varchar("cacheKey", { length: 100 }).notNull().unique(),
  cacheType: mysqlEnum("cacheType", ["search", "person", "verification"]).notNull(),
  data: json("data").notNull(),
  hitCount: int("hitCount").default(0),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GlobalCache = typeof globalCache.$inferSelect;

// 积分变动记录表
export const creditLogs = mysqlTable("credit_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  amount: int("amount").notNull(), // 正数增加，负数减少
  balanceAfter: int("balanceAfter").notNull(),
  type: mysqlEnum("type", ["recharge", "search", "admin_add", "admin_deduct", "refund", "admin_adjust", "bonus"]).notNull(),
  description: text("description"),
  relatedOrderId: varchar("relatedOrderId", { length: 32 }),
  relatedTaskId: varchar("relatedTaskId", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CreditLog = typeof creditLogs.$inferSelect;

// 搜索日志表
export const searchLogs = mysqlTable("search_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  searchHash: varchar("searchHash", { length: 32 }),
  params: json("params"),
  requestedCount: int("requestedCount"),
  actualCount: int("actualCount"),
  creditsUsed: int("creditsUsed"),
  cacheHit: boolean("cacheHit").default(false),
  status: varchar("status", { length: 20 }),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SearchLog = typeof searchLogs.$inferSelect;

// 管理员操作日志表
export const adminLogs = mysqlTable("admin_logs", {
  id: int("id").autoincrement().primaryKey(),
  adminUsername: varchar("adminUsername", { length: 50 }).notNull(),
  action: varchar("action", { length: 50 }).notNull(),
  targetType: varchar("targetType", { length: 50 }), // user, order, config
  targetId: varchar("targetId", { length: 50 }),
  details: json("details"),
  ipAddress: varchar("ipAddress", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdminLog = typeof adminLogs.$inferSelect;

// 登录日志表
export const loginLogs = mysqlTable("login_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  deviceId: varchar("deviceId", { length: 100 }),
  ipAddress: varchar("ipAddress", { length: 50 }),
  userAgent: text("userAgent"),
  success: boolean("success").default(true),
  failReason: text("failReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LoginLog = typeof loginLogs.$inferSelect;

// API调用日志表
export const apiLogs = mysqlTable("api_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  apiType: mysqlEnum("apiType", ["apollo_search", "apollo_enrich", "scrape_tps", "scrape_fps"]).notNull(),
  endpoint: varchar("endpoint", { length: 255 }),
  requestParams: json("requestParams"),
  responseStatus: int("responseStatus"),
  responseTime: int("responseTime"), // 毫秒
  success: boolean("success").default(true),
  errorMessage: text("errorMessage"),
  creditsUsed: int("creditsUsed").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ApiLog = typeof apiLogs.$inferSelect;
