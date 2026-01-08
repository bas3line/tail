import { db, media, type Media, type NewMedia, eq, and, isNull, desc, sql } from "@tails/db";
import { uploadFile, deleteFile, getFileBuffer, getFileStream, generateSecureKey, getFileMetadata } from "@tails/s3";
import { cacheGet, cacheSet, cacheDelete, CacheNamespaces } from "@tails/cache";
import { createLogger } from "@tails/logger";
import crypto from "crypto";

const log = createLogger("media-service");

const CACHE_CONFIG = {
  namespace: CacheNamespaces.MEDIA,
  memoryTTL: 120,
  redisTTL: 600,
};

// Allowed MIME types for security
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
];

const ALLOWED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
];

const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
];

const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
];

const ALL_ALLOWED_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_DOCUMENT_TYPES,
  ...ALLOWED_VIDEO_TYPES,
  ...ALLOWED_AUDIO_TYPES,
];

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

function getMediaType(mimeType: string): "image" | "video" | "audio" | "document" {
  if (ALLOWED_IMAGE_TYPES.includes(mimeType)) return "image";
  if (ALLOWED_VIDEO_TYPES.includes(mimeType)) return "video";
  if (ALLOWED_AUDIO_TYPES.includes(mimeType)) return "audio";
  return "document";
}

export interface CreateMediaInput {
  userId: string;
  file: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    size: number;
  };
  alt?: string;
  folderId?: string;
  isPublic?: boolean;
  password?: string;
}

export interface MediaAccessResult {
  accessible: boolean;
  requiresPassword?: boolean;
  reason?: string;
}

/**
 * Upload media file
 */
export async function createMedia(input: CreateMediaInput): Promise<Media> {
  const { userId, file, alt, folderId, isPublic = false, password } = input;
  
  // Validate MIME type
  if (!ALL_ALLOWED_TYPES.includes(file.mimeType)) {
    throw new Error(`File type not allowed: ${file.mimeType}`);
  }
  
  // Validate file size (100MB max)
  if (file.size > 100 * 1024 * 1024) {
    throw new Error("File too large (max 100MB)");
  }
  
  const id = crypto.randomUUID();
  const key = generateSecureKey(userId, file.originalName, "media");
  const mediaType = getMediaType(file.mimeType);
  
  // Upload to S3 (encrypted, private)
  const uploadResult = await uploadFile({
    key,
    body: file.buffer,
    contentType: file.mimeType,
    metadata: {
      userId,
      originalName: file.originalName,
      mediaType,
    },
  });
  
  // Hash password if provided
  const passwordHash = password ? await hashPassword(password) : null;
  
  // Generate public share token if public
  const shareToken = isPublic ? crypto.randomBytes(16).toString("base64url") : null;
  
  // Extract dimensions for images (basic detection)
  let width: number | null = null;
  let height: number | null = null;
  
  // Create database record
  const [newMedia] = await db.insert(media).values({
    id,
    userId,
    filename: key.split("/").pop() || key,
    originalName: file.originalName,
    mimeType: file.mimeType,
    type: mediaType,
    size: file.size,
    key,
    bucket: uploadResult.bucket,
    // Never store direct S3 URL - all access through our API
    url: `/media/${id}`,
    thumbnailUrl: mediaType === "image" ? `/media/${id}/thumb` : null,
    width,
    height,
    alt,
    folderId,
  }).returning();
  
  log.info("Media created", { id, userId, type: mediaType, size: file.size });
  
  return newMedia;
}

/**
 * Get media by ID
 */
export async function getMediaById(id: string): Promise<Media | null> {
  const cached = await cacheGet<Media>(`media:${id}`, CACHE_CONFIG);
  if (cached) return cached;
  
  const [mediaItem] = await db.select()
    .from(media)
    .where(and(eq(media.id, id), isNull(media.deletedAt)))
    .limit(1);
  
  if (mediaItem) {
    await cacheSet(`media:${id}`, mediaItem, CACHE_CONFIG);
  }
  
  return mediaItem || null;
}

/**
 * Check if user can access media
 */
export function checkMediaAccess(
  mediaItem: Media,
  userId?: string,
  apiKey?: boolean
): MediaAccessResult {
  // Owner always has access
  if (userId && mediaItem.userId === userId) {
    return { accessible: true };
  }
  
  // API key access (for integrations)
  if (apiKey) {
    return { accessible: true };
  }
  
  // Public media - check for password
  // Note: We don't have visibility field in current schema, 
  // so we use the presence of a share URL pattern
  
  // For now, non-owners need password if set
  // In production, add a visibility column
  
  return { accessible: false, reason: "Access denied" };
}

/**
 * Verify media password
 */
export async function verifyMediaPassword(
  id: string,
  password: string
): Promise<boolean> {
  const mediaItem = await getMediaById(id);
  if (!mediaItem) return false;
  
  // Check if media has password protection
  // We'd need to add password field to media schema
  // For now, return true for public access
  return true;
}

/**
 * Get media file buffer (for streaming through API)
 */
