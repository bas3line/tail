import { pgTable, text, timestamp, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { user } from "./users";

export const links = pgTable("links", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  
  // Link details
  slug: text("slug").notNull().unique(),
  url: text("url").notNull(),
  title: text("title"),
  description: text("description"),
  
  // Customization
  customDomain: text("custom_domain"),

  // Settings
  active: boolean("active").default(true).notNull(),
  redirectType: integer("redirect_type").default(302).notNull(),
  expiresAt: timestamp("expires_at"),
  startsAt: timestamp("starts_at"),
  timezone: text("timezone"),
  gracePeriod: integer("grace_period"),
  autoArchive: boolean("auto_archive").default(false).notNull(),
  maxClicks: integer("max_clicks"),
  
  // Analytics
  clicks: integer("clicks").default(0).notNull(),
  
  // UTM & tracking
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  
  // Metadata
  metadata: text("metadata"), // JSON
  ogTitle: text("og_title"),
  ogDescription: text("og_description"),
  ogImage: text("og_image"),
  ogImageWidth: integer("og_image_width"),
  ogImageHeight: integer("og_image_height"),
  metadataFetchedAt: timestamp("metadata_fetched_at"),
  metadataError: text("metadata_error"),

  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ({
  // Critical index for slug lookups (redirect performance)
  slugIdx: index("links_slug_idx").on(table.slug),
  // Index for user queries with soft delete filter
  userIdDeletedAtIdx: index("links_user_id_deleted_at_idx").on(table.userId, table.deletedAt),
  // Index for active link queries
  activeIdx: index("links_active_idx").on(table.active),
  // Composite index for user's active links
  userIdActiveIdx: index("links_user_id_active_idx").on(table.userId, table.active),
  // Index for redirect type queries
  redirectTypeIdx: index("links_redirect_type_idx").on(table.redirectType),
  // Indexes for advanced expiry
  startsAtIdx: index("links_starts_at_idx").on(table.startsAt),
  expiresAtIdx: index("links_expires_at_idx").on(table.expiresAt),
}));

export const linkClicks = pgTable("link_clicks", {
  id: text("id").primaryKey(),
  linkId: text("link_id")
    .notNull()
    .references(() => links.id, { onDelete: "cascade" }),
  
  // Analytics data
  ip: text("ip"), // Hashed for privacy
  userAgent: text("user_agent"),
  referer: text("referer"),
  country: text("country"),
  city: text("city"),
  device: text("device"),
  browser: text("browser"),
  os: text("os"),
  sessionId: text("session_id"),
  hour: integer("hour"),
  variantId: text("variant_id"),

  // Timestamp
  clickedAt: timestamp("clicked_at").defaultNow().notNull(),
}, (table) => ({
  // Index for analytics queries
  linkIdClickedAtIdx: index("link_clicks_link_id_clicked_at_idx").on(table.linkId, table.clickedAt),
  // Index for time-based queries
  clickedAtIdx: index("link_clicks_clicked_at_idx").on(table.clickedAt),
  // Indexes for enhanced analytics
  sessionIdIdx: index("link_clicks_session_id_idx").on(table.sessionId),
  hourIdx: index("link_clicks_hour_idx").on(table.hour),
  variantIdIdx: index("link_clicks_variant_id_idx").on(table.variantId),
}));

// Tags table
export const tags = pgTable("tags", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("tags_user_id_idx").on(table.userId),
  // Unique constraint for user + tag name
  uniqueUserTag: index("tags_user_id_name_unique").on(table.userId, table.name),
}));

// Link tags junction table
export const linkTags = pgTable("link_tags", {
  linkId: text("link_id")
    .notNull()
    .references(() => links.id, { onDelete: "cascade" }),
  tagId: text("tag_id")
    .notNull()
    .references(() => tags.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  pk: index("link_tags_pk").on(table.linkId, table.tagId),
  linkIdIdx: index("link_tags_link_id_idx").on(table.linkId),
  tagIdIdx: index("link_tags_tag_id_idx").on(table.tagId),
}));

// Routing rules table for geo-based routing
export const linkRoutingRules = pgTable("link_routing_rules", {
  id: text("id").primaryKey(),
  linkId: text("link_id")
    .notNull()
    .references(() => links.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "geo"
  priority: integer("priority").default(0).notNull(),
  countries: text("countries"), // JSON array: ["US", "CA", "GB"]
  destinationUrl: text("destination_url").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  linkIdIdx: index("link_routing_rules_link_id_idx").on(table.linkId),
  priorityIdx: index("link_routing_rules_priority_idx").on(table.priority),
}));

// A/B testing variants table
export const linkVariants = pgTable("link_variants", {
  id: text("id").primaryKey(),
  linkId: text("link_id")
    .notNull()
    .references(() => links.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  destinationUrl: text("destination_url").notNull(),
  weight: integer("weight").default(50).notNull(), // Percentage: 0-100
  clicks: integer("clicks").default(0).notNull(),
  conversions: integer("conversions").default(0),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  linkIdIdx: index("link_variants_link_id_idx").on(table.linkId),
  activeIdx: index("link_variants_active_idx").on(table.active),
}));

// Link aliases table (multiple slugs → same link)
export const linkAliases = pgTable("link_aliases", {
  id: text("id").primaryKey(),
  linkId: text("link_id")
    .notNull()
    .references(() => links.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  linkIdIdx: index("link_aliases_link_id_idx").on(table.linkId),
  slugIdx: index("link_aliases_slug_idx").on(table.slug),
}));

export type Link = typeof links.$inferSelect;
export type NewLink = typeof links.$inferInsert;
export type LinkClick = typeof linkClicks.$inferSelect;
export type NewLinkClick = typeof linkClicks.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type LinkTag = typeof linkTags.$inferSelect;
export type NewLinkTag = typeof linkTags.$inferInsert;
export type LinkRoutingRule = typeof linkRoutingRules.$inferSelect;
export type NewLinkRoutingRule = typeof linkRoutingRules.$inferInsert;
export type LinkVariant = typeof linkVariants.$inferSelect;
export type NewLinkVariant = typeof linkVariants.$inferInsert;
export type LinkAlias = typeof linkAliases.$inferSelect;
export type NewLinkAlias = typeof linkAliases.$inferInsert;

