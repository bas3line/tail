import { Context, Next } from "hono";
import { createLogger } from "@tails/logger";
import { getClientIdentifier } from "../lib/rate-limiter";

const log = createLogger("http");

export const requestLogger = async (c: Context, next: Next) => {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;
  const ip = getClientIdentifier(c);
  const userAgent = c.req.header("user-agent")?.slice(0, 100) || "unknown";

  // Generate request ID
  const requestId = crypto.randomUUID().slice(0, 8);
  c.set("requestId", requestId);

  await next();

  const duration = Date.now() - start;
  const status = c.res.status;

  // Log based on status code
  log.request(method, path, status, duration, {
    requestId,
    ip,
    userAgent,
  });
};