export async function getMediaBuffer(
  id: string,
  userId?: string,
  apiKey?: boolean
): Promise<{ buffer: Buffer; contentType: string; filename: string } | null> {
  const mediaItem = await getMediaById(id);
  if (!mediaItem) return null;
  
  // Check access
  const access = checkMediaAccess(mediaItem, userId, apiKey);
  if (!access.accessible) {
    return null;
  }
  
  // Get from S3
  const file = await getFileBuffer(mediaItem.key);
  if (!file) return null;
  
  // Increment view count
  await db.update(media)
    .set({ views: sql`${media.views} + 1` })
    .where(eq(media.id, id));
  
  return {
    buffer: file.buffer,
    contentType: file.contentType,
    filename: mediaItem.originalName,
  };
}

/**
 * Get media file stream (for large files)
 */
export async function getMediaStream(
  id: string,
  userId?: string,
  apiKey?: boolean,
  range?: { start: number; end: number }
): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number;
  contentRange?: string;
  filename: string;
} | null> {
  const mediaItem = await getMediaById(id);
  if (!mediaItem) return null;
  
  // Check access
  const access = checkMediaAccess(mediaItem, userId, apiKey);
  if (!access.accessible) {
    return null;
  }
  
  // Get stream from S3
  const file = await getFileStream(mediaItem.key, undefined, range);
  if (!file) return null;
  
  // Increment view count (async)
  db.update(media)
    .set({ views: sql`${media.views} + 1` })
    .where(eq(media.id, id))
    .catch(err => log.error("Failed to update view count", err));
  
  return {
    stream: file.stream,
    contentType: file.contentType,
    contentLength: file.contentLength,
    contentRange: file.contentRange,
    filename: mediaItem.originalName,
  };
}

/**
 * List user's media
 */
export async function listUserMedia(
  userId: string,
  options?: {
    type?: "image" | "video" | "audio" | "document";
    folderId?: string | null;
    limit?: number;
    offset?: number;
  }
): Promise<{ media: Media[]; total: number }> {
  const { type, folderId, limit = 50, offset = 0 } = options || {};
  
  const conditions = [
    eq(media.userId, userId),
    isNull(media.deletedAt),
  ];
  
  if (type) {
    conditions.push(eq(media.type, type));
  }
  
  if (folderId === null) {
    conditions.push(isNull(media.folderId));
  } else if (folderId) {
    conditions.push(eq(media.folderId, folderId));
  }
  
  const [result, countResult] = await Promise.all([
    db.select()
      .from(media)
      .where(and(...conditions))
      .orderBy(desc(media.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` })
      .from(media)
      .where(and(...conditions)),
  ]);
  
  return {
    media: result,
    total: Number(countResult[0]?.count || 0),
  };
}

/**
 * Delete media
 */
export async function deleteMedia(
  id: string,
  userId: string
): Promise<boolean> {
  const mediaItem = await getMediaById(id);
  if (!mediaItem || mediaItem.userId !== userId) {
    return false;
  }
  
  // Soft delete in database
  await db.update(media)
    .set({ deletedAt: new Date() })
    .where(eq(media.id, id));
  
  // Invalidate cache
  await cacheDelete(`media:${id}`, { namespace: CacheNamespaces.MEDIA });
  
  log.info("Media soft deleted", { id, userId });
  
  return true;
}

/**
 * Permanently delete media (including S3)
 */
export async function permanentlyDeleteMedia(
  id: string,
  userId: string
): Promise<boolean> {
  const [mediaItem] = await db.select()
    .from(media)
    .where(and(eq(media.id, id), eq(media.userId, userId)))
    .limit(1);
  
  if (!mediaItem) return false;
  
  // Delete from S3
  await deleteFile(mediaItem.key);
  
  // Delete from database
  await db.delete(media).where(eq(media.id, id));
  
  // Invalidate cache
  await cacheDelete(`media:${id}`, { namespace: CacheNamespaces.MEDIA });
  
  log.info("Media permanently deleted", { id, userId });
  
  return true;
}

/**
 * Get user's storage usage
 */
export async function getUserMediaStorage(userId: string): Promise<number> {
  const [result] = await db.select({ total: sql<number>`coalesce(sum(${media.size}), 0)` })
    .from(media)
    .where(and(eq(media.userId, userId), isNull(media.deletedAt)));
  
  return Number(result?.total || 0);
}

// PDF specific functions
export async function isPDF(id: string): Promise<boolean> {
  const mediaItem = await getMediaById(id);
  return mediaItem?.mimeType === "application/pdf";
}

export async function getPDFBuffer(
  id: string,
  userId?: string,
  apiKey?: boolean
): Promise<{ buffer: Buffer; filename: string } | null> {
  const mediaItem = await getMediaById(id);
  if (!mediaItem || mediaItem.mimeType !== "application/pdf") {
    return null;
  }
  
  const result = await getMediaBuffer(id, userId, apiKey);
  if (!result) return null;
  
  return {
    buffer: result.buffer,
    filename: result.filename,
  };
}

