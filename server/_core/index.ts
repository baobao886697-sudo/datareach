import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startUsdtMonitor } from "../services/usdtMonitor";
import { startOrderExpirationChecker } from "../services/orderExpiration";
import { getDbSync } from "../db";
import { sql } from "drizzle-orm";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function ensureTables() {
  try {
    console.log("[Database] Ensuring tables exist...");
    const db = getDbSync();
    if (!db) {
      console.log("[Database] No database connection, skipping table creation");
      return;
    }
    
    // 先尝试删除旧的不兼容表（如果存在列名不匹配的问题）
    try {
      // 检查announcements表是否存在且列名是否正确
      const checkResult = await db.execute(sql`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'announcements' AND COLUMN_NAME = 'isPinned'
      `);
      
      // 如果找不到isPinned列，说明表结构不对，需要重建
      if (!checkResult || (checkResult as any)[0]?.length === 0) {
        console.log("[Database] Dropping old announcements table with wrong column names...");
        await db.execute(sql`DROP TABLE IF EXISTS announcements`);
      }
    } catch (e) {
      // 忽略检查错误
    }
    
    // 创建公告表 - 使用与 drizzle/schema.ts 一致的列名
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS announcements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        content TEXT NOT NULL,
        type ENUM('info', 'warning', 'success', 'error') DEFAULT 'info' NOT NULL,
        isPinned BOOLEAN DEFAULT FALSE,
        isActive BOOLEAN DEFAULT TRUE,
        startTime TIMESTAMP NULL,
        endTime TIMESTAMP NULL,
        createdBy VARCHAR(50),
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
      )
    `);
    console.log("[Database] Announcements table ready");
    
    // 检查user_messages表
    try {
      const checkResult = await db.execute(sql`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'user_messages' AND COLUMN_NAME = 'userId'
      `);
      
      if (!checkResult || (checkResult as any)[0]?.length === 0) {
        console.log("[Database] Dropping old user_messages table with wrong column names...");
        await db.execute(sql`DROP TABLE IF EXISTS user_messages`);
      }
    } catch (e) {
      // 忽略检查错误
    }
    
    // 创建用户消息表 - 使用与 drizzle/schema.ts 一致的列名
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        title VARCHAR(200) NOT NULL,
        content TEXT NOT NULL,
        type ENUM('system', 'support', 'notification', 'promotion') DEFAULT 'system' NOT NULL,
        isRead BOOLEAN DEFAULT FALSE,
        createdBy VARCHAR(50),
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_userId (userId),
        INDEX idx_isRead (isRead)
      )
    `);
    console.log("[Database] User messages table ready");
    
    // 创建用户活动日志表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_activity_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        action VARCHAR(50) NOT NULL,
        details JSON,
        ipAddress VARCHAR(50),
        userAgent TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_userId (userId),
        INDEX idx_action (action),
        INDEX idx_createdAt (createdAt)
      )
    `);
    console.log("[Database] User activity logs table ready");
    
    // 创建API统计表 - 与schema.ts一致
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS api_stats (
        id INT AUTO_INCREMENT PRIMARY KEY,
        date VARCHAR(10) NOT NULL,
        apiName VARCHAR(50) NOT NULL,
        callCount INT DEFAULT 0,
        successCount INT DEFAULT 0,
        errorCount INT DEFAULT 0,
        totalCreditsUsed INT DEFAULT 0,
        avgResponseTime INT DEFAULT 0,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY unique_date_api (date, apiName)
      )
    `);
    console.log("[Database] API stats table ready");
    
    // 创建错误日志表 - 与schema.ts一致
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS error_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        level ENUM('error', 'warn', 'info') DEFAULT 'error' NOT NULL,
        source VARCHAR(100),
        message TEXT NOT NULL,
        stack TEXT,
        userId INT,
        requestPath VARCHAR(255),
        requestBody JSON,
        resolved BOOLEAN DEFAULT FALSE,
        resolvedBy VARCHAR(50),
        resolvedAt TIMESTAMP NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_level (level),
        INDEX idx_source (source),
        INDEX idx_resolved (resolved),
        INDEX idx_createdAt (createdAt)
      )
    `);
    console.log("[Database] Error logs table ready");
    
    console.log("[Database] All tables ensured successfully");
  } catch (error) {
    console.error("[Database] Table creation error:", error);
    // 不阻止服务器启动
  }
}

async function startServer() {
  // 确保数据库表存在
  await ensureTables();
  
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
  server.listen(port, host, () => {
    console.log(`Server running on http://${host}:${port}/`);
    
    // 启动后台服务
    if (process.env.NODE_ENV === 'production') {
      // 启动USDT自动检测服务（每30秒检查一次）
      startUsdtMonitor(30000);
      console.log("[Background] USDT monitor started");
      
      // 启动订单过期检查服务（每5分钟检查一次）
      startOrderExpirationChecker(5 * 60 * 1000);
      console.log("[Background] Order expiration checker started");
    }
  });
}

startServer().catch(console.error);
