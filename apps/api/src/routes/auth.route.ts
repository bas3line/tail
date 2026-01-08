import { Hono } from "hono";
import { auth } from "@tails/auth";

export const authRoutes = new Hono();

// Handle all auth routes - better-auth handles everything
authRoutes.on(["GET", "POST"], "/*", (c) => {
  return auth.handler(c.req.raw);
});
