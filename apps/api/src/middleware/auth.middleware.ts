import { createMiddleware } from "hono/factory";
import { auth } from "@tails/auth";
import type { AppVariables } from "../types";

export const requireAuth = createMiddleware<{ Variables: AppVariables }>(
  async (c, next) => {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("user", session.user as AppVariables["user"]);
    c.set("session", session.session as AppVariables["session"]);

    return next();
  }
);

export const optionalAuth = createMiddleware<{ Variables: AppVariables }>(
  async (c, next) => {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (session) {
      c.set("user", session.user as AppVariables["user"]);
      c.set("session", session.session as AppVariables["session"]);
    }

    return next();
  }
);
