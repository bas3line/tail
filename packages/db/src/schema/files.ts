import { pgTable, text, timestamp, integer, boolean, pgEnum } from "drizzle-orm/pg-core";
import { user } from "./users";

export const fileVisibilityEnum = pgEnum("file_visibility", ["private", "unlisted", "public"]);

export const files = pgTable("files", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  
  // File info
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  
  // S3 storage
  key: text("key").notNull().unique(),
  bucket: text("bucket").notNull(),
  
  // URLs
  url: text("url"), // Public CDN URL if public
  
  // Visibility & sharing
  visibility: fileVisibilityEnum("visibility").default("private").notNull(),
  password: text("password"), // Hashed password for protected files
  shareToken: text("share_token").unique(), // For unlisted sharing
  
  // Folder organization
  folderId: text("folder_id").references((): any => folders.id, { onDelete: "set null" }),
  
  // Encryption
  encrypted: boolean("encrypted").default(false).notNull(),
  encryptionKeyId: text("encryption_key_id"),
  
  // Metadata
  metadata: text("metadata"), // JSON string for extra data
  
  // Stats
  downloads: integer("downloads").default(0).notNull(),
  
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  deletedAt: timestamp("deleted_at"), // Soft delete
});

export const folders = pgTable("folders", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  parentId: text("parent_id").references((): any => folders.id, { onDelete: "cascade" }),
  color: text("color"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;
