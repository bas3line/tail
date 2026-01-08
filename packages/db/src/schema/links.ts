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
  password: text("password"), // Hashed
  
  // Settings
  active: boolean("active").default(true).notNull(),
  expiresAt: timestamp("expires_at"),
  maxClicks: integer("max_clicks"),
  
  // Analytics
  clicks: integer("clicks").default(0).notNull(),
  
  // UTM & tracking
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  
  // Metadata
  metadata: text("metadata"), // JSON
  
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
  
  // Timestamp
  clickedAt: timestamp("clicked_at").defaultNow().notNull(),
}, (table) => ({
  // Index for analytics queries
  linkIdClickedAtIdx: index("link_clicks_link_id_clicked_at_idx").on(table.linkId, table.clickedAt),
  // Index for time-based queries
  clickedAtIdx: index("link_clicks_clicked_at_idx").on(table.clickedAt),
}));

export type Link = typeof links.$inferSelect;
export type NewLink = typeof links.$inferInsert;
export type LinkClick = typeof linkClicks.$inferSelect;
export type NewLinkClick = typeof linkClicks.$inferInsert;

