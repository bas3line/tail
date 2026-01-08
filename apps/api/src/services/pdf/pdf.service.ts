import { createLogger } from "@tails/logger";
import { getPdfPool } from "../../workers";

const log = createLogger("pdf-service");

export interface PDFInfo {
  pageCount: number;
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
  modificationDate?: Date;
}

/**
 * Get PDF information using worker
 */
export async function getPDFInfo(buffer: Buffer): Promise<PDFInfo> {
  const pool = getPdfPool();
  return pool.execute<{ buffer: Buffer }, PDFInfo>("info", { buffer });
}

/**
 * Merge multiple PDFs into one using worker
 */
export async function mergePDFs(buffers: Buffer[]): Promise<Buffer> {
  const pool = getPdfPool();
  return pool.execute<{ buffers: Buffer[] }, Buffer>("merge", { buffers });
}

/**
 * Split PDF into individual pages using worker
 */
export async function splitPDF(buffer: Buffer): Promise<Buffer[]> {
  const pool = getPdfPool();
  return pool.execute<{ buffer: Buffer }, Buffer[]>("split", { buffer });
}

/**
 * Extract specific pages from PDF using worker
 */
export async function extractPages(
  buffer: Buffer,
  pageNumbers: number[]
): Promise<Buffer> {
  const pool = getPdfPool();
  return pool.execute<{ buffer: Buffer; pages: number[] }, Buffer>("extract", {
    buffer,
    pages: pageNumbers,
  });
}

/**
 * Remove specific pages from PDF using worker
 */
export async function removePages(
  buffer: Buffer,
  pageNumbers: number[]
): Promise<Buffer> {
  const pool = getPdfPool();
  return pool.execute<{ buffer: Buffer; pages: number[] }, Buffer>("remove", {
    buffer,
    pages: pageNumbers,
  });
}

/**
 * Rotate PDF pages using worker
 */
export async function rotatePDF(
  buffer: Buffer,
  degrees: 90 | 180 | 270,
  pageNumbers?: number[]
): Promise<Buffer> {
  const pool = getPdfPool();
  return pool.execute<{ buffer: Buffer; degrees: number; pages?: number[] }, Buffer>("rotate", {
    buffer,
    degrees,
    pages: pageNumbers,
  });
}

/**
 * Add watermark to PDF using worker
 */
export async function addWatermarkToPDF(
  buffer: Buffer,
  text: string,
  options: {
    fontSize?: number;
    opacity?: number;
    color?: { r: number; g: number; b: number };
    rotation?: number;
  } = {}
): Promise<Buffer> {
  const pool = getPdfPool();
  return pool.execute<{
    buffer: Buffer;
    text: string;
    fontSize?: number;
    opacity?: number;
    color?: { r: number; g: number; b: number };
    rotation?: number;
  }, Buffer>("watermark", {
    buffer,
    text,
    ...options,
  });
}

/**
 * Add page numbers to PDF using worker
 */
export async function addPageNumbers(
  buffer: Buffer,
  options: {
    position?: "top" | "bottom";
    alignment?: "left" | "center" | "right";
    format?: string;
    fontSize?: number;
    margin?: number;
  } = {}
): Promise<Buffer> {
  const pool = getPdfPool();
  return pool.execute<{
    buffer: Buffer;
    position?: string;
    alignment?: string;
    format?: string;
    fontSize?: number;
    margin?: number;
  }, Buffer>("pageNumbers", {
    buffer,
    ...options,
  });
}

/**
 * Set PDF metadata using worker
 */
export async function setMetadata(
  buffer: Buffer,
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
    creator?: string;
  }
): Promise<Buffer> {
  const pool = getPdfPool();
  return pool.execute<{
    buffer: Buffer;
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
    creator?: string;
  }, Buffer>("metadata", {
    buffer,
    ...metadata,
  });
}

/**
 * Compress PDF using worker
 */
export async function compressPDF(buffer: Buffer): Promise<Buffer> {
  const pool = getPdfPool();
  return pool.execute<{ buffer: Buffer }, Buffer>("compress", { buffer });
}

/**
 * Convert images to PDF using worker
 */
export async function imagesToPDF(
  images: Array<{ buffer: Buffer; mimeType: string }>
): Promise<Buffer> {
  const pool = getPdfPool();
  return pool.execute<{ images: Array<{ buffer: Buffer; mimeType: string }> }, Buffer>("imagesToPdf", { images });
}

/**
 * Reorder PDF pages using worker
 */
export async function reorderPages(
  buffer: Buffer,
  newOrder: number[]
): Promise<Buffer> {
  const pool = getPdfPool();
  return pool.execute<{ buffer: Buffer; order: number[] }, Buffer>("reorder", {
    buffer,
    order: newOrder,
  });
}

/**
 * Get worker pool statistics
 */
export function getPoolStats() {
  const pool = getPdfPool();
  return pool.getStats();
}
