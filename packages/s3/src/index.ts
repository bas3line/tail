import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createLogger } from "@tails/logger";
import crypto from "crypto";

const log = createLogger("s3");

// Validate required environment variables
const requiredEnvVars = ["S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingVars.length > 0 && process.env.NODE_ENV === "production") {
  throw new Error(`Missing required S3 environment variables: ${missingVars.join(", ")}`);
}

// Initialize S3 client with encryption settings
const s3Client = new S3Client({
  region: process.env.S3_REGION || "us-east-1",
  endpoint: process.env.S3_ENDPOINT || undefined,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || "",
    secretAccessKey: process.env.S3_SECRET_KEY || "",
  },
  forcePathStyle: !!process.env.S3_ENDPOINT, // For MinIO/R2 compatibility
});

const defaultBucket = process.env.S3_BUCKET || "tails";

// NEVER expose direct S3 URLs - all access goes through our API
// This ensures we can:
// 1. Track all access
// 2. Enforce authentication
// 3. Apply rate limiting
// 4. Revoke access instantly

/**
 * Generate secure storage key
 * Format: userId/type/year/month/random-hash.ext
 */
export function generateSecureKey(
  userId: string,
  originalName: string,
  type: "files" | "media" | "pastes" = "files"
): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(16).toString("hex");
  const ext = originalName.split(".").pop()?.toLowerCase() || "";
  const sanitizedExt = ext.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);
  
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  
  const hash = crypto.createHash("sha256")
    .update(`${userId}:${timestamp}:${random}`)
    .digest("hex")
    .slice(0, 32);
  
  return sanitizedExt 
    ? `${type}/${userId}/${year}/${month}/${hash}.${sanitizedExt}`
    : `${type}/${userId}/${year}/${month}/${hash}`;
}

export interface UploadOptions {
  key: string;
  body: Buffer | Uint8Array | ReadableStream<Uint8Array>;
  contentType: string;
  bucket?: string;
  metadata?: Record<string, string>;
}

export interface UploadResult {
  key: string;
  bucket: string;
  size: number;
  etag?: string;
}

/**
 * Upload file to S3 with server-side encryption
 * ALL files are private - no public access
 */
export async function uploadFile(options: UploadOptions): Promise<UploadResult> {
  const bucket = options.bucket || defaultBucket;
  
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: options.key,
    Body: options.body,
    ContentType: options.contentType,
    Metadata: {
      ...options.metadata,
      uploadedAt: new Date().toISOString(),
    },
    // Security: Always private, always encrypted
    ACL: "private",
    ServerSideEncryption: "AES256",
    // Prevent caching of sensitive data
    CacheControl: "private, no-cache, no-store, must-revalidate",
  });

  const result = await s3Client.send(command);
  
  // Calculate size
  let size = 0;
  if (Buffer.isBuffer(options.body)) {
    size = options.body.length;
  } else if (options.body instanceof Uint8Array) {
    size = options.body.length;
  }

  log.info("File uploaded (encrypted)", { 
    key: options.key, 
    bucket, 
    size,
    encryption: "AES256"
  });

  return {
    key: options.key,
    bucket,
    size,
    etag: result.ETag,
  };
}

/**
 * Get presigned URL for direct upload (browser upload)
 * Still private - only for authenticated users
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  options?: {
    bucket?: string;
    expiresIn?: number; // Max 1 hour
    maxSize?: number;
  }
): Promise<{ url: string; key: string; expiresAt: Date }> {
  const bucket = options?.bucket || defaultBucket;
  // Short expiration for security - max 1 hour
  const expiresIn = Math.min(options?.expiresIn || 900, 3600);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ACL: "private",
    ServerSideEncryption: "AES256",
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn });
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  
  log.debug("Presigned upload URL generated", { key, expiresIn });

  return { url, key, expiresAt };
}

/**
 * Get file as buffer (for streaming through our API)
 * NEVER return direct S3 URLs
 */
export async function getFileBuffer(
  key: string,
  bucket?: string
): Promise<{ buffer: Buffer; contentType: string; contentLength: number } | null> {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket || defaultBucket,
      Key: key,
    });

    const response = await s3Client.send(command);
    
    if (!response.Body) {
      return null;
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    const reader = response.Body.transformToWebStream().getReader();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    
    const buffer = Buffer.concat(chunks);

    return {
      buffer,
      contentType: response.ContentType || "application/octet-stream",
      contentLength: response.ContentLength || buffer.length,
    };
  } catch (error: any) {
    if (error.name === "NoSuchKey") {
      return null;
    }
    throw error;
  }
}

/**
 * Get file stream (for large files)
 * Stream through our API - never expose S3 directly
 */
