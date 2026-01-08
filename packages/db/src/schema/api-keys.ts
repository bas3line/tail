import { pgTable, text, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { user } from "./users";

export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  
  // Key details
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(), // Store hashed key
  keyPrefix: text("key_prefix").notNull(), // First 8 chars for display: tails_sk_xxxx
  
  // Permissions (JSON array of allowed scopes)
  scopes: text("scopes").default("[]").notNull(), // ["files:read", "files:write", "links:*"]
  
  // Rate limiting
  rateLimit: integer("rate_limit").default(1000).notNull(), // Requests per hour
  
  // Restrictions
  allowedIps: text("allowed_ips"), // JSON array of allowed IPs/CIDRs
  allowedDomains: text("allowed_domains"), // JSON array of allowed referer domains
  
  // Status
  active: boolean("active").default(true).notNull(),
  expiresAt: timestamp("expires_at"),
  
  // Usage tracking
  lastUsedAt: timestamp("last_used_at"),
  totalRequests: integer("total_requests").default(0).notNull(),
  
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
});

export const apiKeyUsage = pgTable("api_key_usage", {
  id: text("id").primaryKey(),
  apiKeyId: text("api_key_id")
    .notNull()
    .references(() => apiKeys.id, { onDelete: "cascade" }),
  
  // Usage data
  endpoint: text("endpoint").notNull(),
  method: text("method").notNull(),
  statusCode: integer("status_code").notNull(),
  responseTime: integer("response_time"), // ms
  
  // Request info
  ip: text("ip"),
  userAgent: text("user_agent"),
  
  // Timestamp
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type ApiKeyUsage = typeof apiKeyUsage.$inferSelect;
export type NewApiKeyUsage = typeof apiKeyUsage.$inferInsert;

