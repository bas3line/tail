import { pgTable, text, timestamp, integer, boolean, pgEnum } from "drizzle-orm/pg-core";
import { user } from "./users";

export const pasteVisibilityEnum = pgEnum("paste_visibility", ["private", "unlisted", "public"]);

export const pastes = pgTable("pastes", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .references(() => user.id, { onDelete: "cascade" }), // Can be null for anonymous
  
  // Paste details
  title: text("title"),
  content: text("content").notNull(),
  language: text("language").default("plaintext").notNull(),
  
  // Visibility & sharing
  visibility: pasteVisibilityEnum("visibility").default("unlisted").notNull(),
  password: text("password"), // Hashed
  
  // Settings
  expiresAt: timestamp("expires_at"),
  burnAfterRead: boolean("burn_after_read").default(false).notNull(),
  
  // Encryption
  encrypted: boolean("encrypted").default(false).notNull(),
  
  // Stats
  views: integer("views").default(0).notNull(),
  
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export type Paste = typeof pastes.$inferSelect;
export type NewPaste = typeof pastes.$inferInsert;

