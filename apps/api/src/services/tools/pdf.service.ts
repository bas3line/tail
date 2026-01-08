import { createLogger } from "@tails/logger";
import { getPdfPool } from "../../workers";

const log = createLogger("pdf-tools");

export interface PDFMergeOptions {
  files: Buffer[];
}

export interface PDFSplitOptions {
  file: Buffer;
  pages?: number[]; // Specific pages to extract
  startPage?: number;
  endPage?: number;
}

export interface PDFCompressOptions {
  file: Buffer;
  quality?: "low" | "medium" | "high"; // low = best quality, high = smallest size
}

/**
 * Merge multiple PDF files into one
 */
export async function mergePDFs(options: PDFMergeOptions): Promise<Buffer> {
  const { files } = options;

  if (!files || files.length < 2) {
    throw new Error("At least 2 PDF files are required for merging");
  }

  try {
    const pool = getPdfPool();
    const result = await pool.execute<any, { buffer: Buffer }>("processPDF", {
      operation: "merge",
      files,
    });

    log.info("PDFs merged", {
      inputFiles: files.length,
      outputSize: result.buffer.length,
    });

    return result.buffer;
  } catch (error) {
    log.error("PDF merge failed", error as Error);
    throw new Error("Failed to merge PDFs");
  }
}

/**
 * Split PDF or extract specific pages
 */
export async function splitPDF(options: PDFSplitOptions): Promise<Buffer> {
  const { file, pages, startPage, endPage } = options;

  if (!file || file.length === 0) {
    throw new Error("PDF file is required");
  }

  try {
    const pool = getPdfPool();
    const result = await pool.execute<any, { buffer: Buffer }>("processPDF", {
      operation: "split",
      file,
      pages,
      startPage,
      endPage,
    });

    log.info("PDF split", {
      inputSize: file.length,
      outputSize: result.buffer.length,
    });

    return result.buffer;
  } catch (error) {
    log.error("PDF split failed", error as Error);
    throw new Error("Failed to split PDF");
  }
}

/**
 * Compress PDF file
 */
export async function compressPDF(options: PDFCompressOptions): Promise<{ buffer: Buffer; originalSize: number; compressedSize: number; ratio: number }> {
  const { file, quality = "medium" } = options;

  if (!file || file.length === 0) {
    throw new Error("PDF file is required");
  }

  const originalSize = file.length;

  try {
    const pool = getPdfPool();
    const result = await pool.execute<any, { buffer: Buffer }>("processPDF", {
      operation: "compress",
      file,
      quality,
    });

    const compressedSize = result.buffer.length;
    const ratio = ((1 - compressedSize / originalSize) * 100);

    log.info("PDF compressed", {
      originalSize,
      compressedSize,
      ratio: ratio.toFixed(2) + "%",
      quality,
    });

    return {
      buffer: result.buffer,
      originalSize,
      compressedSize,
      ratio,
    };
  } catch (error) {
    log.error("PDF compression failed", error as Error);
    throw new Error("Failed to compress PDF");
  }
}

/**
 * Get PDF metadata
 */
export async function getPDFMetadata(file: Buffer): Promise<{
  pages: number;
  size: number;
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
}> {
  if (!file || file.length === 0) {
    throw new Error("PDF file is required");
  }

  try {
    const pool = getPdfPool();
    const result = await pool.execute<any, { pages: number; title?: string; author?: string; subject?: string; keywords?: string }>("processPDF", {
      operation: "metadata",
      file,
    });

    return {
      pages: result.pages,
      size: file.length,
      title: result.title,
      author: result.author,
      subject: result.subject,
      keywords: result.keywords,
    };
  } catch (error) {
    log.error("Failed to get PDF metadata", error as Error);
    throw new Error("Failed to get PDF metadata");
  }
}

/**
 * Validate PDF buffer
 */
export function validatePDFBuffer(buffer: Buffer, maxSize: number = 50 * 1024 * 1024): void {
  if (!buffer || buffer.length === 0) {
    throw new Error("PDF buffer is empty");
  }

  if (buffer.length > maxSize) {
    throw new Error(`PDF too large. Maximum size is ${(maxSize / 1024 / 1024).toFixed(0)}MB`);
  }

  // Check PDF magic number
  const header = buffer.slice(0, 5).toString();
  if (!header.startsWith("%PDF-")) {
    throw new Error("Invalid PDF file");
  }
}
