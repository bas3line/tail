import { checkRateLimit as redisRateLimit, isRedisAvailable } from "@tails/redis";
import { Context } from "hono";

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
  message?: string;
  skipFailedRequests?: boolean;
  keyGenerator?: (c: Context) => string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 60,
  keyPrefix: "rl:",
  message: "Too many requests, please try again later",
};

// Rate limit presets for different endpoints
export const RATE_LIMITS = {
  // Auth endpoints - strict limits
  AUTH_OTP_SEND: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 3, // 3 OTP requests per minute
    keyPrefix: "rl:otp:send:",
    message: "Too many OTP requests. Please wait before requesting another code.",
  },
  AUTH_OTP_VERIFY: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5, // 5 attempts per 15 minutes
    keyPrefix: "rl:otp:verify:",
    message: "Too many verification attempts. Please try again later.",
  },
  AUTH_LOGIN: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10,
    keyPrefix: "rl:auth:login:",
    message: "Too many login attempts. Please try again later.",
  },
  AUTH_SIGNUP: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 5,
    keyPrefix: "rl:auth:signup:",
    message: "Too many signup attempts. Please try again later.",
  },
  // API endpoints
  API_GENERAL: {
    windowMs: 60 * 1000,
    maxRequests: 100,
    keyPrefix: "rl:api:",
  },
  API_UPLOAD: {
    windowMs: 60 * 1000,
    maxRequests: 10,
    keyPrefix: "rl:api:upload:",
  },
  LINK_CREATE: {
    windowMs: 60 * 1000,
    maxRequests: 50,
    keyPrefix: "rl:link:create:",
    message: "Too many link creations. Please slow down.",
  },
  LINK_REDIRECT: {
    windowMs: 10 * 1000,
    maxRequests: 100,
    keyPrefix: "rl:link:redirect:",
    message: "Too many redirects. Please try again later.",
  },
  LINK_DELETE: {
    windowMs: 60 * 1000,
    maxRequests: 30,
    keyPrefix: "rl:link:delete:",
    message: "Too many delete requests.",
  },
  // Tools endpoints
  TOOLS_GENERAL: {
    windowMs: 60 * 1000,
    maxRequests: 100, // 100 requests per minute for general tools
    keyPrefix: "rl:tools:",
    message: "Too many tool requests. Please slow down.",
  },
  TOOLS_IMAGE: {
    windowMs: 60 * 1000,
    maxRequests: 20, // 20 image operations per minute (heavy)
    keyPrefix: "rl:tools:image:",
    message: "Too many image operations. Please try again later.",
  },
  TOOLS_QR: {
    windowMs: 60 * 1000,
    maxRequests: 50, // 50 QR codes per minute
    keyPrefix: "rl:tools:qr:",
    message: "Too many QR code generations.",
  },
} as const;

// In-memory fallback rate limiter (when Redis is unavailable)
const memoryStore = new Map<string, { count: number; resetAt: number }>();

function memoryRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const record = memoryStore.get(key);

  // Clean up expired entries periodically
  if (memoryStore.size > 10000) {
    for (const [k, v] of memoryStore) {
      if (v.resetAt < now) memoryStore.delete(k);
    }
  }

  if (!record || record.resetAt < now) {
    // New window
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAt: now + windowMs,
      retryAfter: 0,
    };
  }

  record.count++;
  const allowed = record.count <= maxRequests;

  return {
    allowed,
    remaining: Math.max(0, maxRequests - record.count),
    resetAt: record.resetAt,
    retryAfter: allowed ? 0 : Math.ceil((record.resetAt - now) / 1000),
  };
}

export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig = DEFAULT_CONFIG
): Promise<RateLimitResult> {
  const windowSeconds = Math.ceil(config.windowMs / 1000);
  const key = `${config.keyPrefix || "rl:"}${identifier}`;
  const now = Date.now();

  // Use Redis if available, otherwise fall back to in-memory
  if (isRedisAvailable()) {
    try {
      const result = await redisRateLimit(key, config.maxRequests, windowSeconds);
      return {
        allowed: result.allowed,
        remaining: result.remaining,
        resetAt: now + result.resetIn * 1000,
        retryAfter: result.allowed ? 0 : result.resetIn,
      };
    } catch (error) {
      console.error("[RATE_LIMIT] Redis error, using memory fallback:", error);
    }
  }

  // Fallback to in-memory rate limiting
  return memoryRateLimit(key, config.maxRequests, config.windowMs);
}

export function getClientIdentifier(c: Context): string {
  // Get IP from various headers (in order of trust)
  const cfConnectingIp = c.req.header("cf-connecting-ip");
  const xRealIp = c.req.header("x-real-ip");
  const xForwardedFor = c.req.header("x-forwarded-for");
  const remoteAddr = c.req.header("remote-addr");

  // Use the first available, split x-forwarded-for if present
  let ip = cfConnectingIp 
    || xRealIp 
    || (xForwardedFor ? xForwardedFor.split(",")[0].trim() : null)
    || remoteAddr
    || "unknown";

  // Sanitize IP
  ip = ip.replace(/[^a-fA-F0-9.:]/g, "");

  return ip;
}
