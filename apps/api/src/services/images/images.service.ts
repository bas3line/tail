import { createLogger } from "@tails/logger";
import { getImagePool } from "../../workers";

const log = createLogger("images-service");

// Supported formats
export const SUPPORTED_INPUT_FORMATS = ["jpeg", "jpg", "png", "gif", "webp", "avif", "tiff", "svg"];
export const SUPPORTED_OUTPUT_FORMATS = ["jpeg", "png", "webp", "avif", "gif", "tiff"] as const;
export type OutputFormat = typeof SUPPORTED_OUTPUT_FORMATS[number];

export interface ImageInfo {
  width: number;
  height: number;
  format: string;
  size: number;
  hasAlpha: boolean;
}

export interface ResizeOptions {
  width?: number;
  height?: number;
  fit?: "cover" | "contain" | "fill" | "inside" | "outside";
  position?: "top" | "right top" | "right" | "right bottom" | "bottom" | "left bottom" | "left" | "left top" | "center";
  background?: string;
}

export interface CompressOptions {
  quality?: number; // 1-100
  format?: OutputFormat;
}

export interface ConvertOptions {
  format: OutputFormat;
  quality?: number;
}

export interface WatermarkOptions {
  text?: string;
  image?: Buffer;
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
  opacity?: number;
}

/**
 * Get image information using worker
 */
export async function getImageInfo(buffer: Buffer): Promise<ImageInfo> {
  const pool = getImagePool();
  return pool.execute<{ buffer: Buffer }, ImageInfo>("info", { buffer });
}

/**
 * Resize image using worker
 */
export async function resizeImage(
  buffer: Buffer,
  options: ResizeOptions
): Promise<Buffer> {
  const pool = getImagePool();
  return pool.execute<ResizeOptions & { buffer: Buffer }, Buffer>("resize", {
    buffer,
    ...options,
  });
}

/**
 * Compress image using worker
 */
export async function compressImage(
  buffer: Buffer,
  options: CompressOptions = {}
): Promise<{ buffer: Buffer; format: string }> {
  const pool = getImagePool();
  return pool.execute<CompressOptions & { buffer: Buffer }, { buffer: Buffer; format: string }>("compress", {
    buffer,
    ...options,
  });
}

/**
 * Convert image format using worker
 */
export async function convertImage(
  buffer: Buffer,
  options: ConvertOptions
): Promise<Buffer> {
  const pool = getImagePool();
  return pool.execute<ConvertOptions & { buffer: Buffer }, Buffer>("convert", {
    buffer,
    ...options,
  });
}

/**
 * Optimize image for web (auto WebP/AVIF) using worker
 */
export async function optimizeForWeb(
  buffer: Buffer,
  options: { maxWidth?: number; maxHeight?: number; quality?: number } = {}
): Promise<{ webp: Buffer; avif: Buffer; original: Buffer }> {
  const pool = getImagePool();
  return pool.execute<typeof options & { buffer: Buffer }, { webp: Buffer; avif: Buffer; original: Buffer }>("optimize", {
    buffer,
    ...options,
  });
}

/**
 * Generate thumbnail using worker
 */
export async function generateThumbnail(
  buffer: Buffer,
  size: number = 200
): Promise<Buffer> {
  const pool = getImagePool();
  return pool.execute<{ buffer: Buffer; size: number }, Buffer>("thumbnail", {
    buffer,
    size,
  });
}

/**
 * Rotate image using worker
 */
export async function rotateImage(
  buffer: Buffer,
  angle: number,
  background?: string
): Promise<Buffer> {
  const pool = getImagePool();
  return pool.execute<{ buffer: Buffer; angle: number; background?: string }, Buffer>("rotate", {
    buffer,
    angle,
    background,
  });
}

/**
 * Flip/Mirror image using worker
 */
export async function flipImage(
  buffer: Buffer,
  direction: "horizontal" | "vertical"
): Promise<Buffer> {
  const pool = getImagePool();
  return pool.execute<{ buffer: Buffer; direction: string }, Buffer>("flip", {
    buffer,
    direction,
  });
}

/**
 * Crop image using worker
 */
export async function cropImage(
  buffer: Buffer,
  options: { left: number; top: number; width: number; height: number }
): Promise<Buffer> {
  const pool = getImagePool();
  return pool.execute<{ buffer: Buffer; left: number; top: number; width: number; height: number }, Buffer>("crop", {
    buffer,
    ...options,
  });
}

/**
 * Process image with multiple operations
 */
export async function processImage(
  buffer: Buffer,
  operations: Array<{
    type: "resize" | "compress" | "convert" | "rotate" | "flip" | "crop";
    options: any;
  }>
): Promise<Buffer> {
  let result = buffer;
  
  for (const op of operations) {
    switch (op.type) {
      case "resize":
        result = await resizeImage(result, op.options);
        break;
      case "compress":
        const compressed = await compressImage(result, op.options);
        result = compressed.buffer;
        break;
      case "convert":
        result = await convertImage(result, op.options);
        break;
      case "rotate":
        result = await rotateImage(result, op.options.angle, op.options.background);
        break;
      case "flip":
        result = await flipImage(result, op.options.direction);
        break;
      case "crop":
        result = await cropImage(result, op.options);
        break;
    }
  }
  
  return result;
}

/**
 * Bulk process images in parallel using worker pool
 */
export async function bulkProcess(
  buffers: Buffer[],
  operation: (buffer: Buffer) => Promise<Buffer>
): Promise<Buffer[]> {
  // Worker pool handles parallelization automatically
  return Promise.all(buffers.map(operation));
}

// MIME type helpers
export function getFormatMimeType(format: OutputFormat): string {
  const mimeTypes: Record<OutputFormat, string> = {
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    avif: "image/avif",
    gif: "image/gif",
    tiff: "image/tiff",
  };
  return mimeTypes[format] || "application/octet-stream";
}

export function getFormatExtension(format: OutputFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

/**
 * Get worker pool statistics
 */
export function getPoolStats() {
  const pool = getImagePool();
  return pool.getStats();
}
