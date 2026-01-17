import type { Express, Request, Response } from "express";

// OAuth routes are no longer needed for independent authentication
// This file is kept for compatibility but does nothing

export function registerOAuthRoutes(app: Express) {
  // OAuth callback is disabled - using independent email/password authentication
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    res.status(410).json({ 
      error: "OAuth authentication is disabled",
      message: "Please use email/password authentication instead"
    });
  });
}
