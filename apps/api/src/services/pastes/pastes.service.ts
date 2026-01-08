import { db, pastes, type Paste, type NewPaste, eq, and, isNull, desc, sql, or } from "@tails/db";
import { cacheGet, cacheSet, cacheDelete, CacheNamespaces } from "@tails/cache";
import { createLogger } from "@tails/logger";
import crypto from "crypto";

const log = createLogger("pastes-service");

const CACHE_CONFIG = {
  namespace: CacheNamespaces.PASTES,
  memoryTTL: 60,
  redisTTL: 300,
};

// Supported languages for syntax highlighting
export const SUPPORTED_LANGUAGES = [
  "plaintext", "javascript", "typescript", "python", "go", "rust", "java",
  "c", "cpp", "csharp", "php", "ruby", "swift", "kotlin", "scala",
  "html", "css", "scss", "json", "yaml", "xml", "markdown",
  "sql", "graphql", "bash", "powershell", "dockerfile",
  "toml", "ini", "diff", "makefile"
] as const;

export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

// Password hashing
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 64, "sha512", (err, key) => {
      if (err) reject(err);
      resolve(`${salt}:${key.toString("hex")}`);
    });
  });
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(":");
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 64, "sha512", (err, derivedKey) => {
      if (err) reject(err);
      resolve(key === derivedKey.toString("hex"));
    });
  });
}

// Generate short ID for paste
function generatePasteId(): string {
  return crypto.randomBytes(4).toString("base64url");
}

export interface CreatePasteInput {
  userId?: string;
  content: string;
  title?: string;
  language?: SupportedLanguage;
  visibility?: "private" | "unlisted" | "public";
  password?: string;
  expiresAt?: Date;
  burnAfterRead?: boolean;
}

export interface UpdatePasteInput {
  content?: string;
  title?: string;
  language?: SupportedLanguage;
  visibility?: "private" | "unlisted" | "public";
  password?: string | null;
  expiresAt?: Date | null;
}

/**
 * Create a new paste
 */
export async function createPaste(input: CreatePasteInput): Promise<Paste> {
  const { 
    userId, 
    content, 
    title, 
    language = "plaintext", 
    visibility = "unlisted", 
    password, 
    expiresAt,
    burnAfterRead = false 
  } = input;
  
  // Validate content
  if (!content || content.length === 0) {
    throw new Error("Content is required");
  }
  
  if (content.length > 1024 * 1024) { // 1MB limit
    throw new Error("Content too large (max 1MB)");
  }
  
  const id = generatePasteId();
  const passwordHash = password ? await hashPassword(password) : null;
  
  const [paste] = await db.insert(pastes).values({
    id,
    userId,
    content,
    title,
    language,
    visibility,
    password: passwordHash,
    expiresAt,
    burnAfterRead,
    encrypted: false,
  }).returning();
  
  log.info("Paste created", { id, userId, language });
  
  return paste;
}

/**
 * Get paste by ID
 */
export async function getPasteById(id: string): Promise<Paste | null> {
  // Try cache first
  const cached = await cacheGet<Paste>(`paste:${id}`, CACHE_CONFIG);
  if (cached) {
    // Check if expired
    if (cached.expiresAt && new Date(cached.expiresAt) < new Date()) {
      await cacheDelete(`paste:${id}`, { namespace: CacheNamespaces.PASTES });
      return null;
    }
    return cached;
  }
  
  const [paste] = await db.select()
    .from(pastes)
    .where(and(
      eq(pastes.id, id),
      isNull(pastes.deletedAt)
    ))
    .limit(1);
  
  if (!paste) return null;
  
  // Check if expired
  if (paste.expiresAt && new Date(paste.expiresAt) < new Date()) {
    return null;
  }
  
  // Cache if not burn-after-read
  if (!paste.burnAfterRead) {
    await cacheSet(`paste:${id}`, paste, CACHE_CONFIG);
  }
  
  return paste;
}

/**
 * Verify paste password
 */
export async function verifyPastePassword(
  id: string,
  password: string
): Promise<boolean> {
  const paste = await getPasteById(id);
  if (!paste || !paste.password) return false;
  
  return verifyPassword(password, paste.password);
}

/**
 * View paste (increments view count, handles burn-after-read)
 */
export async function viewPaste(id: string): Promise<Paste | null> {
  const paste = await getPasteById(id);
  if (!paste) return null;
  
  // Increment view count
  await db.update(pastes)
    .set({ views: sql`${pastes.views} + 1` })
    .where(eq(pastes.id, id));
  
  // Handle burn-after-read
  if (paste.burnAfterRead) {
    await db.update(pastes)
      .set({ deletedAt: new Date() })
      .where(eq(pastes.id, id));
    
    await cacheDelete(`paste:${id}`, { namespace: CacheNamespaces.PASTES });
    
    log.info("Paste burned after read", { id });
  } else {
    // Invalidate cache to update view count
    await cacheDelete(`paste:${id}`, { namespace: CacheNamespaces.PASTES });
  }
  
  return paste;
}

