import { db, apiKeys, apiKeyUsage, type ApiKey, type NewApiKey, eq, and, isNull, desc, sql } from "@tails/db";
import { cacheGet, cacheSet, cacheDelete, CacheNamespaces } from "@tails/cache";
import { createLogger } from "@tails/logger";
import crypto from "crypto";

const log = createLogger("api-keys-service");

const CACHE_CONFIG = {
  namespace: CacheNamespaces.API_KEYS,
  memoryTTL: 300, // API keys are validated frequently
  redisTTL: 600,
};

// Available scopes
export const API_SCOPES = {
  FILES_READ: "files:read",
  FILES_WRITE: "files:write",
  FILES_DELETE: "files:delete",
  LINKS_READ: "links:read",
  LINKS_WRITE: "links:write",
  LINKS_DELETE: "links:delete",
  PASTES_READ: "pastes:read",
  PASTES_WRITE: "pastes:write",
  PASTES_DELETE: "pastes:delete",
  MEDIA_READ: "media:read",
  MEDIA_WRITE: "media:write",
  MEDIA_DELETE: "media:delete",
  ALL: "*",
} as const;

export type ApiScope = typeof API_SCOPES[keyof typeof API_SCOPES];

// Hash API key for storage
function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

// Generate secure API key
function generateApiKey(): { key: string; prefix: string; hash: string } {
  const randomBytes = crypto.randomBytes(32);
  const key = `tails_sk_${randomBytes.toString("base64url")}`;
  const prefix = key.slice(0, 16);
  const hash = hashApiKey(key);
  
  return { key, prefix, hash };
}

export interface CreateApiKeyInput {
  userId: string;
  name: string;
  scopes?: ApiScope[];
  rateLimit?: number;
  allowedIps?: string[];
  allowedDomains?: string[];
  expiresAt?: Date;
}

export interface ApiKeyValidationResult {
  valid: boolean;
  apiKey?: ApiKey;
  reason?: string;
}

/**
 * Create a new API key
 */
export async function createApiKey(input: CreateApiKeyInput): Promise<{ apiKey: ApiKey; plainKey: string }> {
  const { userId, name, scopes = [API_SCOPES.ALL], rateLimit = 1000, allowedIps, allowedDomains, expiresAt } = input;
  
  const { key, prefix, hash } = generateApiKey();
  const id = crypto.randomUUID();
  
  const [apiKey] = await db.insert(apiKeys).values({
    id,
    userId,
    name,
    keyHash: hash,
    keyPrefix: prefix,
    scopes: JSON.stringify(scopes),
    rateLimit,
    allowedIps: allowedIps ? JSON.stringify(allowedIps) : null,
    allowedDomains: allowedDomains ? JSON.stringify(allowedDomains) : null,
    expiresAt,
  }).returning();
  
  log.info("API key created", { id, userId, name });
  
  // Return the plain key only once - it cannot be retrieved later
  return { apiKey, plainKey: key };
}

/**
 * Validate an API key
 */
