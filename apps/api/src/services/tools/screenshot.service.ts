import { createLogger } from "@tails/logger";
import { getGeneralPool } from "../../workers";

const log = createLogger("screenshot-tools");

export interface ScreenshotOptions {
  url: string;
  width?: number;
  height?: number;
  fullPage?: boolean;
  format?: "png" | "jpeg" | "webp";
  quality?: number; // 0-100, for jpeg and webp
  delay?: number; // milliseconds to wait before capture
  selector?: string; // CSS selector to capture specific element
  viewportWidth?: number;
  viewportHeight?: number;
}

/**
 * Capture screenshot of a website
 */
export async function captureScreenshot(options: ScreenshotOptions): Promise<{
  buffer: Buffer;
  format: string;
  size: number;
}> {
  const {
    url,
    width = 1920,
    height = 1080,
    fullPage = false,
    format = "png",
    quality = 80,
    delay = 0,
    selector,
    viewportWidth = 1920,
    viewportHeight = 1080,
  } = options;

  // Validate URL
  if (!url || !isValidURL(url)) {
    throw new Error("Valid URL is required");
  }

  // Validate dimensions
  if (width < 320 || width > 3840) {
    throw new Error("Width must be between 320 and 3840 pixels");
  }

  if (height < 240 || height > 2160) {
    throw new Error("Height must be between 240 and 2160 pixels");
  }

  try {
    const pool = getGeneralPool();
    const result = await pool.execute<any, { buffer: Buffer }>("captureScreenshot", {
      url,
      width,
      height,
      fullPage,
      format,
      quality,
      delay,
      selector,
      viewportWidth,
      viewportHeight,
    });

    log.info("Screenshot captured", {
      url,
      width,
      height,
      fullPage,
      format,
      size: result.buffer.length,
    });

    return {
      buffer: result.buffer,
      format,
      size: result.buffer.length,
    };
  } catch (error) {
    log.error("Screenshot capture failed", error as Error);
    throw new Error("Failed to capture screenshot");
  }
}

/**
 * Validate URL
 */
function isValidURL(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Check if URL is allowed (prevent SSRF)
 */
export function isURLAllowed(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    
    // Block private IP ranges
    const hostname = url.hostname.toLowerCase();
    
    // Block localhost
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
      return false;
    }
    
    // Block private IPv4 ranges
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Regex);
    
    if (match) {
      const [, a, b, c, d] = match.map(Number);
      
      // 10.0.0.0/8
      if (a === 10) return false;
      
      // 172.16.0.0/12
      if (a === 172 && b >= 16 && b <= 31) return false;
      
      // 192.168.0.0/16
      if (a === 192 && b === 168) return false;
      
      // 169.254.0.0/16 (link-local)
      if (a === 169 && b === 254) return false;
    }
    
    return true;
  } catch {
    return false;
  }
}
