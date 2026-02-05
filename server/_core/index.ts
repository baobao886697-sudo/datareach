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
// Apollo Webhook 已移除，使用 Apify 同步获取数据
import { startOrderExpirationChecker } from "../services/orderExpiration";
import { startCommissionSettlement } from "../services/commissionSettlement";
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

async function migrateOldData(db: any) {
  try {
    console.log("[Migration] Checking if data migration is needed...");
    
    // 检查是否已经有用户数据
    const existingUsers = await db.execute(sql`SELECT COUNT(*) as count FROM users`);
    const userCount = existingUsers[0]?.[0]?.count || 0;
    
    console.log(`[Migration] Found ${userCount} existing users, will merge old data...`);
    
    // 导入用户数据
    const usersToInsert = [
      { id: 1, openId: '302d47dc9d672c0a9bbda29688001a6a', email: 'baobao88667@gmail.com', passwordHash: '$2b$12$kUgoE43EAZfrAirMxsj/1ukUg5CN860OtYxoPhPi5iUoS4BTwD0Ae', credits: 0, status: 'active', role: 'user', currentDeviceId: 'device_1768742762459_sgmo9j77yle' },
      { id: 2, openId: '2353b03db22e8027bdc1cd7a0b2d32a7', email: 'test123@example.com', passwordHash: '$2b$12$WwBAQ6xfrZenM1lpqEqn6OEKGohGPymaiMHZhdfta7C.4VmsHtfLG', credits: 100, status: 'active', role: 'user', currentDeviceId: 'device_1768726018372_x682tj4c7lm' },
      { id: 3, openId: 'dae6dcd22c5e67825ad953a7a2b11fab', email: 'newtest@example.com', passwordHash: '$2b$12$yzvwBFcD1L/CkIpws8iq7ucGl2nkWYFo9dupJb9Lo7v3BzuZqzFYe', credits: 100, status: 'active', role: 'user', currentDeviceId: 'device_1768726018372_x682tj4c7lm' },
      { id: 4, openId: 'bb65cfbee361871973fb1ce40548fec8', email: 'testuser123@example.com', passwordHash: '$2b$12$Wd2xPQGYbfroIfKFejYaT.Q26Tn9VxlaAuiq1Rh5Jik0XFGn2gtuu', credits: 100, status: 'active', role: 'user', currentDeviceId: 'test_device_123' },
      { id: 5, openId: 'b0b4f44854aa1c838adf5da15fe60929', email: 'finaltest2@example.com', passwordHash: '$2b$12$7HMgVQegQ5/H4wCCYwt93O520Ih7UqyaCCKxA9nXrwZbdL6kACUU6', credits: 100, status: 'active', role: 'user', currentDeviceId: 'test_device_123' },
      { id: 6, openId: '001bce3925f3c0609dc568694b0fd6c7', email: 'browsertest@example.com', passwordHash: '$2b$10$AQ3OgQDQ/l0k6oAF8u3AZ.X9IIjeoEca1W341xt7qkOUjQPLFT7yi', credits: 43, status: 'active', role: 'user', currentDeviceId: 'device_1768792449488_wu50zrzm4y' },
      { id: 7, openId: '22e421735d5a7450f04ad1a5059ab1d0', email: 'marialee0660@gmail.com', passwordHash: '$2b$12$ek0DKGNp6kprhimWxvmkUOGha2ogLaBy5Psl9Lk03TstPrINBnfP.', credits: 108, status: 'active', role: 'user', currentDeviceId: 'device_1768749633464_7xv9pourh7h' }
    ];
    
    for (const user of usersToInsert) {
      await db.execute(sql`
        INSERT IGNORE INTO users (id, openId, email, passwordHash, credits, status, role, currentDeviceId)
        VALUES (${user.id}, ${user.openId}, ${user.email}, ${user.passwordHash}, ${user.credits}, ${user.status}, ${user.role}, ${user.currentDeviceId})
      `);
    }
    console.log(`[Migration] Imported ${usersToInsert.length} users`);
    
    // 更新系统配置 - 只插入不存在的配置，不覆盖已有值
    // 注意：敏感配置（如 API Key）应该只通过环境变量设置，不在数据库中存储
    const configsToInsert = [
      { key: 'USDT_WALLET_TRC20', value: 'TEtRGZvdPqvUDhopMi1MEGCEiD9Ehdh1iZ', description: 'TRC20 USDT收款地址' },
      { key: 'USDT_WALLET_ERC20', value: '', description: 'ERC20 USDT收款地址' },
      { key: 'USDT_WALLET_BEP20', value: '', description: 'BEP20 USDT收款地址' },
      { key: 'MIN_RECHARGE_CREDITS', value: '100', description: '最低充值积分数' },
      { key: 'CREDITS_PER_USDT', value: '100', description: '1 USDT兑换积分数' },
      { key: 'ORDER_EXPIRE_MINUTES', value: '30', description: '订单过期时间(分钟)' },
      { key: 'CACHE_TTL_DAYS', value: '180', description: '缓存有效期(天)' },
      { key: 'SEARCH_CREDITS_PER_PERSON', value: '2', description: '每条搜索结果消耗积分' },
      { key: 'PREVIEW_CREDITS', value: '1', description: '预览搜索消耗积分' }
      // 注意：APOLLO_API_KEY 不再在这里设置，完全依赖环境变量
      // 这样可以避免每次启动时覆盖数据库中的值
    ];
    
    for (const config of configsToInsert) {
      // 使用 INSERT IGNORE 只在配置不存在时插入，不覆盖已有值
      await db.execute(sql`
        INSERT IGNORE INTO system_configs (\`key\`, value, description, updatedBy)
        VALUES (${config.key}, ${config.value}, ${config.description}, '88888888')
      `);
    }
    console.log(`[Migration] Checked ${configsToInsert.length} system configs (only inserted missing ones)`);
    
    console.log("[Migration] Data migration completed successfully!");
  } catch (error) {
    console.error("[Migration] Error during data migration:", error);
  }
}

