import Redis from "ioredis";
import { createLogger } from "@tails/logger";

const log = createLogger("redis");
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

let redis: Redis | null = null;
let isConnected = false;

function createRedisClient(): Redis {
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) {
        log.warn("Max retries reached, giving up");
        return null;
      }
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  });

  client.on("connect", () => {
    isConnected = true;
    log.info("Connected");
  });

  client.on("error", (err) => {
    isConnected = false;
    if (process.env.NODE_ENV !== "production") {
      log.warn("Connection error - rate limiting using memory fallback");
    } else {
      log.error("Connection error", err);
    }
  });

  client.on("close", () => {
    isConnected = false;
    log.debug("Connection closed");
  });

  return client;
}

function getRedis(): Redis {
  if (!redis) {
    redis = createRedisClient();
  }
  return redis;
}

export function isRedisAvailable(): boolean {
  return isConnected;
}

export async function connectRedis(): Promise<boolean> {
  try {
    const client = getRedis();
    await client.connect();
    return true;
  } catch (error) {
    log.warn("Failed to connect", { error });
    return false;
  }
}

export async function getCache<T>(key: string): Promise<T | null> {
  if (!isConnected) return null;
  
  try {
    const data = await getRedis().get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch (error) {
    log.error("Get cache error", error as Error, { key });
    return null;
  }
}

export async function setCache<T>(
  key: string,
  value: T,
  ttlSeconds?: number
): Promise<void> {
  if (!isConnected) return;
  
  try {
    const data = JSON.stringify(value);
    if (ttlSeconds) {
      await getRedis().setex(key, ttlSeconds, data);
    } else {
      await getRedis().set(key, data);
    }
  } catch (error) {
    log.error("Set cache error", error as Error, { key });
  }
}

export async function deleteCache(key: string): Promise<void> {
  if (!isConnected) return;
  
  try {
    await getRedis().del(key);
  } catch (error) {
    log.error("Delete cache error", error as Error, { key });
  }
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  if (!isConnected) {
    return {
      allowed: true,
      remaining: limit,
      resetIn: windowSeconds,
    };
  }

  try {
    const client = getRedis();
    const current = await client.incr(key);

    if (current === 1) {
      await client.expire(key, windowSeconds);
    }

    const ttl = await client.ttl(key);

    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
      resetIn: ttl > 0 ? ttl : windowSeconds,
    };
  } catch (error) {
    log.error("Rate limit check error", error as Error, { key });
    return {
      allowed: true,
      remaining: limit,
      resetIn: windowSeconds,
    };
  }
}

export { getRedis as redis, Redis };
