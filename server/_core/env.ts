// 环境变量验证函数
function requireEnv(name: string, defaultValue?: string): string {
  const value = process.env[name] ?? defaultValue;
  if (!value && defaultValue === undefined) {
    console.error(`[SECURITY] Missing required environment variable: ${name}`);
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Missing required environment variable: ${name}`);
    }
  }
  return value ?? "";
}

// 敏感环境变量验证（生产环境必须设置）
function requireSecureEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[SECURITY CRITICAL] Missing required secure environment variable: ${name}`);
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Missing required secure environment variable: ${name}. This is a security requirement.`);
    }
    // 开发环境返回空字符串，但会记录警告
    console.warn(`[SECURITY WARNING] Using empty value for ${name} in development mode. Set this in production!`);
    return "";
  }
  return value;
}

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: requireSecureEnv("JWT_SECRET"),
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  
  // 管理员认证（V6蓝图）- 移除硬编码默认值
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: requireSecureEnv("ADMIN_PASSWORD"),
  adminJwtSecret: requireSecureEnv("ADMIN_JWT_SECRET"),
  
  // Agent JWT 密钥
  agentJwtSecret: requireSecureEnv("AGENT_JWT_SECRET"),
  
  // 外部API密钥
  apifyApiToken: process.env.APIFY_API_TOKEN ?? "",
  scrapeDoApiKey: process.env.SCRAPEDO_API_KEY ?? "",
  trongridApiKey: process.env.TRONGRID_API_KEY ?? "",
  
  // 邮件服务
  resendApiKey: process.env.RESEND_API_KEY ?? "",
};