async function ensureTables() {
  try {
    console.log("[Database] Ensuring all tables exist...");
    const db = getDbSync();
    if (!db) {
      console.log("[Database] No database connection, skipping table creation");
      return;
    }
    
    // ========== 核心业务表 ==========
    
    // 1. 用户表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        openId VARCHAR(64) NOT NULL,
        email VARCHAR(320) NOT NULL,
        passwordHash VARCHAR(255) NOT NULL,
        name TEXT,
        credits INT NOT NULL DEFAULT 0,
        status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
        role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
        emailVerified BOOLEAN DEFAULT FALSE,
        resetToken VARCHAR(100),
        resetTokenExpires TIMESTAMP NULL,
        currentDeviceId VARCHAR(100),
        currentDeviceLoginAt TIMESTAMP NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        lastSignedIn TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY users_openId_unique (openId),
        UNIQUE KEY users_email_unique (email)
      )
    `);
    console.log("[Database] Users table ready");
    
    // 2. 系统配置表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS system_configs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        \`key\` VARCHAR(100) NOT NULL,
        value TEXT NOT NULL,
        description TEXT,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        updatedBy VARCHAR(50),
        UNIQUE KEY system_configs_key_unique (\`key\`)
      )
    `);
    console.log("[Database] System configs table ready");
    
    // 3. 充值订单表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS recharge_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        orderId VARCHAR(32) NOT NULL,
        userId INT NOT NULL,
        credits INT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        walletAddress VARCHAR(100) NOT NULL,
        network VARCHAR(20) NOT NULL DEFAULT 'TRC20',
        status ENUM('pending', 'paid', 'cancelled', 'expired', 'mismatch') NOT NULL DEFAULT 'pending',
        txId VARCHAR(100),
        receivedAmount DECIMAL(10,2),
        adminNote TEXT,
        expiresAt TIMESTAMP NOT NULL,
        paidAt TIMESTAMP NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY recharge_orders_orderId_unique (orderId),
        INDEX idx_userId (userId),
        INDEX idx_status (status)
      )
    `);
    console.log("[Database] Recharge orders table ready");
    
    // 4. 搜索任务表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS search_tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        taskId VARCHAR(32) NOT NULL,
        userId INT NOT NULL,
        searchHash VARCHAR(32) NOT NULL,
        params JSON NOT NULL,
        requestedCount INT NOT NULL,
        actualCount INT DEFAULT 0,
        creditsUsed INT DEFAULT 0,
        status ENUM('pending', 'running', 'completed', 'failed', 'stopped', 'insufficient_credits') NOT NULL DEFAULT 'pending',
        progress INT DEFAULT 0,
        logs JSON,
        errorMessage TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        completedAt TIMESTAMP NULL,
        UNIQUE KEY search_tasks_taskId_unique (taskId),
        INDEX idx_userId (userId),
        INDEX idx_status (status)
      )
    `);
    console.log("[Database] Search tasks table ready");
    
    // 5. 搜索结果表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS search_results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        taskId INT NOT NULL,
        apolloId VARCHAR(64) NOT NULL,
        data JSON NOT NULL,
        verified BOOLEAN DEFAULT FALSE,
        verificationScore INT,
        verificationDetails JSON,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_taskId (taskId),
        INDEX idx_apolloId (apolloId)
      )
    `);
    console.log("[Database] Search results table ready");
    
    // 6. 全局缓存表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS global_cache (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cacheKey VARCHAR(100) NOT NULL,
        cacheType ENUM('search', 'person', 'verification') NOT NULL,
        data JSON NOT NULL,
        hitCount INT DEFAULT 0,
        expiresAt TIMESTAMP NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY global_cache_cacheKey_unique (cacheKey)
      )
    `);
    console.log("[Database] Global cache table ready");
    
    // 7. 积分变动记录表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS credit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        amount INT NOT NULL,
        balanceAfter INT NOT NULL,
        type ENUM('recharge', 'search', 'admin_add', 'admin_deduct', 'refund', 'admin_adjust', 'bonus') NOT NULL,
        description TEXT,
        relatedOrderId VARCHAR(32),
        relatedTaskId VARCHAR(32),
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_userId (userId),
        INDEX idx_type (type)
      )
    `);
    console.log("[Database] Credit logs table ready");
    
    // 8. 搜索日志表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS search_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        searchHash VARCHAR(32),
        params JSON,
        requestedCount INT,
        actualCount INT,
        creditsUsed INT,
        cacheHit BOOLEAN DEFAULT FALSE,
        status VARCHAR(20),
        errorMessage TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_userId (userId)
      )
    `);
    console.log("[Database] Search logs table ready");
    
    // 9. 管理员操作日志表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS admin_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        adminUsername VARCHAR(50) NOT NULL,
        action VARCHAR(50) NOT NULL,
        targetType VARCHAR(50),
        targetId VARCHAR(50),
        details JSON,
        ipAddress VARCHAR(50),
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_adminUsername (adminUsername),
        INDEX idx_action (action)
      )
    `);
    console.log("[Database] Admin logs table ready");
    
    // 10. 登录日志表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS login_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        deviceId VARCHAR(100),
        ipAddress VARCHAR(50),
        userAgent TEXT,
        success BOOLEAN DEFAULT TRUE,
        failReason TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_userId (userId)
      )
    `);
    console.log("[Database] Login logs table ready");
    
    // 11. API调用日志表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS api_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT,
        apiType ENUM('apollo_search', 'apollo_enrich', 'apify_search', 'scrape_tps', 'scrape_fps') NOT NULL,
        endpoint VARCHAR(255),
        requestParams JSON,
        responseStatus INT,
        responseTime INT,
        success BOOLEAN DEFAULT TRUE,
        errorMessage TEXT,
        creditsUsed INT DEFAULT 0,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_userId (userId),
        INDEX idx_apiType (apiType)
      )
    `);
    console.log("[Database] API logs table ready");
    
    // ========== 辅助表 ==========
    
    // 12. 公告表
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
    
    // 13. 用户消息表
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
    
    // 14. 用户活动日志表
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
    
    // 15. API统计表
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
    
    // 16. 错误日志表
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
    
    // 17. 用户反馈表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_feedbacks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        type ENUM('question', 'suggestion', 'business', 'custom_dev', 'other') NOT NULL,
        title VARCHAR(200) NOT NULL,
        content TEXT NOT NULL,
        contactInfo VARCHAR(200) DEFAULT NULL,
        status ENUM('pending', 'processing', 'resolved', 'closed') NOT NULL DEFAULT 'pending',
        adminReply TEXT,
        repliedBy VARCHAR(50),
        repliedAt TIMESTAMP NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_userId (userId),
        INDEX idx_status (status)
      )
    `);
    console.log("[Database] User feedbacks table ready");
    
    // 18. TPS 配置表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tps_config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        searchCost DECIMAL(10,2) NOT NULL DEFAULT 0.3,
        detailCost DECIMAL(10,2) NOT NULL DEFAULT 0.3,
        maxConcurrent INT NOT NULL DEFAULT 40,
        cacheDays INT NOT NULL DEFAULT 30,
        scrapeDoToken VARCHAR(255),
        maxPages INT NOT NULL DEFAULT 25,
        batchDelay INT NOT NULL DEFAULT 200,
        enabled BOOLEAN DEFAULT TRUE,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
      )
    `);
    console.log("[Database] TPS config table ready");
    
    // 添加 TPS 配置表的新字段（如果不存在）
    try {
      await db.execute(sql`ALTER TABLE tps_config ADD COLUMN defaultMinAge INT NOT NULL DEFAULT 50`);
      console.log("[Database] TPS config defaultMinAge column added");
    } catch (e) {
      console.log("[Database] TPS config defaultMinAge column already exists or error:", (e as Error).message);
    }
    
    try {
      await db.execute(sql`ALTER TABLE tps_config ADD COLUMN defaultMaxAge INT NOT NULL DEFAULT 79`);
      console.log("[Database] TPS config defaultMaxAge column added");
    } catch (e) {
      console.log("[Database] TPS config defaultMaxAge column already exists or error:", (e as Error).message);
    }
    
    // 19. TPS 详情页缓存表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tps_detail_cache (
        id INT AUTO_INCREMENT PRIMARY KEY,
        detailLink VARCHAR(500) NOT NULL UNIQUE,
        data JSON,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        expiresAt TIMESTAMP NULL,
        INDEX idx_expiresAt (expiresAt)
      )
    `);
    console.log("[Database] TPS detail cache table ready");
    
    // 20. TPS 搜索任务表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tps_search_tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        taskId VARCHAR(32) NOT NULL UNIQUE,
        userId INT NOT NULL,
        mode ENUM('nameOnly', 'nameLocation') NOT NULL DEFAULT 'nameOnly',
        names JSON NOT NULL,
        locations JSON,
        filters JSON,
        totalSubTasks INT NOT NULL DEFAULT 0,
        completedSubTasks INT NOT NULL DEFAULT 0,
        totalResults INT NOT NULL DEFAULT 0,
        searchPageRequests INT NOT NULL DEFAULT 0,
        detailPageRequests INT NOT NULL DEFAULT 0,
        cacheHits INT NOT NULL DEFAULT 0,
        creditsUsed DECIMAL(10,2) NOT NULL DEFAULT 0,
        status ENUM('pending', 'running', 'completed', 'failed', 'cancelled', 'insufficient_credits') NOT NULL DEFAULT 'pending',
        progress INT NOT NULL DEFAULT 0,
        logs JSON,
        errorMessage TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        startedAt TIMESTAMP NULL,
        completedAt TIMESTAMP NULL,
        INDEX idx_userId (userId),
        INDEX idx_status (status)
      )
    `);
    console.log("[Database] TPS search tasks table ready");
    
    // 添加缺失的字段（如果表已存在）- MySQL 兼容语法
    const columnsToAdd = [
      { name: 'searchPageRequests', definition: 'INT NOT NULL DEFAULT 0' },
      { name: 'detailPageRequests', definition: 'INT NOT NULL DEFAULT 0' },
      { name: 'cacheHits', definition: 'INT NOT NULL DEFAULT 0' },
      { name: 'logs', definition: 'JSON' },
      { name: 'startedAt', definition: 'TIMESTAMP NULL' },
    ];
    
    for (const col of columnsToAdd) {
      try {
        await db.execute(sql.raw(`ALTER TABLE tps_search_tasks ADD COLUMN ${col.name} ${col.definition}`));
        console.log(`[Database] Added column ${col.name} to tps_search_tasks`);
      } catch (e: any) {
        // 忽略字段已存在的错误 (MySQL error code 1060: Duplicate column name)
        if (!e.message?.includes('Duplicate column')) {
          console.warn(`[Database] Failed to add column ${col.name}:`, e.message);
        }
      }
    }
    console.log("[Database] TPS search tasks columns sync completed");
    
    // 21. TPS 搜索结果表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tps_search_results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        taskId INT NOT NULL,
        subTaskIndex INT NOT NULL DEFAULT 0,
        name VARCHAR(200),
        searchName VARCHAR(200),
        searchLocation VARCHAR(200),
        age INT,
        city VARCHAR(100),
        state VARCHAR(50),
        location VARCHAR(200),
        phone VARCHAR(50),
        phoneType VARCHAR(50),
        carrier VARCHAR(100),
        reportYear INT,
        isPrimary BOOLEAN DEFAULT FALSE,
        propertyValue INT DEFAULT 0,
        yearBuilt INT,
        detailLink VARCHAR(500),
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_taskId (taskId)
      )
    `);
    console.log("[Database] TPS search results table ready");
    
    // 添加缺失的字段到 tps_search_results 表（MySQL 兼容语法）
    const resultsColumnsToAdd = [
      { name: 'location', definition: 'VARCHAR(200)' },
      { name: 'phone', definition: 'VARCHAR(50)' },
      { name: 'phoneType', definition: 'VARCHAR(50)' },
      { name: 'carrier', definition: 'VARCHAR(100)' },
      { name: 'reportYear', definition: 'INT' },
      { name: 'isPrimary', definition: 'BOOLEAN DEFAULT FALSE' },
      { name: 'yearBuilt', definition: 'INT' },
      { name: 'fromCache', definition: 'BOOLEAN DEFAULT FALSE' },
      { name: 'company', definition: 'VARCHAR(200)' },
      { name: 'jobTitle', definition: 'VARCHAR(200)' },
    ];
    
    for (const col of resultsColumnsToAdd) {
      try {
        await db.execute(sql.raw(`ALTER TABLE tps_search_results ADD COLUMN ${col.name} ${col.definition}`));
        console.log(`[Database] Added column ${col.name} to tps_search_results`);
      } catch (e: any) {
        // 忽略字段已存在的错误
        if (!e.message?.includes('Duplicate column')) {
          console.warn(`[Database] Failed to add column ${col.name}:`, e.message);
        }
      }
    }
    console.log("[Database] TPS search results columns sync completed");
    
    // ========== Anywho 相关表 ==========
    
    // 22. Anywho 配置表 - 先删除旧表再创建新表以确保字段一致
    await db.execute(sql`DROP TABLE IF EXISTS anywho_config`);
    await db.execute(sql`
      CREATE TABLE anywho_config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        searchCost DECIMAL(10,2) NOT NULL DEFAULT 0.5,
        detailCost DECIMAL(10,2) NOT NULL DEFAULT 0.5,
        maxConcurrent INT NOT NULL DEFAULT 20,
        cacheDays INT NOT NULL DEFAULT 180,
        scrapeDoToken VARCHAR(100),
        maxPages INT NOT NULL DEFAULT 10,
        batchDelay INT NOT NULL DEFAULT 300,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        defaultMinAge INT NOT NULL DEFAULT 50,
        defaultMaxAge INT NOT NULL DEFAULT 79,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
      )
    `);
    console.log("[Database] Anywho config table ready");
    
    // 23. Anywho 详情页缓存表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS anywho_detail_cache (
        id INT AUTO_INCREMENT PRIMARY KEY,
        detailLink VARCHAR(500) NOT NULL UNIQUE,
        name VARCHAR(200),
        age INT,
        marriageStatus VARCHAR(50),
        marriageRecords JSON,
        isDeceased BOOLEAN DEFAULT FALSE,
        data JSON,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        expiresAt TIMESTAMP NULL,
        INDEX idx_expiresAt (expiresAt)
      )
    `);
    console.log("[Database] Anywho detail cache table ready");
    
    // 24. Anywho 搜索任务表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS anywho_search_tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        taskId VARCHAR(32) NOT NULL UNIQUE,
        userId INT NOT NULL,
        mode ENUM('nameOnly', 'nameLocation') NOT NULL DEFAULT 'nameOnly',
        names JSON NOT NULL,
        locations JSON,
        filters JSON,
        totalSubTasks INT NOT NULL DEFAULT 0,
        completedSubTasks INT NOT NULL DEFAULT 0,
        totalResults INT NOT NULL DEFAULT 0,
        searchPageRequests INT NOT NULL DEFAULT 0,
        detailPageRequests INT NOT NULL DEFAULT 0,
        cacheHits INT NOT NULL DEFAULT 0,
        creditsUsed DECIMAL(10,2) NOT NULL DEFAULT 0,
        status ENUM('pending', 'running', 'completed', 'failed', 'cancelled', 'insufficient_credits') NOT NULL DEFAULT 'pending',
        progress INT NOT NULL DEFAULT 0,
        logs JSON,
        errorMessage TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        startedAt TIMESTAMP NULL,
        completedAt TIMESTAMP NULL,
        INDEX idx_userId (userId),
        INDEX idx_status (status)
      )
    `);
    console.log("[Database] Anywho search tasks table ready");
    
    // 25. Anywho 搜索结果表 - 强制重建以确保结构正确
    await db.execute(sql`DROP TABLE IF EXISTS anywho_search_results`);
    console.log("[Database] Dropped old anywho_search_results table");
    await db.execute(sql`
      CREATE TABLE anywho_search_results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        taskId INT NOT NULL,
        subTaskIndex INT NOT NULL DEFAULT 0,
        name VARCHAR(200),
        firstName VARCHAR(100),
        lastName VARCHAR(100),
        searchName VARCHAR(200),
        searchLocation VARCHAR(200),
        age INT,
        city VARCHAR(100),
        state VARCHAR(50),
        location VARCHAR(200),
        currentAddress VARCHAR(500),
        phone VARCHAR(50),
        phoneType VARCHAR(50),
        carrier VARCHAR(100),
        allPhones JSON,
        reportYear INT,
        isPrimary BOOLEAN DEFAULT TRUE,
        marriageStatus VARCHAR(50),
        marriageRecords JSON,
        familyMembers JSON,
        emails JSON,
        isDeceased BOOLEAN DEFAULT FALSE,
        detailLink VARCHAR(500),
        fromCache BOOLEAN DEFAULT FALSE NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_taskId (taskId)
      )
    `);
    console.log("[Database] Anywho search results table ready");
    
    // 注意：表已在上面强制重建，无需额外修复逻辑
    
    // 插入默认 Anywho 配置
    await db.execute(sql`
      INSERT INTO anywho_config (id, searchCost, detailCost, maxConcurrent, cacheDays, maxPages, batchDelay, enabled, defaultMinAge, defaultMaxAge)
      VALUES (1, 0.5, 0.5, 20, 180, 10, 300, TRUE, 50, 79)
    `);
    console.log("[Database] Default Anywho config inserted");
    
    // ========== 初始化默认数据 ==========
    
    // 插入默认系统配置（如果不存在）
    await db.execute(sql`
      INSERT IGNORE INTO system_configs (\`key\`, value, description) VALUES
      ('USDT_WALLET_TRC20', '', 'TRC20 USDT 收款钱包地址'),
      ('USDT_RATE', '7.2', 'USDT 兑人民币汇率'),
      ('CREDIT_PRICE', '1', '每积分价格(人民币)'),
      ('ORDER_EXPIRE_MINUTES', '30', '订单过期时间(分钟)'),
      ('SEARCH_COST_PER_RESULT', '1', '每条搜索结果消耗积分'),
      ('NEW_USER_BONUS', '0', '新用户赠送积分')
    `);
    console.log("[Database] Default system configs inserted");
    
    // 插入默认 TPS 配置（如果不存在）
    await db.execute(sql`
      INSERT IGNORE INTO tps_config (id, searchCost, detailCost, maxConcurrent, cacheDays, maxPages, batchDelay, enabled)
      VALUES (1, 0.3, 0.3, 40, 180, 25, 200, TRUE)
    `);
    console.log("[Database] Default TPS config inserted");
    
    // ========== 代理系统相关表 ==========
    
    // 添加用户表的代理相关字段
    const agentColumnsToAdd = [
      { name: 'inviterId', definition: 'INT DEFAULT NULL' },
      { name: 'inviteCode', definition: 'VARCHAR(20) DEFAULT NULL' },
      { name: 'isAgent', definition: 'BOOLEAN DEFAULT FALSE' },
      { name: 'agentLevel', definition: "ENUM('normal', 'silver', 'gold', 'founder') DEFAULT 'normal'" },
      { name: 'agentBalance', definition: 'DECIMAL(10,2) DEFAULT 0' },
      { name: 'agentFrozenBalance', definition: 'DECIMAL(10,2) DEFAULT 0' },
      { name: 'agentTotalEarned', definition: 'DECIMAL(10,2) DEFAULT 0' },
      { name: 'agentWalletAddress', definition: 'VARCHAR(100) DEFAULT NULL' },
      { name: 'agentAppliedAt', definition: 'TIMESTAMP NULL' },
      { name: 'agentApprovedAt', definition: 'TIMESTAMP NULL' },
    ];
    
    for (const col of agentColumnsToAdd) {
      try {
        await db.execute(sql.raw(`ALTER TABLE users ADD COLUMN ${col.name} ${col.definition}`));
        console.log(`[Database] Added column ${col.name} to users`);
      } catch (e: any) {
        if (!e.message?.includes('Duplicate column')) {
          console.warn(`[Database] Failed to add column ${col.name}:`, e.message);
        }
      }
    }
    console.log("[Database] Users agent columns sync completed");
    
    // 代理佣金记录表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_commissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        agentId INT NOT NULL,
        fromUserId INT NOT NULL,
        orderId INT NOT NULL,
        orderAmount DECIMAL(10,2) NOT NULL,
        commissionRate DECIMAL(5,2) NOT NULL,
        commissionAmount DECIMAL(10,2) NOT NULL,
        level INT NOT NULL DEFAULT 1,
        status ENUM('frozen', 'available', 'withdrawn') NOT NULL DEFAULT 'frozen',
        availableAt TIMESTAMP NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_agentId (agentId),
        INDEX idx_status (status)
      )
    `);
    console.log("[Database] Agent commissions table ready");
    
    // 代理提现申请表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_withdrawals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        withdrawalId VARCHAR(32) NOT NULL UNIQUE,
        agentId INT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        walletAddress VARCHAR(100) NOT NULL,
        network VARCHAR(20) DEFAULT 'TRC20' NOT NULL,
        status ENUM('pending', 'approved', 'rejected', 'paid') NOT NULL DEFAULT 'pending',
        txId VARCHAR(100),
        adminNote TEXT,
        processedBy VARCHAR(50),
        processedAt TIMESTAMP NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_agentId (agentId),
        INDEX idx_status (status)
      )
    `);
    console.log("[Database] Agent withdrawals table ready");
    
    // 迁移: 添加缺少的列
    try {
      await db.execute(sql`ALTER TABLE agent_withdrawals ADD COLUMN withdrawalId VARCHAR(32) NOT NULL UNIQUE AFTER id`);
      console.log("[Database] Added withdrawalId column to agent_withdrawals");
    } catch (e: any) {
      if (!e.message?.includes('Duplicate column')) {
        console.log("[Database] withdrawalId column already exists or error:", e.message);
      }
    }
    try {
      await db.execute(sql`ALTER TABLE agent_withdrawals ADD COLUMN network VARCHAR(20) DEFAULT 'TRC20' NOT NULL AFTER walletAddress`);
      console.log("[Database] Added network column to agent_withdrawals");
    } catch (e: any) {
      if (!e.message?.includes('Duplicate column')) {
        console.log("[Database] network column already exists or error:", e.message);
      }
    }
    
    // 代理月度统计表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_stats (
        id INT AUTO_INCREMENT PRIMARY KEY,
        agentId INT NOT NULL,
        month VARCHAR(7) NOT NULL,
        totalRecharge DECIMAL(10,2) DEFAULT 0,
        totalCommission DECIMAL(10,2) DEFAULT 0,
        newUsers INT DEFAULT 0,
        activeUsers INT DEFAULT 0,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY unique_agent_month (agentId, month)
      )
    `);
    console.log("[Database] Agent stats table ready");
    
    // 代理配置表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        settingKey VARCHAR(50) NOT NULL,
        settingValue VARCHAR(200) NOT NULL,
        description TEXT,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        UNIQUE KEY unique_setting_key (settingKey)
      )
    `);
    console.log("[Database] Agent settings table ready");
    
    // 代理申请表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS agent_applications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(320) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        wechat VARCHAR(50),
        company VARCHAR(100),
        experience TEXT,
        channels TEXT,
        expectedUsers VARCHAR(50),
        walletAddress VARCHAR(100),
        status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
        adminNote TEXT,
        processedBy VARCHAR(50),
        processedAt TIMESTAMP NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_status (status),
        INDEX idx_email (email)
      )
    `);
    console.log("[Database] Agent applications table ready");
    
    // ========== SPF (SearchPeopleFree) 相关表 ==========
    
    // SPF 配置表 (0.85 积分/次 API 调用)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS spf_config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        searchCost DECIMAL(10,2) NOT NULL DEFAULT 0.85,
        detailCost DECIMAL(10,2) NOT NULL DEFAULT 0.85,
        maxConcurrent INT NOT NULL DEFAULT 40,
        cacheDays INT NOT NULL DEFAULT 180,
        scrapeDoToken VARCHAR(100),
        maxPages INT NOT NULL DEFAULT 25,
        batchDelay INT NOT NULL DEFAULT 200,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        defaultMinAge INT NOT NULL DEFAULT 50,
        defaultMaxAge INT NOT NULL DEFAULT 79,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL
      )
    `);
    console.log("[Database] SPF config table ready");
    
    // SPF 详情页缓存表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS spf_detail_cache (
        id INT AUTO_INCREMENT PRIMARY KEY,
        detailLink VARCHAR(500) NOT NULL UNIQUE,
        data JSON,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        expiresAt TIMESTAMP NOT NULL,
        INDEX idx_expiresAt (expiresAt)
      )
    `);
    console.log("[Database] SPF detail cache table ready");
    
    // SPF 搜索任务表
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS spf_search_tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        taskId VARCHAR(32) NOT NULL UNIQUE,
        userId INT NOT NULL,
        mode ENUM('nameOnly', 'nameLocation') NOT NULL DEFAULT 'nameOnly',
        names JSON NOT NULL,
        locations JSON,
        filters JSON,
        totalSubTasks INT NOT NULL DEFAULT 0,
        completedSubTasks INT NOT NULL DEFAULT 0,
        totalResults INT NOT NULL DEFAULT 0,
        searchPageRequests INT NOT NULL DEFAULT 0,
        detailPageRequests INT NOT NULL DEFAULT 0,
        cacheHits INT NOT NULL DEFAULT 0,
        creditsUsed DECIMAL(10,2) NOT NULL DEFAULT 0,
        status ENUM('pending', 'running', 'completed', 'failed', 'cancelled', 'insufficient_credits') NOT NULL DEFAULT 'pending',
        progress INT NOT NULL DEFAULT 0,
        logs JSON,
        errorMessage TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        startedAt TIMESTAMP NULL,
        completedAt TIMESTAMP NULL,
        INDEX idx_userId (userId),
        INDEX idx_status (status)
      )
    `);
    console.log("[Database] SPF search tasks table ready");
    
    // SPF 搜索结果表（包含独特字段：email, maritalStatus, spouseName, employment, confirmedDate, latitude, longitude）
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS spf_search_results (
        id INT AUTO_INCREMENT PRIMARY KEY,
        taskId INT NOT NULL,
        subTaskIndex INT NOT NULL DEFAULT 0,
        name VARCHAR(200),
        firstName VARCHAR(100),
        lastName VARCHAR(100),
        searchName VARCHAR(200),
        searchLocation VARCHAR(200),
        age INT,
        birthYear VARCHAR(20),
        city VARCHAR(100),
        state VARCHAR(50),
        location VARCHAR(200),
        phone VARCHAR(50),
        phoneType VARCHAR(50),
        carrier VARCHAR(100),
        allPhones JSON,
        reportYear INT,
        isPrimary BOOLEAN DEFAULT TRUE,
        email VARCHAR(200),
        allEmails JSON,
        maritalStatus VARCHAR(50),
        spouseName VARCHAR(200),
        spouseLink VARCHAR(500),
        employment VARCHAR(200),
        confirmedDate VARCHAR(50),
        latitude DECIMAL(10,6),
        longitude DECIMAL(10,6),
        familyMembers JSON,
        associates JSON,
        businesses JSON,
        propertyValue INT DEFAULT 0,
        yearBuilt INT,
        isDeceased BOOLEAN DEFAULT FALSE,
        detailLink VARCHAR(500),
        fromCache BOOLEAN DEFAULT FALSE NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_taskId (taskId)
      )
    `);
    console.log("[Database] SPF search results table ready");
    
    // 添加 phoneYear 列（如果不存在）
    try {
      await db.execute(sql`ALTER TABLE spf_search_results ADD COLUMN phoneYear INT AFTER phoneType`);
      console.log("[Database] Added phoneYear column to spf_search_results");
    } catch (e: any) {
      if (e.message?.includes('Duplicate column')) {
        console.log("[Database] phoneYear column already exists in spf_search_results");
      } else {
        console.log("[Database] phoneYear column already exists or error:", e.message?.slice(0, 100));
      }
    }
    
    // 插入默认 SPF 配置 (0.85 积分/次 API 调用)
    await db.execute(sql`
      INSERT IGNORE INTO spf_config (id, searchCost, detailCost, maxConcurrent, cacheDays, maxPages, batchDelay, enabled, defaultMinAge, defaultMaxAge)
      VALUES (1, 0.85, 0.85, 40, 180, 25, 200, TRUE, 50, 79)
    `);
    console.log("[Database] Default SPF config inserted");
    
    // 插入默认代理配置
    await db.execute(sql`
      INSERT IGNORE INTO agent_settings (settingKey, settingValue, description) VALUES
      ('founder_limit', '100', '创始代理名额限制'),
      ('founder_level1_rate', '15', '创始代理一级佣金比例'),
      ('founder_level2_rate', '5', '创始代理二级佣金比例'),
      ('gold_level1_rate', '12', '金牌代理一级佣金比例'),
      ('gold_level2_rate', '4', '金牌代理二级佣金比例'),
      ('silver_level1_rate', '10', '银牌代理一级佣金比例'),
      ('silver_level2_rate', '3', '银牌代理二级佣金比例'),
      ('normal_level1_rate', '8', '普通代理一级佣金比例'),
      ('normal_level2_rate', '2', '普通代理二级佣金比例'),
      ('first_charge_bonus', '3', '首充额外奖励比例'),
      ('min_withdrawal', '50', '最低提现金额(USDT)'),
      ('settlement_days', '7', '佣金结算冻结天数'),
      ('activity_bonus', '3', '开业活动额外奖励'),
      ('activity_end_date', '2026-02-28', '开业活动结束日期')
    `);
    console.log("[Database] Default agent settings inserted");
    
    // ========== 数据迁移 ==========
    await migrateOldData(db);
    
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
  
  // Apollo Webhook 已移除 - 现在使用 Apify 同步获取数据
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
      
      // 启动佣金自动结算服务（每小时检查一次）
      startCommissionSettlement(60 * 60 * 1000);
      console.log("[Background] Commission settlement service started");
    }
  });
}

startServer().catch(console.error);
