import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, decimal, boolean } from "drizzle-orm/mysql-core";

/**
 * DataReach - 完整数据库Schema (V6蓝图)
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
  // 代理系统字段
  inviterId: int("inviterId"),                          // 邀请人ID
  inviteCode: varchar("inviteCode", { length: 20 }).unique(), // 邀请码
  isAgent: boolean("isAgent").default(false),           // 是否是代理
  agentLevel: mysqlEnum("agentLevel", ["normal", "silver", "gold", "founder"]).default("normal"), // 代理等级
  agentBalance: decimal("agentBalance", { precision: 10, scale: 2 }).default("0"), // 代理可提现余额(USDT)
  agentFrozenBalance: decimal("agentFrozenBalance", { precision: 10, scale: 2 }).default("0"), // 冻结中佣金(USDT)
  agentTotalEarned: decimal("agentTotalEarned", { precision: 12, scale: 2 }).default("0"), // 累计收益(USDT)
  agentAppliedAt: timestamp("agentAppliedAt"),          // 申请成为代理时间
  agentApprovedAt: timestamp("agentApprovedAt"),        // 审核通过时间
  agentWalletAddress: varchar("agentWalletAddress", { length: 100 }), // 代理收款地址
  // 时间戳
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
  cacheDays: int("cacheDays").default(180).notNull(), // 缓存天数
  scrapeDoToken: varchar("scrapeDoToken", { length: 100 }), // Scrape.do API Token
  maxPages: int("maxPages").default(25).notNull(), // 最大搜索页数
  batchDelay: int("batchDelay").default(200).notNull(), // 批次间延迟(ms)
  enabled: boolean("enabled").default(true).notNull(), // 是否启用
  defaultMinAge: int("defaultMinAge").default(50).notNull(), // 默认最小年龄
  defaultMaxAge: int("defaultMaxAge").default(79).notNull(), // 默认最大年龄
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
  company: varchar("company", { length: 200 }),     // 公司
  jobTitle: varchar("jobTitle", { length: 200 }),   // 职位
  detailLink: varchar("detailLink", { length: 500 }),
  fromCache: boolean("fromCache").default(false).notNull(), // 是否来自缓存
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TpsSearchResult = typeof tpsSearchResults.$inferSelect;
export type InsertTpsSearchResult = typeof tpsSearchResults.$inferInsert;


// ==================== Anywho 模块 ====================

// Anywho 配置表
export const anywhoConfig = mysqlTable("anywho_config", {
  id: int("id").autoincrement().primaryKey(),
  searchCost: decimal("searchCost", { precision: 10, scale: 2 }).default("0.5").notNull(), // 每搜索页消耗积分
  detailCost: decimal("detailCost", { precision: 10, scale: 2 }).default("0.5").notNull(), // 每详情页消耗积分
  maxConcurrent: int("maxConcurrent").default(20).notNull(), // 最大并发数
  cacheDays: int("cacheDays").default(180).notNull(), // 缓存天数
  scrapeDoToken: varchar("scrapeDoToken", { length: 100 }), // Scrape.do API Token
  maxPages: int("maxPages").default(10).notNull(), // 最大搜索页数
  batchDelay: int("batchDelay").default(300).notNull(), // 批次间延迟(ms)
  enabled: boolean("enabled").default(true).notNull(), // 是否启用
  defaultMinAge: int("defaultMinAge").default(50).notNull(), // 默认最小年龄
  defaultMaxAge: int("defaultMaxAge").default(79).notNull(), // 默认最大年龄
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AnywhoConfig = typeof anywhoConfig.$inferSelect;
export type InsertAnywhoConfig = typeof anywhoConfig.$inferInsert;

// Anywho 详情页缓存表
export const anywhoDetailCache = mysqlTable("anywho_detail_cache", {
  id: int("id").autoincrement().primaryKey(),
  detailLink: varchar("detailLink", { length: 500 }).notNull().unique(),
  data: json("data").$type<{
    name: string;
    firstName: string;
    lastName: string;
    age: number | null;
    city: string;
    state: string;
    location: string;
    currentAddress: string;
    phone: string;                  // 主号码（最新）
    allPhones: string[];            // 所有电话号码
    phoneType: string;
    carrier: string;
    reportYear: number | null;
    isPrimary: boolean;
    marriageStatus: string | null;  // Single/Married/Divorced/Widowed
    marriageRecords: string[];      // 婚姻记录列表
    familyMembers: string[];        // 家庭成员
    emails: string[];               // 邮箱列表
    isDeceased: boolean;            // 是否已故
  }>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
});

export type AnywhoDetailCache = typeof anywhoDetailCache.$inferSelect;
export type InsertAnywhoDetailCache = typeof anywhoDetailCache.$inferInsert;

// Anywho 搜索任务表
export const anywhoSearchTasks = mysqlTable("anywho_search_tasks", {
  id: int("id").autoincrement().primaryKey(),
  taskId: varchar("taskId", { length: 32 }).notNull().unique(),
  userId: int("userId").notNull(),
  mode: mysqlEnum("mode", ["nameOnly", "nameLocation"]).default("nameOnly").notNull(),
  names: json("names").$type<string[]>().notNull(),
  locations: json("locations").$type<string[]>(),
  filters: json("filters").$type<{
    minAge?: number;
    maxAge?: number;
    excludeDeceased?: boolean;        // 排除已故人员
    includeMarriageStatus?: boolean;
    includeFamilyMembers?: boolean;
    includeEmails?: boolean;
  }>(),
  totalSubTasks: int("totalSubTasks").default(0).notNull(),
  completedSubTasks: int("completedSubTasks").default(0).notNull(),
  totalResults: int("totalResults").default(0).notNull(),
  searchPageRequests: int("searchPageRequests").default(0).notNull(),
  detailPageRequests: int("detailPageRequests").default(0).notNull(),
  cacheHits: int("cacheHits").default(0).notNull(),
  creditsUsed: decimal("creditsUsed", { precision: 10, scale: 2 }).default("0").notNull(),
  status: mysqlEnum("status", ["pending", "running", "completed", "failed", "cancelled", "insufficient_credits"]).default("pending").notNull(),
  progress: int("progress").default(0).notNull(),
  logs: json("logs").$type<Array<{ timestamp: string; message: string }>>(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
});

export type AnywhoSearchTask = typeof anywhoSearchTasks.$inferSelect;
export type InsertAnywhoSearchTask = typeof anywhoSearchTasks.$inferInsert;

// Anywho 搜索结果表
export const anywhoSearchResults = mysqlTable("anywho_search_results", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  subTaskIndex: int("subTaskIndex").default(0).notNull(),
  name: varchar("name", { length: 200 }),
  firstName: varchar("firstName", { length: 100 }),
  lastName: varchar("lastName", { length: 100 }),
  searchName: varchar("searchName", { length: 200 }),
  searchLocation: varchar("searchLocation", { length: 200 }),
  age: int("age"),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 50 }),
  location: varchar("location", { length: 200 }),
  currentAddress: varchar("currentAddress", { length: 500 }),
  // 电话信息
  phone: varchar("phone", { length: 50 }),           // 主号码（最新）
  phoneType: varchar("phoneType", { length: 50 }),   // Mobile/Landline/VoIP
  carrier: varchar("carrier", { length: 100 }),      // 运营商
  allPhones: json("allPhones").$type<string[]>(),    // 所有电话号码
  reportYear: int("reportYear"),
  isPrimary: boolean("isPrimary").default(true),     // 是否为主号码
  // 婚姻信息
  marriageStatus: varchar("marriageStatus", { length: 50 }),  // Single/Married/Divorced/Widowed
  marriageRecords: json("marriageRecords").$type<string[]>(), // 婚姻记录列表
  // 其他信息
  familyMembers: json("familyMembers").$type<string[]>(),     // 家庭成员
  emails: json("emails").$type<string[]>(),                   // 邮箱列表
  isDeceased: boolean("isDeceased").default(false),           // 是否已故
  // 链接和缓存
  detailLink: varchar("detailLink", { length: 500 }),
  fromCache: boolean("fromCache").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AnywhoSearchResult = typeof anywhoSearchResults.$inferSelect;
export type InsertAnywhoSearchResult = typeof anywhoSearchResults.$inferInsert;


// ==================== 代理系统模块 ====================

// 代理佣金记录表
export const agentCommissions = mysqlTable("agent_commissions", {
  id: int("id").autoincrement().primaryKey(),
  agentId: int("agentId").notNull(),                    // 代理ID
  fromUserId: int("fromUserId").notNull(),              // 来源用户ID
  orderId: varchar("orderId", { length: 32 }).notNull(), // 关联充值订单
  orderAmount: decimal("orderAmount", { precision: 10, scale: 2 }).notNull(), // 订单金额(USDT)
  commissionLevel: mysqlEnum("commissionLevel", ["level1", "level2"]).notNull(), // 一级/二级
  commissionRate: decimal("commissionRate", { precision: 5, scale: 2 }).notNull(), // 佣金比例
  commissionAmount: decimal("commissionAmount", { precision: 10, scale: 2 }).notNull(), // 佣金金额(USDT)
  bonusType: varchar("bonusType", { length: 20 }),      // 额外奖励类型: first_charge, activity
  bonusAmount: decimal("bonusAmount", { precision: 10, scale: 2 }).default("0"), // 额外奖励金额
  status: mysqlEnum("status", ["pending", "settled", "withdrawn"]).default("pending").notNull(),
  settledAt: timestamp("settledAt"),                    // 结算时间
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AgentCommission = typeof agentCommissions.$inferSelect;
export type InsertAgentCommission = typeof agentCommissions.$inferInsert;

// 代理提现申请表
export const agentWithdrawals = mysqlTable("agent_withdrawals", {
  id: int("id").autoincrement().primaryKey(),
  withdrawalId: varchar("withdrawalId", { length: 32 }).notNull().unique(),
  agentId: int("agentId").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(), // 提现金额(USDT)
  walletAddress: varchar("walletAddress", { length: 100 }).notNull(), // 提现地址
  network: varchar("network", { length: 20 }).default("TRC20").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "paid"]).default("pending").notNull(),
  adminNote: text("adminNote"),
  txId: varchar("txId", { length: 100 }),               // 打款交易ID
  processedBy: varchar("processedBy", { length: 50 }),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AgentWithdrawal = typeof agentWithdrawals.$inferSelect;
export type InsertAgentWithdrawal = typeof agentWithdrawals.$inferInsert;

// 代理统计表 (按月汇总)
export const agentStats = mysqlTable("agent_stats", {
  id: int("id").autoincrement().primaryKey(),
  agentId: int("agentId").notNull(),
  month: varchar("month", { length: 7 }).notNull(),     // YYYY-MM
  totalUsers: int("totalUsers").default(0).notNull(),   // 本月新增用户
  totalRecharge: decimal("totalRecharge", { precision: 12, scale: 2 }).default("0").notNull(), // 本月团队充值
  level1Commission: decimal("level1Commission", { precision: 10, scale: 2 }).default("0").notNull(), // 一级佣金
  level2Commission: decimal("level2Commission", { precision: 10, scale: 2 }).default("0").notNull(), // 二级佣金
  bonusCommission: decimal("bonusCommission", { precision: 10, scale: 2 }).default("0").notNull(),  // 额外奖励
  totalCommission: decimal("totalCommission", { precision: 10, scale: 2 }).default("0").notNull(),  // 总佣金
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AgentStat = typeof agentStats.$inferSelect;
export type InsertAgentStat = typeof agentStats.$inferInsert;

// 代理配置表
export const agentSettings = mysqlTable("agent_settings", {
  id: int("id").autoincrement().primaryKey(),
  settingKey: varchar("settingKey", { length: 50 }).notNull().unique(),
  settingValue: text("settingValue").notNull(),
  description: text("description"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AgentSetting = typeof agentSettings.$inferSelect;
export type InsertAgentSetting = typeof agentSettings.$inferInsert;


// 代理申请表
export const agentApplications = mysqlTable("agent_applications", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 20 }).notNull(),
  wechat: varchar("wechat", { length: 50 }),
  company: varchar("company", { length: 100 }),
  experience: text("experience"),
  channels: text("channels"),
  expectedUsers: varchar("expectedUsers", { length: 50 }),
  walletAddress: varchar("walletAddress", { length: 100 }),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  adminNote: text("adminNote"),
  processedBy: varchar("processedBy", { length: 50 }),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AgentApplication = typeof agentApplications.$inferSelect;
export type InsertAgentApplication = typeof agentApplications.$inferInsert;


// ==================== SearchPeopleFree (SPF) 模块 ====================

// SPF 配置表
export const spfConfig = mysqlTable("spf_config", {
  id: int("id").autoincrement().primaryKey(),
  searchCost: decimal("searchCost", { precision: 10, scale: 2 }).default("0.85").notNull(), // 每搜索页消耗积分 (0.85 积分/次 API 调用)
  detailCost: decimal("detailCost", { precision: 10, scale: 2 }).default("0.85").notNull(), // 每详情页消耗积分 (0.85 积分/次 API 调用)
  maxConcurrent: int("maxConcurrent").default(40).notNull(), // 最大并发数
  cacheDays: int("cacheDays").default(180).notNull(), // 缓存天数
  scrapeDoToken: varchar("scrapeDoToken", { length: 100 }), // Scrape.do API Token
  maxPages: int("maxPages").default(25).notNull(), // 最大搜索页数
  batchDelay: int("batchDelay").default(200).notNull(), // 批次间延迟(ms)
  enabled: boolean("enabled").default(true).notNull(), // 是否启用
  defaultMinAge: int("defaultMinAge").default(50).notNull(), // 默认最小年龄
  defaultMaxAge: int("defaultMaxAge").default(79).notNull(), // 默认最大年龄
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SpfConfig = typeof spfConfig.$inferSelect;
export type InsertSpfConfig = typeof spfConfig.$inferInsert;

// SPF 详情页缓存表
export const spfDetailCache = mysqlTable("spf_detail_cache", {
  id: int("id").autoincrement().primaryKey(),
  detailLink: varchar("detailLink", { length: 500 }).notNull().unique(),
  data: json("data").$type<{
    name: string;
    firstName: string;
    lastName: string;
    age: number;
    birthYear: string;          // 出生年份范围 "1976 or 1975"
    city: string;
    state: string;
    location: string;
    phone: string;
    phoneType: string;          // "Home/LandLine" / "Wireless"
    carrier: string;
    reportYear: number | null;
    isPrimary: boolean;
    // SPF 独特字段
    email: string;              // 电子邮件
    maritalStatus: string;      // 婚姻状态
    spouseName: string;         // 配偶姓名
    spouseLink: string;         // 配偶链接
    employment: string;         // 就业状态
    confirmedDate: string;      // 数据确认日期
    latitude: number | null;    // 纬度
    longitude: number | null;   // 经度
    propertyValue: number;
    yearBuilt: number | null;
    isDeceased: boolean;
  }>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
});

export type SpfDetailCache = typeof spfDetailCache.$inferSelect;
export type InsertSpfDetailCache = typeof spfDetailCache.$inferInsert;

// SPF 搜索任务表
export const spfSearchTasks = mysqlTable("spf_search_tasks", {
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
    excludeWireless?: boolean;  // SPF 独特：可排除手机
  }>(),
  totalSubTasks: int("totalSubTasks").default(0).notNull(),
  completedSubTasks: int("completedSubTasks").default(0).notNull(),
  totalResults: int("totalResults").default(0).notNull(),
  searchPageRequests: int("searchPageRequests").default(0).notNull(),
  detailPageRequests: int("detailPageRequests").default(0).notNull(),
  cacheHits: int("cacheHits").default(0).notNull(),
  creditsUsed: decimal("creditsUsed", { precision: 10, scale: 2 }).default("0").notNull(),
  status: mysqlEnum("status", ["pending", "running", "completed", "failed", "cancelled", "insufficient_credits"]).default("pending").notNull(),
  progress: int("progress").default(0).notNull(),
  logs: json("logs").$type<Array<{ timestamp: string; message: string }>>(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
});

export type SpfSearchTask = typeof spfSearchTasks.$inferSelect;
export type InsertSpfSearchTask = typeof spfSearchTasks.$inferInsert;

// SPF 搜索结果表（包含独特字段）
export const spfSearchResults = mysqlTable("spf_search_results", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  subTaskIndex: int("subTaskIndex").default(0).notNull(),
  
  // 基础字段
  name: varchar("name", { length: 200 }),
  firstName: varchar("firstName", { length: 100 }),
  lastName: varchar("lastName", { length: 100 }),
  searchName: varchar("searchName", { length: 200 }),
  searchLocation: varchar("searchLocation", { length: 200 }),
  age: int("age"),
  birthYear: varchar("birthYear", { length: 20 }),        // ★ 出生年份 "1976 or 1975"
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 50 }),
  location: varchar("location", { length: 200 }),
  
  // 电话信息
  phone: varchar("phone", { length: 50 }),
  phoneType: varchar("phoneType", { length: 50 }),        // ★ "Home/LandLine" / "Wireless"
  phoneYear: int("phoneYear"),                             // ★ 主电话的年份
  carrier: varchar("carrier", { length: 100 }),
  allPhones: json("allPhones").$type<Array<{
    number: string;
    type: string;
    year?: number;
    date?: string;
  }>>(),                                                   // 所有电话及类型（包含年份）
  reportYear: int("reportYear"),
  isPrimary: boolean("isPrimary").default(true),
  
  // ★ SPF 独特字段
  email: varchar("email", { length: 200 }),               // ★ 电子邮件
  allEmails: json("allEmails").$type<string[]>(),         // 所有邮箱
  maritalStatus: varchar("maritalStatus", { length: 50 }), // ★ 婚姻状态
  spouseName: varchar("spouseName", { length: 200 }),     // ★ 配偶姓名
  spouseLink: varchar("spouseLink", { length: 500 }),     // ★ 配偶链接
  employment: varchar("employment", { length: 200 }),     // ★ 就业状态
  confirmedDate: varchar("confirmedDate", { length: 50 }), // ★ 数据确认日期
  latitude: decimal("latitude", { precision: 10, scale: 6 }), // ★ 纬度
  longitude: decimal("longitude", { precision: 10, scale: 6 }), // ★ 经度
  
  // 其他信息
  familyMembers: json("familyMembers").$type<string[]>(),
  associates: json("associates").$type<string[]>(),
  businesses: json("businesses").$type<string[]>(),       // ★ 关联企业
  propertyValue: int("propertyValue").default(0),
  yearBuilt: int("yearBuilt"),
  isDeceased: boolean("isDeceased").default(false),
  
  // 链接和缓存
  detailLink: varchar("detailLink", { length: 500 }),
  fromCache: boolean("fromCache").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SpfSearchResult = typeof spfSearchResults.$inferSelect;
export type InsertSpfSearchResult = typeof spfSearchResults.$inferInsert;
