import { Context, Next } from "hono";
import { createLogger } from "@tails/logger";
import { 
  checkRateLimit, 
  getClientIdentifier, 
  RATE_LIMITS,
  type RateLimitConfig 
} from "../lib/rate-limiter";

const log = createLogger("security");

// Security headers middleware (OWASP recommendations)
export const securityHeaders = async (c: Context, next: Next) => {
  await next();

  // Prevent clickjacking
  c.header("X-Frame-Options", "DENY");
  
  // Prevent MIME type sniffing
  c.header("X-Content-Type-Options", "nosniff");
  
  // XSS protection
  c.header("X-XSS-Protection", "1; mode=block");
  
  // Referrer policy
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  
  // Content Security Policy
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'"
  );
  
  // Strict Transport Security (HTTPS)
  if (process.env.NODE_ENV === "production") {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  
  // Permissions Policy
  c.header(
    "Permissions-Policy",
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
  );

  // Remove server identification
  c.header("X-Powered-By", "");
};

// Rate limiting middleware factory
export const rateLimit = (config: RateLimitConfig) => {
  return async (c: Context, next: Next) => {
    const identifier = config.keyGenerator 
      ? config.keyGenerator(c) 
      : getClientIdentifier(c);

    const result = await checkRateLimit(identifier, config);

    // Set rate limit headers
    c.header("X-RateLimit-Limit", config.maxRequests.toString());
    c.header("X-RateLimit-Remaining", result.remaining.toString());
    c.header("X-RateLimit-Reset", Math.ceil(result.resetAt / 1000).toString());

    if (!result.allowed) {
      c.header("Retry-After", result.retryAfter.toString());
      
      log.warn("Rate limit exceeded", {
        ip: identifier,
        path: c.req.path,
        retryAfter: result.retryAfter,
      });

      return c.json(
        { 
          error: config.message || "Too many requests",
          retryAfter: result.retryAfter,
        },
        429
      );
    }

    await next();
  };
};

// Pre-configured rate limiters
export const rateLimiters = {
  authOtpSend: rateLimit(RATE_LIMITS.AUTH_OTP_SEND),
  authOtpVerify: rateLimit(RATE_LIMITS.AUTH_OTP_VERIFY),
  authLogin: rateLimit(RATE_LIMITS.AUTH_LOGIN),
  authSignup: rateLimit(RATE_LIMITS.AUTH_SIGNUP),
  apiGeneral: rateLimit(RATE_LIMITS.API_GENERAL),
  apiUpload: rateLimit(RATE_LIMITS.API_UPLOAD),
};

// Request size limiter
export const requestSizeLimit = (maxSizeBytes: number = 1024 * 1024) => {
  return async (c: Context, next: Next) => {
    const contentLength = c.req.header("content-length");
    
    if (contentLength && parseInt(contentLength) > maxSizeBytes) {
      log.warn("Request too large", {
        ip: getClientIdentifier(c),
        size: contentLength,
        maxSize: maxSizeBytes,
      });
      
      return c.json({ error: "Request body too large" }, 413);
    }

    await next();
  };
};

// IP blocking middleware (for banned IPs)
const blockedIPs = new Set<string>();

export const ipBlocker = async (c: Context, next: Next) => {
  const ip = getClientIdentifier(c);
  
  if (blockedIPs.has(ip)) {
    log.warn("Blocked IP attempted access", { ip });
    return c.json({ error: "Access denied" }, 403);
  }

  await next();
};

export const blockIP = (ip: string) => {
  blockedIPs.add(ip);
  log.info("IP blocked", { ip });
};

export const unblockIP = (ip: string) => {
  blockedIPs.delete(ip);
  log.info("IP unblocked", { ip });
};
