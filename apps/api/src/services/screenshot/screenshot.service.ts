import puppeteer, { Browser, Page } from "puppeteer";
import { createLogger } from "@tails/logger";
import { cacheGet, cacheSet, CacheNamespaces } from "@tails/cache";

const log = createLogger("screenshot-service");

// Browser pool configuration
const MAX_BROWSERS = 3;
const MAX_PAGES_PER_BROWSER = 5;
const BROWSER_IDLE_TIMEOUT = 60000; // 1 minute

interface BrowserInstance {
  browser: Browser;
  pageCount: number;
  lastUsed: number;
  id: number;
}

class BrowserPool {
  private browsers: BrowserInstance[] = [];
  private browserIdCounter = 0;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanupIdleBrowsers(), 30000);
  }

  async getBrowser(): Promise<Browser> {
    // Find a browser with available capacity
    let instance = this.browsers.find(
      (b) => b.browser.connected && b.pageCount < MAX_PAGES_PER_BROWSER
    );

    if (!instance && this.browsers.length < MAX_BROWSERS) {
      // Create new browser
      const browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          "--window-size=1920,1080",
        ],
      });

      instance = {
        browser,
        pageCount: 0,
        lastUsed: Date.now(),
        id: ++this.browserIdCounter,
      };

      this.browsers.push(instance);
      log.debug("Created new browser instance", { id: instance.id, total: this.browsers.length });
    }

    if (!instance) {
      // All browsers at capacity, wait for one to free up
      instance = this.browsers.reduce((a, b) => (a.pageCount < b.pageCount ? a : b));
    }

    instance.pageCount++;
    instance.lastUsed = Date.now();

    return instance.browser;
  }

  releasePage(browser: Browser) {
    const instance = this.browsers.find((b) => b.browser === browser);
    if (instance) {
      instance.pageCount = Math.max(0, instance.pageCount - 1);
      instance.lastUsed = Date.now();
    }
  }

  private async cleanupIdleBrowsers() {
    const now = Date.now();
    const toRemove: BrowserInstance[] = [];

    for (const instance of this.browsers) {
      if (
        instance.pageCount === 0 &&
        now - instance.lastUsed > BROWSER_IDLE_TIMEOUT &&
        this.browsers.length > 1
      ) {
        toRemove.push(instance);
      }
    }

    for (const instance of toRemove) {
      try {
        await instance.browser.close();
        const idx = this.browsers.indexOf(instance);
        if (idx !== -1) {
          this.browsers.splice(idx, 1);
        }
        log.debug("Closed idle browser", { id: instance.id, remaining: this.browsers.length });
      } catch (error) {
        log.error("Failed to close browser", error as Error);
      }
    }
  }

  async shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    for (const instance of this.browsers) {
      try {
        await instance.browser.close();
      } catch {}
    }

    this.browsers = [];
    log.info("Browser pool shut down");
  }

  getStats() {
    return {
      totalBrowsers: this.browsers.length,
      totalPages: this.browsers.reduce((sum, b) => sum + b.pageCount, 0),
      maxBrowsers: MAX_BROWSERS,
      maxPagesPerBrowser: MAX_PAGES_PER_BROWSER,
    };
  }
}

// Singleton browser pool
const browserPool = new BrowserPool();

const CACHE_CONFIG = {
  namespace: "screenshots",
  memoryTTL: 300,
  redisTTL: 3600,
};

// Blocked domains for ads/trackers
const BLOCKED_DOMAINS = [
  "googleadservices.com",
  "googlesyndication.com",
  "doubleclick.net",
  "google-analytics.com",
  "facebook.net",
  "facebook.com/tr",
  "analytics",
  "tracker",
  "ads",
];

export interface ScreenshotOptions {
  url: string;
  width?: number;
  height?: number;
  fullPage?: boolean;
  format?: "png" | "jpeg" | "webp";
  quality?: number;
  selector?: string;
  waitFor?: number | string;
  deviceScaleFactor?: number;
  mobile?: boolean;
  darkMode?: boolean;
  hideAds?: boolean;
  blockTrackers?: boolean;
  userAgent?: string;
  cookies?: Array<{ name: string; value: string; domain?: string }>;
  headers?: Record<string, string>;
  clip?: { x: number; y: number; width: number; height: number };
  halfPage?: boolean;
  scrollTo?: number;
  captureArea?: "top" | "middle" | "bottom";
}

