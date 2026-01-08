import { pgTable, text, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
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
});

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
});

export type Link = typeof links.$inferSelect;
export type NewLink = typeof links.$inferInsert;
export type LinkClick = typeof linkClicks.$inferSelect;
export type NewLinkClick = typeof linkClicks.$inferInsert;

