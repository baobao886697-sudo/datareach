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

async function startServer() {
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
