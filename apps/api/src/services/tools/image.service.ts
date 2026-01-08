import { createLogger } from "@tails/logger";
import { getImagePool } from "../../workers";

const log = createLogger("image-tools");

export interface ImageCompressOptions {
  quality?: number; // 1-100
  format?: "jpeg" | "webp" | "png";
}

export interface ImageResizeOptions {
  width?: number;
  height?: number;
  fit?: "cover" | "contain" | "fill" | "inside" | "outside";
  format?: "jpeg" | "webp" | "png";
}

export interface ImageConvertOptions {
  format: "jpeg" | "webp" | "png" | "gif";
  quality?: number;
}

/**
 * Compress an image
 */
export async function compressImage(
  buffer: Buffer,
  options: ImageCompressOptions = {}
): Promise<{ buffer: Buffer; size: number; originalSize: number }> {
  const originalSize = buffer.length;

  try {
    const pool = getImagePool();
    const result = await pool.execute<any, { buffer: Buffer }>("processImage", {
      buffer,
      operation: "compress",
      options: {
        quality: options.quality || 80,
        format: options.format || "jpeg",
      },
    });

    log.info("Image compressed", {
      originalSize,
      compressedSize: result.buffer.length,
      ratio: ((1 - result.buffer.length / originalSize) * 100).toFixed(2) + "%",
    });

    return {
      buffer: result.buffer,
      size: result.buffer.length,
      originalSize,
    };
  } catch (error) {
    log.error("Image compression failed", error as Error);
    throw new Error("Failed to compress image");
  }
}

/**
 * Resize an image
 */
export async function resizeImage(
  buffer: Buffer,
  options: ImageResizeOptions
): Promise<{ buffer: Buffer; width: number; height: number }> {
  if (!options.width && !options.height) {
    throw new Error("Either width or height must be specified");
  }

  try {
    const pool = getImagePool();
    const result = await pool.execute<any, { buffer: Buffer; width: number; height: number }>("processImage", {
      buffer,
      operation: "resize",
      options: {
        width: options.width,
        height: options.height,
        fit: options.fit || "cover",
        format: options.format || "jpeg",
      },
    });

    log.info("Image resized", {
      originalSize: buffer.length,
      newSize: result.buffer.length,
      width: result.width,
      height: result.height,
    });

    return {
      buffer: result.buffer,
      width: result.width,
      height: result.height,
    };
  } catch (error) {
    log.error("Image resize failed", error as Error);
    throw new Error("Failed to resize image");
  }
}

/**
 * Convert image format
 */
export async function convertImage(
  buffer: Buffer,
  options: ImageConvertOptions
): Promise<{ buffer: Buffer; format: string; size: number }> {
  try {
    const pool = getImagePool();
    const result = await pool.execute<any, { buffer: Buffer }>("processImage", {
      buffer,
      operation: "convert",
      options: {
        format: options.format,
        quality: options.quality || 85,
      },
    });

    log.info("Image converted", {
      targetFormat: options.format,
      size: result.buffer.length,
    });

    return {
      buffer: result.buffer,
      format: options.format,
      size: result.buffer.length,
    };
  } catch (error) {
    log.error("Image conversion failed", error as Error);
    throw new Error("Failed to convert image");
  }
}

/**
 * Get image metadata
 */
export async function getImageMetadata(buffer: Buffer): Promise<{
  format: string;
  width: number;
  height: number;
  size: number;
  hasAlpha: boolean;
}> {
  try {
    const pool = getImagePool();
    const result = await pool.execute<any, { format: string; width: number; height: number; hasAlpha: boolean }>("processImage", {
      buffer,
      operation: "metadata",
    });

    return {
      format: result.format,
      width: result.width,
      height: result.height,
      size: buffer.length,
      hasAlpha: result.hasAlpha,
    };
  } catch (error) {
    log.error("Failed to get image metadata", error as Error);
    throw new Error("Failed to get image metadata");
  }
}

/**
 * Validate image buffer
 */
export function validateImageBuffer(buffer: Buffer, maxSize: number = 10 * 1024 * 1024): void {
  if (!buffer || buffer.length === 0) {
    throw new Error("Image buffer is empty");
  }

  if (buffer.length > maxSize) {
    throw new Error(`Image too large. Maximum size is ${(maxSize / 1024 / 1024).toFixed(0)}MB`);
  }

  // Check if it's a valid image format by checking magic numbers
  const magicNumbers = buffer.slice(0, 12);
  const isPNG = magicNumbers[0] === 0x89 && magicNumbers[1] === 0x50;
  const isJPEG = magicNumbers[0] === 0xff && magicNumbers[1] === 0xd8;
  const isGIF = magicNumbers[0] === 0x47 && magicNumbers[1] === 0x49;
  const isWebP = magicNumbers[8] === 0x57 && magicNumbers[9] === 0x45;

  if (!isPNG && !isJPEG && !isGIF && !isWebP) {
    throw new Error("Invalid image format. Supported formats: PNG, JPEG, GIF, WebP");
  }
}