export interface ScreenshotResult {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

/**
 * Capture screenshot of a URL
 */
export async function captureScreenshot(
  options: ScreenshotOptions
): Promise<ScreenshotResult> {
  const {
    url,
    width = 1920,
    height = 1080,
    fullPage = false,
    format = "png",
    quality = 80,
    selector,
    waitFor,
    deviceScaleFactor = 1,
    mobile = false,
    darkMode = false,
    hideAds = true,
    blockTrackers = true,
    userAgent,
    cookies,
    headers,
    clip,
    halfPage = false,
    scrollTo,
    captureArea,
  } = options;

  // Validate URL
  const parsedUrl = new URL(url);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Invalid URL protocol. Only HTTP and HTTPS are allowed.");
  }
  
  // Prevent SSRF
  if (!isURLAllowed(url)) {
    throw new Error("URL not allowed for security reasons.");
  }

  // Check cache
  const cacheKey = `screenshot:${Buffer.from(JSON.stringify(options)).toString("base64").slice(0, 64)}`;
  const cached = await cacheGet<{ buffer: string; mimeType: string; width: number; height: number }>(
    cacheKey,
    CACHE_CONFIG
  );
  if (cached) {
    return {
      ...cached,
      buffer: Buffer.from(cached.buffer, "base64"),
    };
  }

  const browser = await browserPool.getBrowser();
  const page = await browser.newPage();

  try {
    // Set viewport
    await page.setViewport({
      width,
      height,
      deviceScaleFactor,
      isMobile: mobile,
    });

    // Set user agent
    if (userAgent) {
      await page.setUserAgent(userAgent);
    } else if (mobile) {
      await page.setUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1"
      );
    }

    // Set extra headers
    if (headers) {
      await page.setExtraHTTPHeaders(headers);
    }

    // Set cookies
    if (cookies && cookies.length > 0) {
      await page.setCookie(
        ...cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain || parsedUrl.hostname,
        }))
      );
    }

    // Block ads and trackers
    if (hideAds || blockTrackers) {
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        const requestUrl = request.url().toLowerCase();
        const shouldBlock = BLOCKED_DOMAINS.some((domain) =>
          requestUrl.includes(domain)
        );
        if (shouldBlock) {
          request.abort();
        } else {
          request.continue();
        }
      });
    }

    // Enable dark mode
    if (darkMode) {
      await page.emulateMediaFeatures([
        { name: "prefers-color-scheme", value: "dark" },
      ]);
    }

    // Navigate to URL
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait for selector or timeout
    if (waitFor) {
      if (typeof waitFor === "number") {
        await new Promise((resolve) => setTimeout(resolve, waitFor));
      } else {
        await page.waitForSelector(waitFor, { timeout: 10000 });
      }
    }

    // Handle scroll position
    if (typeof scrollTo === "number") {
      await page.evaluate((y: number) => window.scrollTo(0, y), scrollTo);
    } else if (captureArea === "top") {
      await page.evaluate(() => window.scrollTo(0, 0));
    } else if (captureArea === "middle") {
      const bodyHandle = await page.$("body");
      const boundingBox = await bodyHandle?.boundingBox();
      if (boundingBox) {
        await page.evaluate((y: number) => window.scrollTo(0, y), Math.floor(boundingBox.height / 2 - height / 2));
      }
    } else if (captureArea === "bottom") {
      const bodyHandle = await page.$("body");
      const boundingBox = await bodyHandle?.boundingBox();
      if (boundingBox) {
        await page.evaluate((y: number) => window.scrollTo(0, y), Math.floor(boundingBox.height - height));
      }
    }

    // Take screenshot
    let screenshotOptions: any = {
      type: format,
      fullPage: fullPage && !halfPage, // If halfPage is true, don't do full page
    };

    if (format === "jpeg" || format === "webp") {
      screenshotOptions.quality = quality;
    }

    // Handle custom clipping
    if (clip) {
      screenshotOptions.clip = clip;
    } else if (halfPage) {
      // Capture half of the viewport
      screenshotOptions.clip = {
        x: 0,
        y: 0,
        width: width,
        height: Math.floor(height / 2),
      };
    }

    let buffer: Buffer;
    let actualWidth = width;
    let actualHeight = height;

    if (selector) {
      const element = await page.$(selector);
      if (!element) {
        throw new Error(`Selector "${selector}" not found`);
      }
      const boundingBox = await element.boundingBox();
      if (boundingBox) {
        actualWidth = Math.round(boundingBox.width);
        actualHeight = Math.round(boundingBox.height);
        // For element screenshots, we might need to adjust the clip
        if (halfPage && boundingBox.height > boundingBox.width) {
          // For tall elements, capture top half
          screenshotOptions.clip = {
            x: boundingBox.x,
            y: boundingBox.y,
            width: boundingBox.width,
            height: Math.floor(boundingBox.height / 2),
          };
        }
      }
      const screenshotData = await element.screenshot(screenshotOptions);
      buffer = Buffer.from(screenshotData);
    } else {
      if (fullPage && !halfPage) {
        const bodyHandle = await page.$("body");
        const boundingBox = await bodyHandle?.boundingBox();
        if (boundingBox) {
          actualHeight = Math.round(boundingBox.height);
        }
      } else if (halfPage) {
        actualHeight = Math.floor(height / 2);
      }
      
      const screenshotData = await page.screenshot(screenshotOptions);
      buffer = Buffer.from(screenshotData);
    }

    const mimeType =
      format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";

    const result = {
      buffer,
      mimeType,
      width: actualWidth,
      height: actualHeight,
    };

    // Cache result
    await cacheSet(
      cacheKey,
      {
        buffer: buffer.toString("base64"),
        mimeType,
        width: actualWidth,
        height: actualHeight,
      },
      CACHE_CONFIG
    );

    log.info("Screenshot captured", { url, width: actualWidth, height: actualHeight });

    return result;
  } finally {
    await page.close();
    browserPool.releasePage(browser);
  }
}