/**
 * Check if paste is accessible
 */
export function isPasteAccessible(
  paste: Paste,
  userId?: string
): { accessible: boolean; requiresPassword: boolean; reason?: string } {
  // Check expiration
  if (paste.expiresAt && new Date(paste.expiresAt) < new Date()) {
    return { accessible: false, requiresPassword: false, reason: "Paste has expired" };
  }
  
  // Public pastes are always accessible
  if (paste.visibility === "public") {
    return { 
      accessible: true, 
      requiresPassword: !!paste.password 
    };
  }
  
  // Unlisted pastes are accessible with the link
  if (paste.visibility === "unlisted") {
    return { 
      accessible: true, 
      requiresPassword: !!paste.password 
    };
  }
  
  // Private pastes require ownership
  if (paste.visibility === "private") {
    if (!userId || paste.userId !== userId) {
      return { accessible: false, requiresPassword: false, reason: "Paste is private" };
    }
    return { accessible: true, requiresPassword: false };
  }
  
  return { accessible: false, requiresPassword: false };
}

/**
 * List user's pastes
 */
export async function listUserPastes(
  userId: string,
  options?: {
    limit?: number;
    offset?: number;
  }
): Promise<{ pastes: Paste[]; total: number }> {
  const { limit = 50, offset = 0 } = options || {};
  
  const [result, countResult] = await Promise.all([
    db.select()
      .from(pastes)
      .where(and(
        eq(pastes.userId, userId),
        isNull(pastes.deletedAt)
      ))
      .orderBy(desc(pastes.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` })
      .from(pastes)
      .where(and(
        eq(pastes.userId, userId),
        isNull(pastes.deletedAt)
      )),
  ]);
  
  return {
    pastes: result,
    total: Number(countResult[0]?.count || 0),
  };
}

/**
 * List public pastes (for explore/trending)
 */
export async function listPublicPastes(
  options?: {
    limit?: number;
    offset?: number;
    language?: SupportedLanguage;
  }
): Promise<Paste[]> {
  const { limit = 20, offset = 0, language } = options || {};
  
  const conditions = [
    eq(pastes.visibility, "public"),
    isNull(pastes.deletedAt),
    or(
      isNull(pastes.expiresAt),
      sql`${pastes.expiresAt} > now()`
    ),
  ];
  
  if (language) {
    conditions.push(eq(pastes.language, language));
  }
  
  return db.select()
    .from(pastes)
    .where(and(...conditions))
    .orderBy(desc(pastes.createdAt))
    .limit(limit)
    .offset(offset);
}

/**
 * Update paste
 */
export async function updatePaste(
  id: string,
  userId: string,
  input: UpdatePasteInput
): Promise<Paste | null> {
  const [existing] = await db.select()
    .from(pastes)
    .where(and(
      eq(pastes.id, id),
      eq(pastes.userId, userId),
      isNull(pastes.deletedAt)
    ))
    .limit(1);
  
  if (!existing) return null;
  
  const updates: Partial<NewPaste> = {
    updatedAt: new Date(),
  };
  
  if (input.content !== undefined) updates.content = input.content;
  if (input.title !== undefined) updates.title = input.title;
  if (input.language !== undefined) updates.language = input.language;
  if (input.visibility !== undefined) updates.visibility = input.visibility;
  if (input.expiresAt !== undefined) updates.expiresAt = input.expiresAt;
  
  if (input.password !== undefined) {
    updates.password = input.password 
      ? await hashPassword(input.password)
      : null;
  }
  
  const [updated] = await db.update(pastes)
    .set(updates)
    .where(eq(pastes.id, id))
    .returning();
  
  // Invalidate cache
  await cacheDelete(`paste:${id}`, { namespace: CacheNamespaces.PASTES });
  
  log.info("Paste updated", { id, userId });
  
  return updated || null;
}

/**
 * Delete paste
 */
export async function deletePaste(
  id: string,
  userId: string
): Promise<boolean> {
  const [existing] = await db.select()
    .from(pastes)
    .where(and(
      eq(pastes.id, id),
      eq(pastes.userId, userId),
      isNull(pastes.deletedAt)
    ))
    .limit(1);
  
  if (!existing) return false;
  
  await db.update(pastes)
    .set({ deletedAt: new Date() })
    .where(eq(pastes.id, id));
  
  // Invalidate cache
  await cacheDelete(`paste:${id}`, { namespace: CacheNamespaces.PASTES });
  
  log.info("Paste deleted", { id, userId });
  
  return true;
}

/**
 * Get raw paste content
 */
export async function getRawContent(id: string): Promise<string | null> {
  const paste = await getPasteById(id);
  if (!paste) return null;
  
  // Don't allow raw for password-protected pastes
  if (paste.password) return null;
  
  // Don't allow raw for private pastes
  if (paste.visibility === "private") return null;
  
  return paste.content;
}