export async function getFileStream(
  key: string,
  bucket?: string,
  range?: { start: number; end: number }
): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  contentLength: number;
  contentRange?: string;
} | null> {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket || defaultBucket,
      Key: key,
      Range: range ? `bytes=${range.start}-${range.end}` : undefined,
    });

    const response = await s3Client.send(command);
    
    if (!response.Body) {
      return null;
    }

    return {
      stream: response.Body.transformToWebStream(),
      contentType: response.ContentType || "application/octet-stream",
      contentLength: response.ContentLength || 0,
      contentRange: response.ContentRange,
    };
  } catch (error: any) {
    if (error.name === "NoSuchKey") {
      return null;
    }
    throw error;
  }
}

/**
 * Get file metadata without downloading
 */
export async function getFileMetadata(
  key: string,
  bucket?: string
): Promise<{
  contentType: string;
  contentLength: number;
  lastModified: Date;
  metadata: Record<string, string>;
  encryption: string;
} | null> {
  try {
    const command = new HeadObjectCommand({
      Bucket: bucket || defaultBucket,
      Key: key,
    });

    const response = await s3Client.send(command);
    
    return {
      contentType: response.ContentType || "application/octet-stream",
      contentLength: response.ContentLength || 0,
      lastModified: response.LastModified || new Date(),
      metadata: response.Metadata || {},
      encryption: response.ServerSideEncryption || "none",
    };
  } catch (error: any) {
    if (error.name === "NotFound" || error.name === "NoSuchKey") {
      return null;
    }
    throw error;
  }
}

/**
 * Delete single file
 */
export async function deleteFile(key: string, bucket?: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: bucket || defaultBucket,
    Key: key,
  });

  await s3Client.send(command);
  log.info("File deleted", { key });
}

/**
 * Delete multiple files
 */
export async function deleteFiles(
  keys: string[],
  bucket?: string
): Promise<void> {
  if (keys.length === 0) return;

  // S3 allows max 1000 objects per request
  const batches: string[][] = [];
  for (let i = 0; i < keys.length; i += 1000) {
    batches.push(keys.slice(i, i + 1000));
  }

  for (const batch of batches) {
    const command = new DeleteObjectsCommand({
      Bucket: bucket || defaultBucket,
      Delete: {
        Objects: batch.map((key) => ({ Key: key })),
        Quiet: true,
      },
    });

    await s3Client.send(command);
  }
  
  log.info("Files deleted", { count: keys.length });
}

/**
 * List files with prefix (for user's files)
 */
export async function listFiles(
  prefix: string,
  options?: {
    bucket?: string;
    maxKeys?: number;
    continuationToken?: string;
  }
): Promise<{
  files: Array<{ key: string; size: number; lastModified: Date }>;
  nextToken?: string;
}> {
  const command = new ListObjectsV2Command({
    Bucket: options?.bucket || defaultBucket,
    Prefix: prefix,
    MaxKeys: options?.maxKeys || 1000,
    ContinuationToken: options?.continuationToken,
  });

  const response = await s3Client.send(command);

  return {
    files: (response.Contents || []).map((obj) => ({
      key: obj.Key!,
      size: obj.Size || 0,
      lastModified: obj.LastModified || new Date(),
    })),
    nextToken: response.NextContinuationToken,
  };
}

/**
 * Copy file (for duplicating)
 */
export async function copyFile(
  sourceKey: string,
  destinationKey: string,
  options?: {
    sourceBucket?: string;
    destinationBucket?: string;
  }
): Promise<void> {
  const sourceBucket = options?.sourceBucket || defaultBucket;
  const destBucket = options?.destinationBucket || defaultBucket;

  const command = new CopyObjectCommand({
    Bucket: destBucket,
    Key: destinationKey,
    CopySource: encodeURIComponent(`${sourceBucket}/${sourceKey}`),
    ServerSideEncryption: "AES256",
    ACL: "private",
  });

  await s3Client.send(command);
  log.info("File copied", { from: sourceKey, to: destinationKey });
}

/**
 * Check if file exists
 */
export async function fileExists(key: string, bucket?: string): Promise<boolean> {
  const metadata = await getFileMetadata(key, bucket);
  return metadata !== null;
}

/**
 * Get total storage used by prefix (user)
 */
export async function getStorageUsed(prefix: string, bucket?: string): Promise<number> {
  let totalSize = 0;
  let continuationToken: string | undefined;

  do {
    const result = await listFiles(prefix, {
      bucket,
      maxKeys: 1000,
      continuationToken,
    });
    
    totalSize += result.files.reduce((sum, f) => sum + f.size, 0);
    continuationToken = result.nextToken;
  } while (continuationToken);

  return totalSize;
}

export { s3Client, defaultBucket as bucket };