/**
 * Generate PDF from URL
 */
export async function urlToPDF(
  url: string,
  options: {
    format?: "A4" | "Letter" | "Legal";
    landscape?: boolean;
    margin?: { top?: string; right?: string; bottom?: string; left?: string };
    printBackground?: boolean;
    scale?: number;
  } = {}
): Promise<Buffer> {
  const {
    format = "A4",
    landscape = false,
    margin = { top: "1cm", right: "1cm", bottom: "1cm", left: "1cm" },
    printBackground = true,
    scale = 1,
  } = options;

  const browser = await browserPool.getBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    const pdfBuffer = await page.pdf({
      format,
      landscape,
      margin,
      printBackground,
      scale,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
    browserPool.releasePage(browser);
  }
}

/**
 * Get page metadata
 */
export async function getPageMetadata(url: string): Promise<{
  title: string;
  description: string;
  favicon: string;
  ogImage: string;
  themeColor: string;
}> {
  const browser = await browserPool.getBrowser();
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    const metadata = (await page.evaluate(`
      (function() {
        const getMeta = (name) => {
          const el = document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
          return el ? el.getAttribute("content") : "";
        };

        return {
          title: document.title || "",
          description: getMeta("description") || getMeta("og:description"),
          favicon: (document.querySelector('link[rel="icon"], link[rel="shortcut icon"]') || {}).href || "",
          ogImage: getMeta("og:image"),
          themeColor: getMeta("theme-color"),
        };
      })()
    `)) as {
      title: string;
      description: string;
      favicon: string;
      ogImage: string;
      themeColor: string;
    };

    return metadata;
  } finally {
    await page.close();
    browserPool.releasePage(browser);
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

/**
 * Get browser pool statistics
 */
export function getPoolStats() {
  return browserPool.getStats();
}

/**
 * Shutdown browser pool
 */
export async function shutdown() {
  await browserPool.shutdown();
}

// Cleanup on process exit
process.on("SIGTERM", () => browserPool.shutdown());
process.on("SIGINT", () => browserPool.shutdown());
