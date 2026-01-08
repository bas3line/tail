import { db, files, folders, type File, type NewFile, type Folder, type NewFolder, eq, and, isNull, desc, asc, sql } from "@tails/db";
import { uploadFile, deleteFile, generateSecureKey, getFileBuffer } from "@tails/s3";
import { cacheGet, cacheSet, cacheDelete, CacheNamespaces } from "@tails/cache";
import { createLogger } from "@tails/logger";
import crypto from "crypto";

const log = createLogger("files-service");

const CACHE_CONFIG = {
  namespace: CacheNamespaces.FILES,
  memoryTTL: 60,
  redisTTL: 300,
};

// Password hashing for protected files
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

export interface CreateFileInput {
  userId: string;
  file: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    size: number;
  };
  folderId?: string;
  visibility?: "private" | "unlisted" | "public";
  password?: string;
  expiresAt?: Date;
}

export interface UpdateFileInput {
  visibility?: "private" | "unlisted" | "public";
  password?: string | null;
  folderId?: string | null;
  expiresAt?: Date | null;
}

/**
 * Upload and create a new file
 */
export async function createFile(input: CreateFileInput): Promise<File> {
  const { userId, file, folderId, visibility = "private", password, expiresAt } = input;
  
  const id = crypto.randomUUID();
  const key = generateSecureKey(userId, file.originalName, "files");
  
  // Upload to S3 (always private, encrypted - no public access)
  const uploadResult = await uploadFile({
    key,
    body: file.buffer,
    contentType: file.mimeType,
    metadata: {
      userId,
      originalName: file.originalName,
    },
  });
  
  // Hash password if provided
  const passwordHash = password ? await hashPassword(password) : null;
  
  // Generate share token for unlisted files
  const shareToken = visibility === "unlisted" 
    ? crypto.randomBytes(16).toString("base64url")
    : null;
  
  // Create database record - URL is always through our API (never direct S3)
  const [newFile] = await db.insert(files).values({
    id,
    userId,
    filename: key.split("/").pop() || key,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    key,
    bucket: uploadResult.bucket,
    url: `/files/${id}`, // Always through our API
    visibility,
    password: passwordHash,
    shareToken,
    folderId,
    encrypted: true,
    expiresAt,
  }).returning();
  
  log.info("File created", { id, userId, size: file.size });
  
  return newFile;
}

/**
 * Get file by ID
 */
export async function getFileById(
  id: string,
  userId?: string
): Promise<File | null> {
  // Try cache first
  const cached = await cacheGet<File>(`file:${id}`, CACHE_CONFIG);
  if (cached) return cached;
  
  const conditions = [eq(files.id, id), isNull(files.deletedAt)];
  if (userId) {
    conditions.push(eq(files.userId, userId));
  }
  
  const [file] = await db.select()
    .from(files)
    .where(and(...conditions))
    .limit(1);
  
  if (file) {
    await cacheSet(`file:${id}`, file, CACHE_CONFIG);
  }
  
  return file || null;
}

/**
 * Get file by share token (for unlisted files)
 */
export async function getFileByShareToken(token: string): Promise<File | null> {
  const [file] = await db.select()
    .from(files)
    .where(and(
      eq(files.shareToken, token),
      isNull(files.deletedAt)
    ))
    .limit(1);
  
  return file || null;
}

/**
 * Verify file password
 */
export async function verifyFilePassword(
  fileId: string,
  password: string
): Promise<boolean> {
  const file = await getFileById(fileId);
  if (!file || !file.password) return false;
  
  return verifyPassword(password, file.password);
}

/**
 * Get file buffer for streaming (no direct S3 URLs)
 */
export async function getFileData(
  file: File
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const data = await getFileBuffer(file.key);
  return data ? { buffer: data.buffer, contentType: data.contentType } : null;
}

/**
 * List user's files
 */