export async function validateApiKey(
  key: string,
  options?: {
    requiredScope?: ApiScope;
    ip?: string;
    domain?: string;
  }
): Promise<ApiKeyValidationResult> {
  if (!key || !key.startsWith("tails_sk_")) {
    return { valid: false, reason: "Invalid key format" };
  }
  
  const hash = hashApiKey(key);
  
  // Try cache first
  const cached = await cacheGet<ApiKey>(`key:${hash}`, CACHE_CONFIG);
  let apiKey = cached;
  
  if (!apiKey) {
    const [found] = await db.select()
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, hash))
      .limit(1);
    
    if (found) {
      await cacheSet(`key:${hash}`, found, CACHE_CONFIG);
      apiKey = found;
    }
  }
  
  if (!apiKey) {
    return { valid: false, reason: "Key not found" };
  }
  
  // Check if active
  if (!apiKey.active) {
    return { valid: false, reason: "Key is disabled" };
  }
  
  // Check if revoked
  if (apiKey.revokedAt) {
    return { valid: false, reason: "Key has been revoked" };
  }
  
  // Check expiration
  if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
    return { valid: false, reason: "Key has expired" };
  }
  
  // Check IP restriction
  if (apiKey.allowedIps && options?.ip) {
    const allowedIps = JSON.parse(apiKey.allowedIps) as string[];
    if (allowedIps.length > 0 && !allowedIps.includes(options.ip)) {
      return { valid: false, reason: "IP not allowed" };
    }
  }
  
  // Check domain restriction
  if (apiKey.allowedDomains && options?.domain) {
    const allowedDomains = JSON.parse(apiKey.allowedDomains) as string[];
    if (allowedDomains.length > 0 && !allowedDomains.some(d => options.domain?.endsWith(d))) {
      return { valid: false, reason: "Domain not allowed" };
    }
  }
  
  // Check scope
  if (options?.requiredScope) {
    const scopes = JSON.parse(apiKey.scopes) as string[];
    const hasScope = scopes.includes(API_SCOPES.ALL) || 
                     scopes.includes(options.requiredScope) ||
                     scopes.some(s => s.endsWith(":*") && options.requiredScope?.startsWith(s.replace(":*", ":")));
    
    if (!hasScope) {
      return { valid: false, reason: "Insufficient permissions" };
    }
  }
  
  // Update last used timestamp (async, don't wait)
  db.update(apiKeys)
    .set({ 
      lastUsedAt: new Date(),
      totalRequests: sql`${apiKeys.totalRequests} + 1`
    })
    .where(eq(apiKeys.id, apiKey.id))
    .catch((err: Error) => log.error("Failed to update API key usage", err));
  
  return { valid: true, apiKey };
}

/**
 * Record API key usage
 */
export async function recordApiKeyUsage(
  apiKeyId: string,
  usage: {
    endpoint: string;
    method: string;
    statusCode: number;
    responseTime?: number;
    ip?: string;
    userAgent?: string;
  }
): Promise<void> {
  await db.insert(apiKeyUsage).values({
    id: crypto.randomUUID(),
    apiKeyId,
    endpoint: usage.endpoint,
    method: usage.method,
    statusCode: usage.statusCode,
    responseTime: usage.responseTime,
    ip: usage.ip,
    userAgent: usage.userAgent?.slice(0, 500),
  });
}

/**
 * List user's API keys
 */
export async function listUserApiKeys(userId: string): Promise<ApiKey[]> {
  return db.select()
    .from(apiKeys)
    .where(and(
      eq(apiKeys.userId, userId),
      isNull(apiKeys.revokedAt)
    ))
    .orderBy(desc(apiKeys.createdAt));
}

/**
 * Get API key by ID
 */
export async function getApiKeyById(
  id: string,
  userId: string
): Promise<ApiKey | null> {
  const [apiKey] = await db.select()
    .from(apiKeys)
    .where(and(
      eq(apiKeys.id, id),
      eq(apiKeys.userId, userId)
    ))
    .limit(1);
  
  return apiKey || null;
}

/**
 * Update API key
 */
