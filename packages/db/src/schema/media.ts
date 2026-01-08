import { pgTable, text, timestamp, integer, boolean, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { user } from "./users";

export const mediaTypeEnum = pgEnum("media_type", ["image", "video", "audio", "document"]);

export const media = pgTable("media", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  
  // Media info
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  type: mediaTypeEnum("type").notNull(),
  size: integer("size").notNull(),
  
  // S3 storage
  key: text("key").notNull().unique(),
  bucket: text("bucket").notNull(),
  
  // URLs
  url: text("url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  
  // Image specific
  width: integer("width"),
  height: integer("height"),
  
  // Optimized versions (JSON: { "webp": "url", "avif": "url", "thumb": "url" })
  variants: text("variants"),
  
  // Alt text for accessibility
  alt: text("alt"),
  
  // Folder organization
  folderId: text("folder_id"),
  
  // Stats
  views: integer("views").default(0).notNull(),
  
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;