export async function listUserFiles(
  userId: string,
  options?: {
    folderId?: string | null;
    limit?: number;
    offset?: number;
    sortBy?: "createdAt" | "name" | "size";
    sortOrder?: "asc" | "desc";
  }
): Promise<{ files: File[]; total: number }> {
  const { folderId, limit = 50, offset = 0, sortBy = "createdAt", sortOrder = "desc" } = options || {};
  
  const conditions = [
    eq(files.userId, userId),
    isNull(files.deletedAt),
  ];
  
  if (folderId === null) {
    conditions.push(isNull(files.folderId));
  } else if (folderId) {
    conditions.push(eq(files.folderId, folderId));
  }
  
  const orderBy = sortOrder === "desc" 
    ? desc(files[sortBy === "name" ? "originalName" : sortBy])
    : asc(files[sortBy === "name" ? "originalName" : sortBy]);
  
  const [result, countResult] = await Promise.all([
    db.select()
      .from(files)
      .where(and(...conditions))
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` })
      .from(files)
      .where(and(...conditions)),
  ]);
  
  return {
    files: result,
    total: Number(countResult[0]?.count || 0),
  };
}

/**
 * Update file
 */
export async function updateFile(
  id: string,
  userId: string,
  input: UpdateFileInput
): Promise<File | null> {
  const file = await getFileById(id, userId);
  if (!file) return null;
  
  const updates: Partial<NewFile> = {
    updatedAt: new Date(),
  };
  
  if (input.visibility !== undefined) {
    updates.visibility = input.visibility;
    updates.shareToken = input.visibility === "unlisted"
      ? crypto.randomBytes(16).toString("base64url")
      : null;
  }
  
  if (input.password !== undefined) {
    updates.password = input.password 
      ? await hashPassword(input.password)
      : null;
  }
  
  if (input.folderId !== undefined) {
    updates.folderId = input.folderId;
  }
  
  if (input.expiresAt !== undefined) {
    updates.expiresAt = input.expiresAt;
  }
  
  const [updated] = await db.update(files)
    .set(updates)
    .where(and(eq(files.id, id), eq(files.userId, userId)))
    .returning();
  
  // Invalidate cache
  await cacheDelete(`file:${id}`, { namespace: CacheNamespaces.FILES });
  
  log.info("File updated", { id, userId });
  
  return updated || null;
}

/**
 * Soft delete file
 */
export async function deleteFileById(
  id: string,
  userId: string
): Promise<boolean> {
  const file = await getFileById(id, userId);
  if (!file) return false;
  
  // Soft delete in database
  await db.update(files)
    .set({ deletedAt: new Date() })
    .where(and(eq(files.id, id), eq(files.userId, userId)));
  
  // Invalidate cache
  await cacheDelete(`file:${id}`, { namespace: CacheNamespaces.FILES });
  
  log.info("File soft deleted", { id, userId });
  
  return true;
}

/**
 * Permanently delete file (including S3)
 */
export async function permanentlyDeleteFile(
  id: string,
  userId: string
): Promise<boolean> {
  const [file] = await db.select()
    .from(files)
    .where(and(eq(files.id, id), eq(files.userId, userId)))
    .limit(1);
  
  if (!file) return false;
  
  // Delete from S3
  await deleteFile(file.key);
  
  // Delete from database
  await db.delete(files)
    .where(eq(files.id, id));
  
  // Invalidate cache
  await cacheDelete(`file:${id}`, { namespace: CacheNamespaces.FILES });
  
  log.info("File permanently deleted", { id, userId });
  
  return true;
}

/**
 * Increment download count
 */
export async function incrementDownloads(id: string): Promise<void> {
  await db.update(files)
    .set({ downloads: sql`${files.downloads} + 1` })
    .where(eq(files.id, id));
  
  await cacheDelete(`file:${id}`, { namespace: CacheNamespaces.FILES });
}

/**
 * Get user storage usage
 */
export async function getUserStorageUsage(userId: string): Promise<number> {
  const [result] = await db.select({ total: sql<number>`coalesce(sum(${files.size}), 0)` })
    .from(files)
    .where(and(eq(files.userId, userId), isNull(files.deletedAt)));
  
  return Number(result?.total || 0);
}

// Folder operations
export async function createFolder(
  userId: string,
  name: string,
  parentId?: string
): Promise<Folder> {
  const id = crypto.randomUUID();
  
  const [folder] = await db.insert(folders).values({
    id,
    userId,
    name,
    parentId,
  }).returning();
  
  return folder;
}

export async function listFolders(
  userId: string,
  parentId?: string | null
): Promise<Folder[]> {
  const conditions = [eq(folders.userId, userId)];
  
  if (parentId === null) {
    conditions.push(isNull(folders.parentId));
  } else if (parentId) {
    conditions.push(eq(folders.parentId, parentId));
  }
  
  return db.select()
    .from(folders)
    .where(and(...conditions))
    .orderBy(asc(folders.name));
}

export async function deleteFolder(
  id: string,
  userId: string
): Promise<boolean> {
  const result = await db.delete(folders)
    .where(and(eq(folders.id, id), eq(folders.userId, userId)));
  
  return true;
}

