import { getCache, setCache, deleteCache, isRedisAvailable } from "@tails/redis";
import { createLogger } from "@tails/logger";

// Export Redis key routes
export * from "./keys";

const log = createLogger("cache");

/**
 * 3-Layer Cache System
 * Layer 1: In-memory (LRU) - fastest, limited size
 * Layer 2: Redis - fast, shared across instances
 * Layer 3: Database - source of truth (handled by caller)
 */

// Layer 1: In-memory LRU cache
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    
    return entry.value;
  }

  set(key: string, value: T, ttlSeconds: number): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

// Global memory cache instances
const memoryCaches = new Map<string, LRUCache<any>>();

function getMemoryCache(namespace: string): LRUCache<any> {
  if (!memoryCaches.has(namespace)) {
    memoryCaches.set(namespace, new LRUCache(500));
  }
  return memoryCaches.get(namespace)!;
}

// Cache configuration
export interface CacheConfig {
  namespace: string;
  memoryTTL?: number;  // Layer 1 TTL in seconds (default: 60)
  redisTTL?: number;   // Layer 2 TTL in seconds (default: 300)
  skipMemory?: boolean;
  skipRedis?: boolean;
}

const DEFAULT_CONFIG: Required<Omit<CacheConfig, "namespace">> = {
  memoryTTL: 60,
  redisTTL: 300,
  skipMemory: false,
  skipRedis: false,
};

/**
 * Get from cache (checks all layers)
 */
export async function cacheGet<T>(
  key: string,
  config: CacheConfig
): Promise<T | null> {
  const { namespace, memoryTTL, redisTTL, skipMemory, skipRedis } = {
    ...DEFAULT_CONFIG,
    ...config,
  };
  
  const fullKey = `${namespace}:${key}`;
  
  // Layer 1: Memory
  if (!skipMemory) {
    const memCache = getMemoryCache(namespace);
    const memValue = memCache.get(fullKey);
    if (memValue !== null) {
      log.debug("Cache hit (memory)", { key: fullKey });
      return memValue as T;
    }
  }
  
  // Layer 2: Redis
  if (!skipRedis && isRedisAvailable()) {
    const redisValue = await getCache<T>(fullKey);
    if (redisValue !== null) {
      log.debug("Cache hit (redis)", { key: fullKey });
      
      // Backfill memory cache
      if (!skipMemory) {
        const memCache = getMemoryCache(namespace);
        memCache.set(fullKey, redisValue, memoryTTL);
      }
      
      return redisValue;
    }
  }
  
  log.debug("Cache miss", { key: fullKey });
  return null;
}

/**
 * Set in cache (writes to all layers)
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  config: CacheConfig
): Promise<void> {
  const { namespace, memoryTTL, redisTTL, skipMemory, skipRedis } = {
    ...DEFAULT_CONFIG,
    ...config,
  };
  
  const fullKey = `${namespace}:${key}`;
  
  // Layer 1: Memory
  if (!skipMemory) {
    const memCache = getMemoryCache(namespace);
    memCache.set(fullKey, value, memoryTTL);
  }
  
  // Layer 2: Redis
  if (!skipRedis) {
    await setCache(fullKey, value, redisTTL);
  }
  
  log.debug("Cache set", { key: fullKey });
}

/**
 * Delete from cache (removes from all layers)
 */
export async function cacheDelete(
  key: string,
  config: Pick<CacheConfig, "namespace">
): Promise<void> {
  const fullKey = `${config.namespace}:${key}`;
  
  // Layer 1: Memory
  const memCache = getMemoryCache(config.namespace);
  memCache.delete(fullKey);
  
  // Layer 2: Redis
  await deleteCache(fullKey);
  
  log.debug("Cache deleted", { key: fullKey });
}

/**
 * Invalidate all cache entries for a namespace pattern
 */
export async function cacheInvalidatePattern(
  pattern: string,
  config: Pick<CacheConfig, "namespace">
): Promise<void> {
  // For memory, we clear the whole namespace (simple approach)
  const memCache = getMemoryCache(config.namespace);
  memCache.clear();
  
  // For Redis, we'd need to use SCAN + DEL (expensive, use sparingly)
  // For now, we rely on TTL expiration for Redis
  
  log.debug("Cache invalidated", { pattern, namespace: config.namespace });
}

/**
 * Get or set pattern - fetch from cache or execute getter and cache result
 */
export async function cacheGetOrSet<T>(
  key: string,
  getter: () => Promise<T>,
  config: CacheConfig
): Promise<T> {
  // Try to get from cache
  const cached = await cacheGet<T>(key, config);
  if (cached !== null) {
    return cached;
  }
  
  // Execute getter (Layer 3: Database)
  const value = await getter();
  
  // Cache the result
  await cacheSet(key, value, config);
  
  return value;
}

/**
 * Create a cached function wrapper
 */
export function createCachedFunction<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  keyGenerator: (...args: TArgs) => string,
  config: CacheConfig
) {
  return async (...args: TArgs): Promise<TResult> => {
    const key = keyGenerator(...args);
    return cacheGetOrSet(key, () => fn(...args), config);
  };
}

// Pre-configured cache namespaces
export const CacheNamespaces = {
  FILES: "files",
  LINKS: "links",
  PASTES: "pastes",
  MEDIA: "media",
  USERS: "users",
  API_KEYS: "api_keys",
  RATE_LIMITS: "rate_limits",
} as const;

// Export memory cache stats for monitoring
export function getCacheStats() {
  const stats: Record<string, { size: number }> = {};
  for (const [namespace, cache] of memoryCaches) {
    stats[namespace] = { size: cache.size() };
  }
  return stats;
}