export async function updateApiKey(
  id: string,
  userId: string,
  input: {
    name?: string;
    scopes?: ApiScope[];
    rateLimit?: number;
    allowedIps?: string[] | null;
    allowedDomains?: string[] | null;
    active?: boolean;
    expiresAt?: Date | null;
  }
): Promise<ApiKey | null> {
  const existing = await getApiKeyById(id, userId);
  if (!existing) return null;
  
  const updates: Partial<NewApiKey> = {};
  
  if (input.name !== undefined) updates.name = input.name;
  if (input.scopes !== undefined) updates.scopes = JSON.stringify(input.scopes);
  if (input.rateLimit !== undefined) updates.rateLimit = input.rateLimit;
  if (input.active !== undefined) updates.active = input.active;
  if (input.expiresAt !== undefined) updates.expiresAt = input.expiresAt;
  if (input.allowedIps !== undefined) {
    updates.allowedIps = input.allowedIps ? JSON.stringify(input.allowedIps) : null;
  }
  if (input.allowedDomains !== undefined) {
    updates.allowedDomains = input.allowedDomains ? JSON.stringify(input.allowedDomains) : null;
  }
  
  const [updated] = await db.update(apiKeys)
    .set(updates)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .returning();
  
  // Invalidate cache
  await cacheDelete(`key:${existing.keyHash}`, { namespace: CacheNamespaces.API_KEYS });
  
  log.info("API key updated", { id, userId });
  
  return updated || null;
}

/**
 * Revoke API key
 */
export async function revokeApiKey(
  id: string,
  userId: string
): Promise<boolean> {
  const existing = await getApiKeyById(id, userId);
  if (!existing) return false;
  
  await db.update(apiKeys)
    .set({ revokedAt: new Date(), active: false })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)));
  
  // Invalidate cache
  await cacheDelete(`key:${existing.keyHash}`, { namespace: CacheNamespaces.API_KEYS });
  
  log.info("API key revoked", { id, userId });
  
  return true;
}

/**
 * Delete API key permanently
 */
export async function deleteApiKey(
  id: string,
  userId: string
): Promise<boolean> {
  const existing = await getApiKeyById(id, userId);
  if (!existing) return false;
  
  // Delete usage records first
  await db.delete(apiKeyUsage)
    .where(eq(apiKeyUsage.apiKeyId, id));
  
  // Delete the key
  await db.delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)));
  
  // Invalidate cache
  await cacheDelete(`key:${existing.keyHash}`, { namespace: CacheNamespaces.API_KEYS });
  
  log.info("API key deleted", { id, userId });
  
  return true;
}

/**
 * Get API key usage stats
 */
export async function getApiKeyUsageStats(
  id: string,
  userId: string,
  options?: {
    startDate?: Date;
    endDate?: Date;
  }
): Promise<{
  totalRequests: number;
  requestsByDay: Array<{ date: string; count: number }>;
  requestsByEndpoint: Array<{ endpoint: string; count: number }>;
  avgResponseTime: number;
  errorRate: number;
}> {
  const apiKey = await getApiKeyById(id, userId);
  if (!apiKey) {
    throw new Error("API key not found");
  }
  
  const startDate = options?.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = options?.endDate || new Date();
  
  const usage = await db.select()
    .from(apiKeyUsage)
    .where(and(
      eq(apiKeyUsage.apiKeyId, id),
      sql`${apiKeyUsage.timestamp} >= ${startDate}`,
      sql`${apiKeyUsage.timestamp} <= ${endDate}`
    ));
  
  // Aggregate
  const byDay = new Map<string, number>();
  const byEndpoint = new Map<string, number>();
  let totalResponseTime = 0;
  let responseTimeCount = 0;
  let errorCount = 0;
  
  for (const record of usage) {
    const day = new Date(record.timestamp).toISOString().split("T")[0];
    byDay.set(day, (byDay.get(day) || 0) + 1);
    byEndpoint.set(record.endpoint, (byEndpoint.get(record.endpoint) || 0) + 1);
    
    if (record.responseTime) {
      totalResponseTime += record.responseTime;
      responseTimeCount++;
    }
    
    if (record.statusCode >= 400) {
      errorCount++;
    }
  }
  
  return {
    totalRequests: usage.length,
    requestsByDay: Array.from(byDay.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    requestsByEndpoint: Array.from(byEndpoint.entries())
      .map(([endpoint, count]) => ({ endpoint, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    avgResponseTime: responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0,
    errorRate: usage.length > 0 ? (errorCount / usage.length) * 100 : 0,
  };
}

