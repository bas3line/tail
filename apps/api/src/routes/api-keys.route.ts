import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware";
import { createLogger } from "@tails/logger";
import type { AppVariables } from "../types";
import * as apiKeysService from "../services/api-keys";

const log = createLogger("api-keys-route");

const apiKeysRoutes = new Hono<{ Variables: AppVariables }>();

// Validation schemas
const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).optional(),
  rateLimit: z.number().int().min(10).max(100000).optional(),
  allowedIps: z.array(z.string()).optional(),
  allowedDomains: z.array(z.string()).optional(),
  expiresAt: z.string().datetime().optional(),
});

const updateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  scopes: z.array(z.string()).optional(),
  rateLimit: z.number().int().min(10).max(100000).optional(),
  allowedIps: z.array(z.string()).nullable().optional(),
  allowedDomains: z.array(z.string()).nullable().optional(),
  active: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

// Create API key
apiKeysRoutes.post("/", requireAuth, zValidator("json", createApiKeySchema), async (c) => {
  const user = c.get("user");
  const input = c.req.valid("json");
  
  const { apiKey, plainKey } = await apiKeysService.createApiKey({
    userId: user.id,
    ...input,
    scopes: input.scopes as apiKeysService.ApiScope[],
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
  });
  
  return c.json({ 
    success: true, 
    apiKey: {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scopes: JSON.parse(apiKey.scopes),
      rateLimit: apiKey.rateLimit,
      active: apiKey.active,
      createdAt: apiKey.createdAt,
      expiresAt: apiKey.expiresAt,
    },
    key: plainKey,
  }, 201);
});

// List API keys
apiKeysRoutes.get("/", requireAuth, async (c) => {
  const user = c.get("user");
  
  const keys = await apiKeysService.listUserApiKeys(user.id);
  
  return c.json({
    apiKeys: keys.map(k => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      scopes: JSON.parse(k.scopes),
      rateLimit: k.rateLimit,
      active: k.active,
      lastUsedAt: k.lastUsedAt,
      totalRequests: k.totalRequests,
      createdAt: k.createdAt,
      expiresAt: k.expiresAt,
    })),
  });
});

// Get API key by ID
apiKeysRoutes.get("/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  
  const apiKey = await apiKeysService.getApiKeyById(id, user.id);
  if (!apiKey) {
    return c.json({ error: "API key not found" }, 404);
  }
  
  return c.json({ 
    apiKey: {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scopes: JSON.parse(apiKey.scopes),
      rateLimit: apiKey.rateLimit,
      allowedIps: apiKey.allowedIps ? JSON.parse(apiKey.allowedIps) : null,
      allowedDomains: apiKey.allowedDomains ? JSON.parse(apiKey.allowedDomains) : null,
      active: apiKey.active,
      lastUsedAt: apiKey.lastUsedAt,
      totalRequests: apiKey.totalRequests,
      createdAt: apiKey.createdAt,
      expiresAt: apiKey.expiresAt,
    }
  });
});

// Get API key usage stats
apiKeysRoutes.get("/:id/usage", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  
  try {
    const stats = await apiKeysService.getApiKeyUsageStats(id, user.id, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
    
    return c.json(stats);
  } catch (error) {
    if (error instanceof Error && error.message === "API key not found") {
      return c.json({ error: "API key not found" }, 404);
    }
    throw error;
  }
});

// Update API key
apiKeysRoutes.patch("/:id", requireAuth, zValidator("json", updateApiKeySchema), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const input = c.req.valid("json");
  
  const updated = await apiKeysService.updateApiKey(id, user.id, {
    ...input,
    scopes: input.scopes as apiKeysService.ApiScope[],
    expiresAt: input.expiresAt === null 
      ? null 
      : input.expiresAt 
        ? new Date(input.expiresAt) 
        : undefined,
  });
  
  if (!updated) {
    return c.json({ error: "API key not found" }, 404);
  }
  
  return c.json({ 
    apiKey: {
      id: updated.id,
      name: updated.name,
      keyPrefix: updated.keyPrefix,
      scopes: JSON.parse(updated.scopes),
      rateLimit: updated.rateLimit,
      active: updated.active,
      expiresAt: updated.expiresAt,
    }
  });
});

// Revoke API key
apiKeysRoutes.post("/:id/revoke", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  
  const revoked = await apiKeysService.revokeApiKey(id, user.id);
  if (!revoked) {
    return c.json({ error: "API key not found" }, 404);
  }
  
  return c.json({ success: true });
});

// Delete API key permanently
apiKeysRoutes.delete("/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  
  const deleted = await apiKeysService.deleteApiKey(id, user.id);
  if (!deleted) {
    return c.json({ error: "API key not found" }, 404);
  }
  
  return c.json({ success: true });
});

// Get available scopes
apiKeysRoutes.get("/meta/scopes", async (c) => {
  return c.json({ scopes: apiKeysService.API_SCOPES });
});

export { apiKeysRoutes };
