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
  status: mysqlEnum("status", ["pending", "running", "completed", "failed", "stopped", "insufficient_credits"]).default("pending").notNull(),
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
  mode: mysqlEnum("mode", ["fuzzy", "exact"]).default("fuzzy"), // 搜索模式
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
  apiType: mysqlEnum("apiType", ["apollo_search", "apollo_enrich", "apify_search", "scrape_tps", "scrape_fps"]).notNull(),
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


// 系统公告表
export const announcements = mysqlTable("announcements", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content").notNull(),
  type: mysqlEnum("type", ["info", "warning", "success", "error"]).default("info").notNull(),
  isPinned: boolean("isPinned").default(false),
  isActive: boolean("isActive").default(true),
  startTime: timestamp("startTime"),
  endTime: timestamp("endTime"),
  createdBy: varchar("createdBy", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Announcement = typeof announcements.$inferSelect;
export type InsertAnnouncement = typeof announcements.$inferInsert;

// 用户消息表
export const userMessages = mysqlTable("user_messages", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content").notNull(),
  type: mysqlEnum("type", ["system", "support", "notification", "promotion"]).default("system").notNull(),
  isRead: boolean("isRead").default(false),
  createdBy: varchar("createdBy", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UserMessage = typeof userMessages.$inferSelect;
export type InsertUserMessage = typeof userMessages.$inferInsert;

// 用户活动日志表
export const userActivityLogs = mysqlTable("user_activity_logs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  action: varchar("action", { length: 50 }).notNull(), // login, logout, search, recharge, password_change, etc.
  details: json("details"),
  ipAddress: varchar("ipAddress", { length: 50 }),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UserActivityLog = typeof userActivityLogs.$inferSelect;
export type InsertUserActivityLog = typeof userActivityLogs.$inferInsert;

// API统计表 (按日汇总)
export const apiStats = mysqlTable("api_stats", {
  id: int("id").autoincrement().primaryKey(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  apiName: varchar("apiName", { length: 50 }).notNull(),
  callCount: int("callCount").default(0),
  successCount: int("successCount").default(0),
  errorCount: int("errorCount").default(0),
  totalCreditsUsed: int("totalCreditsUsed").default(0),
  avgResponseTime: int("avgResponseTime").default(0), // 毫秒
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ApiStat = typeof apiStats.$inferSelect;

// 系统错误日志表
export const errorLogs = mysqlTable("error_logs", {
  id: int("id").autoincrement().primaryKey(),
  level: mysqlEnum("level", ["error", "warn", "info"]).default("error").notNull(),
  source: varchar("source", { length: 100 }), // 错误来源：api, auth, payment, etc.
  message: text("message").notNull(),
  stack: text("stack"),
  userId: int("userId"),
  requestPath: varchar("requestPath", { length: 255 }),
  requestBody: json("requestBody"),
  resolved: boolean("resolved").default(false),
  resolvedBy: varchar("resolvedBy", { length: 50 }),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ErrorLog = typeof errorLogs.$inferSelect;

// 用户反馈表
export const userFeedbacks = mysqlTable("user_feedbacks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", ["question", "suggestion", "business", "custom_dev", "other"]).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content").notNull(),
  contactInfo: varchar("contactInfo", { length: 200 }), // 可选的联系方式（微信、电话等）
  status: mysqlEnum("status", ["pending", "processing", "resolved", "closed"]).default("pending").notNull(),
  adminReply: text("adminReply"),
  repliedBy: varchar("repliedBy", { length: 50 }),
  repliedAt: timestamp("repliedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserFeedback = typeof userFeedbacks.$inferSelect;
export type InsertUserFeedback = typeof userFeedbacks.$inferInsert;


// ==================== TruePeopleSearch 相关表 ====================

// TPS 配置表
export const tpsConfig = mysqlTable("tps_config", {
  id: int("id").autoincrement().primaryKey(),
  searchCost: decimal("searchCost", { precision: 10, scale: 2 }).default("0.3").notNull(), // 每搜索页消耗积分
  detailCost: decimal("detailCost", { precision: 10, scale: 2 }).default("0.3").notNull(), // 每详情页消耗积分
  maxConcurrent: int("maxConcurrent").default(40).notNull(), // 最大并发数
  cacheDays: int("cacheDays").default(30).notNull(), // 缓存天数
  scrapeDoToken: varchar("scrapeDoToken", { length: 100 }), // Scrape.do API Token
  maxPages: int("maxPages").default(25).notNull(), // 最大搜索页数
  batchDelay: int("batchDelay").default(200).notNull(), // 批次间延迟(ms)
  enabled: boolean("enabled").default(true).notNull(), // 是否启用
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TpsConfig = typeof tpsConfig.$inferSelect;
export type InsertTpsConfig = typeof tpsConfig.$inferInsert;

// TPS 详情页缓存表
export const tpsDetailCache = mysqlTable("tps_detail_cache", {
  id: int("id").autoincrement().primaryKey(),
  detailLink: varchar("detailLink", { length: 500 }).notNull().unique(),
  data: json("data").$type<{
    name: string;
    firstName: string;
    lastName: string;
    age: number;
    city: string;
    state: string;
    location: string;
    phone: string;
    phoneType: string;
    carrier: string;
    reportYear: number | null;
    isPrimary: boolean;
    propertyValue: number;
    yearBuilt: number | null;
    isDeceased: boolean;
  }>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
});

export type TpsDetailCache = typeof tpsDetailCache.$inferSelect;
export type InsertTpsDetailCache = typeof tpsDetailCache.$inferInsert;

// TPS 搜索任务表
export const tpsSearchTasks = mysqlTable("tps_search_tasks", {
  id: int("id").autoincrement().primaryKey(),
  taskId: varchar("taskId", { length: 32 }).notNull().unique(),
  userId: int("userId").notNull(),
  mode: mysqlEnum("mode", ["nameOnly", "nameLocation"]).default("nameOnly").notNull(),
  names: json("names").$type<string[]>().notNull(),
  locations: json("locations").$type<string[]>(),
  filters: json("filters").$type<{
    minAge?: number;
    maxAge?: number;
    minYear?: number;
    minPropertyValue?: number;
    excludeTMobile?: boolean;
    excludeComcast?: boolean;
    excludeLandline?: boolean;
  }>(),
  totalSubTasks: int("totalSubTasks").default(0).notNull(), // 总子任务数
  completedSubTasks: int("completedSubTasks").default(0).notNull(), // 已完成子任务数
  totalResults: int("totalResults").default(0).notNull(), // 总结果数
  searchPageRequests: int("searchPageRequests").default(0).notNull(), // 搜索页请求数
  detailPageRequests: int("detailPageRequests").default(0).notNull(), // 详情页请求数
  cacheHits: int("cacheHits").default(0).notNull(), // 缓存命中数
  creditsUsed: decimal("creditsUsed", { precision: 10, scale: 2 }).default("0").notNull(),
  status: mysqlEnum("status", ["pending", "running", "completed", "failed", "cancelled", "insufficient_credits"]).default("pending").notNull(),
  progress: int("progress").default(0).notNull(), // 进度百分比
  logs: json("logs").$type<Array<{ timestamp: string; message: string }>>(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
});

export type TpsSearchTask = typeof tpsSearchTasks.$inferSelect;
export type InsertTpsSearchTask = typeof tpsSearchTasks.$inferInsert;

// TPS 搜索结果表
export const tpsSearchResults = mysqlTable("tps_search_results", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  subTaskIndex: int("subTaskIndex").default(0).notNull(), // 子任务索引
  name: varchar("name", { length: 200 }),
  searchName: varchar("searchName", { length: 200 }), // 搜索的姓名
  searchLocation: varchar("searchLocation", { length: 200 }), // 搜索的地点
  age: int("age"),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 50 }),
  location: varchar("location", { length: 200 }),
  phone: varchar("phone", { length: 50 }),
  phoneType: varchar("phoneType", { length: 50 }),
  carrier: varchar("carrier", { length: 100 }),
  reportYear: int("reportYear"),
  isPrimary: boolean("isPrimary").default(false),
  propertyValue: int("propertyValue").default(0),
  yearBuilt: int("yearBuilt"),
  detailLink: varchar("detailLink", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TpsSearchResult = typeof tpsSearchResults.$inferSelect;
export type InsertTpsSearchResult = typeof tpsSearchResults.$inferInsert;
