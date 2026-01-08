import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { optionalAuth, requireAuth } from "../middleware/auth.middleware";
import { createLogger } from "@tails/logger";
import type { AppVariables } from "../types";

// Import all services
import * as imagesService from "../services/images";
import * as pdfService from "../services/pdf";
import * as screenshotService from "../services/screenshot";
import * as qrcodeService from "../services/qrcode";
import * as utilsService from "../services/utils";
import * as videoService from "../services/video";

const log = createLogger("tools-route");

const toolsRoutes = new Hono<{ Variables: AppVariables }>();

// ==================== Image Tools ====================

// Resize image
toolsRoutes.post("/images/resize", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const width = parseInt(formData.get("width") as string) || undefined;
  const height = parseInt(formData.get("height") as string) || undefined;
  const fit = (formData.get("fit") as string) || "cover";
  
  if (!file) return c.json({ error: "No file provided" }, 400);
  
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await imagesService.resizeImage(buffer, { 
    width, 
    height, 
    fit: fit as any 
  });
  
  return new Response(result, {
    headers: { "Content-Type": file.type || "image/png" },
  });
});

// Compress image
toolsRoutes.post("/images/compress", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const quality = parseInt(formData.get("quality") as string) || 80;
  const format = formData.get("format") as string || undefined;
  
  if (!file) return c.json({ error: "No file provided" }, 400);
  
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await imagesService.compressImage(buffer, { 
    quality, 
    format: format as any 
  });
  
  const mimeType = result.format ? imagesService.getFormatMimeType(result.format as any) : file.type;
  
  return new Response(result.buffer, {
    headers: { "Content-Type": mimeType },
  });
});

// Convert image format
toolsRoutes.post("/images/convert", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const format = formData.get("format") as string;
  const quality = parseInt(formData.get("quality") as string) || 85;
  
  if (!file) return c.json({ error: "No file provided" }, 400);
  if (!format) return c.json({ error: "Format is required" }, 400);
  
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await imagesService.convertImage(buffer, { 
    format: format as any, 
    quality 
  });
  
  return new Response(result, {
    headers: { 
      "Content-Type": imagesService.getFormatMimeType(format as any),
      "Content-Disposition": `attachment; filename="converted.${imagesService.getFormatExtension(format as any)}"`,
    },
  });
});

// Optimize for web (WebP + AVIF)
toolsRoutes.post("/images/optimize", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const maxWidth = parseInt(formData.get("maxWidth") as string) || 2048;
  const quality = parseInt(formData.get("quality") as string) || 80;
  
  if (!file) return c.json({ error: "No file provided" }, 400);
  
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await imagesService.optimizeForWeb(buffer, { maxWidth, quality });
  
  return c.json({
    webp: {
      size: result.webp.length,
      base64: result.webp.toString("base64").slice(0, 100) + "...",
    },
    avif: {
      size: result.avif.length,
      base64: result.avif.toString("base64").slice(0, 100) + "...",
    },
    original: {
      size: result.original.length,
    },
  });
});

// Get image info
toolsRoutes.post("/images/info", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  
  if (!file) return c.json({ error: "No file provided" }, 400);
  
  const buffer = Buffer.from(await file.arrayBuffer());
  const info = await imagesService.getImageInfo(buffer);
  
  return c.json(info);
});

// Generate thumbnail
toolsRoutes.post("/images/thumbnail", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const size = parseInt(formData.get("size") as string) || 200;
  
  if (!file) return c.json({ error: "No file provided" }, 400);
  
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await imagesService.generateThumbnail(buffer, size);
  
  return new Response(result, {
    headers: { "Content-Type": "image/jpeg" },
  });
});

// ==================== PDF Tools ====================

// Get PDF info
toolsRoutes.post("/pdf/info", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  
  if (!file) return c.json({ error: "No file provided" }, 400);
  
  const buffer = Buffer.from(await file.arrayBuffer());
  const info = await pdfService.getPDFInfo(buffer);
  
  return c.json(info);
});

// Merge PDFs
toolsRoutes.post("/pdf/merge", async (c) => {
  const formData = await c.req.formData();
  const files = formData.getAll("files") as File[];
  
  if (files.length < 2) return c.json({ error: "At least 2 files required" }, 400);
  
  const buffers = await Promise.all(files.map(f => f.arrayBuffer().then(Buffer.from)));
  const result = await pdfService.mergePDFs(buffers);
  
  return new Response(result, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=\"merged.pdf\"",
    },
  });
});

// Split PDF
toolsRoutes.post("/pdf/split", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  
  if (!file) return c.json({ error: "No file provided" }, 400);
  
  const buffer = Buffer.from(await file.arrayBuffer());
  const pages = await pdfService.splitPDF(buffer);
  
  // Return as JSON with base64 encoded pages
  return c.json({
    pageCount: pages.length,
    pages: pages.map((p, i) => ({
      page: i + 1,
      size: p.length,
      // Don't include full base64 in response - too large
    })),
  });
});

// Extract pages
toolsRoutes.post("/pdf/extract", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const pagesStr = formData.get("pages") as string;
  
  if (!file) return c.json({ error: "No file provided" }, 400);
  if (!pagesStr) return c.json({ error: "Pages required" }, 400);
  
  const pages = pagesStr.split(",").map(p => parseInt(p.trim())).filter(p => !isNaN(p));
  
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await pdfService.extractPages(buffer, pages);
  
  return new Response(result, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=\"extracted.pdf\"",
    },
  });
});

// Rotate PDF
toolsRoutes.post("/pdf/rotate", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const degrees = parseInt(formData.get("degrees") as string) as 90 | 180 | 270;
  
  if (!file) return c.json({ error: "No file provided" }, 400);
  if (![90, 180, 270].includes(degrees)) return c.json({ error: "Degrees must be 90, 180, or 270" }, 400);
  
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await pdfService.rotatePDF(buffer, degrees);
  
  return new Response(result, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=\"rotated.pdf\"",
    },
  });
});

// Add watermark to PDF
toolsRoutes.post("/pdf/watermark", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const text = formData.get("text") as string;
  
  if (!file) return c.json({ error: "No file provided" }, 400);
  if (!text) return c.json({ error: "Watermark text required" }, 400);
  
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await pdfService.addWatermarkToPDF(buffer, text);
  
  return new Response(result, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=\"watermarked.pdf\"",
    },
  });
});

// Compress PDF
toolsRoutes.post("/pdf/compress", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  
  if (!file) return c.json({ error: "No file provided" }, 400);
  
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await pdfService.compressPDF(buffer);
  
  return new Response(result, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=\"compressed.pdf\"",
    },
  });
});

// Images to PDF
toolsRoutes.post("/pdf/from-images", async (c) => {
  const formData = await c.req.formData();
  const files = formData.getAll("files") as File[];
  
  if (files.length === 0) return c.json({ error: "At least 1 image required" }, 400);
  
  const images = await Promise.all(
    files.map(async (f) => ({
      buffer: Buffer.from(await f.arrayBuffer()),
      mimeType: f.type,
    }))
  );
  
  const result = await pdfService.imagesToPDF(images);
  
  return new Response(result, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=\"images.pdf\"",
    },
  });
});

// ==================== Screenshot API ====================

const screenshotSchema = z.object({
  url: z.string().url(),
  width: z.number().int().min(320).max(3840).optional(),
  height: z.number().int().min(240).max(2160).optional(),
  fullPage: z.boolean().optional(),
  format: z.enum(["png", "jpeg", "webp"]).optional(),
  quality: z.number().int().min(1).max(100).optional(),
  selector: z.string().optional(),
  waitFor: z.union([z.number(), z.string()]).optional(),
  mobile: z.boolean().optional(),
  darkMode: z.boolean().optional(),
});

toolsRoutes.post("/screenshot", zValidator("json", screenshotSchema), async (c) => {
  const options = c.req.valid("json");
  
  try {
    const result = await screenshotService.captureScreenshot(options);
    
    return new Response(result.buffer, {
      headers: {
        "Content-Type": result.mimeType,
        "X-Image-Width": String(result.width),
        "X-Image-Height": String(result.height),
      },
    });
  } catch (error) {
    log.error("Screenshot error", error as Error);
    return c.json({ error: (error as Error).message }, 500);
  }
});

// URL to PDF
toolsRoutes.post("/screenshot/pdf", zValidator("json", z.object({
  url: z.string().url(),
  format: z.enum(["A4", "Letter", "Legal"]).optional(),
  landscape: z.boolean().optional(),
})), async (c) => {
  const { url, format, landscape } = c.req.valid("json");
  
  try {
    const result = await screenshotService.urlToPDF(url, { format, landscape });
    
    return new Response(result, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=\"page.pdf\"",
      },
    });
  } catch (error) {
    log.error("URL to PDF error", error as Error);
    return c.json({ error: (error as Error).message }, 500);
  }
});

// Get page metadata
toolsRoutes.post("/screenshot/metadata", zValidator("json", z.object({
  url: z.string().url(),
})), async (c) => {
  const { url } = c.req.valid("json");
  
  try {
    const metadata = await screenshotService.getPageMetadata(url);
    return c.json(metadata);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 500);
  }
});

// ==================== QR Code ====================

const qrCodeSchema = z.object({
  content: z.string().max(4000),
  width: z.number().int().min(50).max(2000).optional(),
  format: z.enum(["png", "svg"]).optional(),
  color: z.object({
    dark: z.string().optional(),
    light: z.string().optional(),
  }).optional(),
  errorCorrectionLevel: z.enum(["L", "M", "Q", "H"]).optional(),
});

toolsRoutes.post("/qrcode", zValidator("json", qrCodeSchema), async (c) => {
  const options = c.req.valid("json");
  
  const result = await qrcodeService.generateQRCode(options.content, {
    width: options.width,
    format: options.format,
    color: options.color,
    errorCorrectionLevel: options.errorCorrectionLevel,
  });
  
  return new Response(result.data, {
    headers: { "Content-Type": result.mimeType },
  });
});

// WiFi QR
toolsRoutes.post("/qrcode/wifi", zValidator("json", z.object({
  ssid: z.string(),
  password: z.string(),
  encryption: z.enum(["WPA", "WEP", "nopass"]).optional(),
  hidden: z.boolean().optional(),
  ...qrCodeSchema.shape,
})), async (c) => {
  const { ssid, password, encryption, hidden, ...options } = c.req.valid("json");
  
  const result = await qrcodeService.generateWiFiQR(ssid, password, {
    encryption,
    hidden,
    width: options.width,
    format: options.format,
  });
  
  return new Response(result.data, {
    headers: { "Content-Type": result.mimeType },
  });
});

// vCard QR
toolsRoutes.post("/qrcode/vcard", zValidator("json", z.object({
  firstName: z.string(),
  lastName: z.string().optional(),
  organization: z.string().optional(),
  title: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  website: z.string().url().optional(),
  width: z.number().optional(),
  format: z.enum(["png", "svg"]).optional(),
})), async (c) => {
  const { width, format, ...contact } = c.req.valid("json");
  
  const result = await qrcodeService.generateVCardQR(contact, { width, format });
  
  return new Response(result.data, {
    headers: { "Content-Type": result.mimeType },
  });
});

// ==================== JSON Tools ====================

toolsRoutes.post("/json/format", zValidator("json", z.object({
  input: z.string(),
  indent: z.number().int().min(0).max(8).optional(),
  sortKeys: z.boolean().optional(),
})), async (c) => {
  const { input, indent, sortKeys } = c.req.valid("json");
  
  try {
    const result = await utilsService.formatJSON(input, { indent, sortKeys });
    return c.json({ output: result });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

toolsRoutes.post("/json/minify", zValidator("json", z.object({
  input: z.string(),
})), async (c) => {
  const { input } = c.req.valid("json");
  
  try {
    const result = await utilsService.minifyJSON(input);
    return c.json({ output: result });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

toolsRoutes.post("/json/validate", zValidator("json", z.object({
  input: z.string(),
})), async (c) => {
  const { input } = c.req.valid("json");
  return c.json(await utilsService.validateJSON(input));
});

toolsRoutes.post("/json/to-yaml", zValidator("json", z.object({
  input: z.string(),
})), async (c) => {
  const { input } = c.req.valid("json");
  
  try {
    const result = await utilsService.jsonToYAML(input);
    return c.json({ output: result });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

toolsRoutes.post("/yaml/to-json", zValidator("json", z.object({
  input: z.string(),
})), async (c) => {
  const { input } = c.req.valid("json");
  
  try {
    const result = await utilsService.yamlToJSON(input);
    return c.json({ output: result });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

toolsRoutes.post("/json/to-csv", zValidator("json", z.object({
  input: z.string(),
  delimiter: z.string().length(1).optional(),
})), async (c) => {
  const { input, delimiter } = c.req.valid("json");
  
  try {
    const result = await utilsService.jsonToCSV(input, delimiter);
    return c.json({ output: result });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

toolsRoutes.post("/csv/to-json", zValidator("json", z.object({
  input: z.string(),
  delimiter: z.string().length(1).optional(),
})), async (c) => {
  const { input, delimiter } = c.req.valid("json");
  
  try {
    const result = await utilsService.csvToJSON(input, delimiter);
    return c.json({ output: result });
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

// ==================== Hash Generator ====================

toolsRoutes.post("/hash", zValidator("json", z.object({
  input: z.string(),
  algorithm: z.enum(["md5", "sha1", "sha256", "sha384", "sha512"]).optional(),
})), async (c) => {
  const { input, algorithm = "sha256" } = c.req.valid("json");
  const hash = await utilsService.generateHash(input, algorithm);
  return c.json({ hash, algorithm });
});

toolsRoutes.post("/hash/all", zValidator("json", z.object({
  input: z.string(),
})), async (c) => {
  const { input } = c.req.valid("json");
  const hashes = await utilsService.generateAllHashes(input);
  return c.json(hashes);
});

toolsRoutes.post("/hash/verify", zValidator("json", z.object({
  input: z.string(),
  hash: z.string(),
  algorithm: z.enum(["md5", "sha1", "sha256", "sha384", "sha512"]).optional(),
})), async (c) => {
  const { input, hash, algorithm } = c.req.valid("json");
  const result = await utilsService.verifyHash(input, hash, algorithm);
  return c.json(result);
});

toolsRoutes.post("/hash/file", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  
  if (!file) return c.json({ error: "No file provided" }, 400);
  
  const buffer = Buffer.from(await file.arrayBuffer());
  const hashes = await utilsService.generateAllHashes(buffer);
  
  return c.json({
    filename: file.name,
    size: file.size,
    hashes,
  });
});

// ==================== Base64 ====================

toolsRoutes.post("/base64/encode", zValidator("json", z.object({
  input: z.string(),
  urlSafe: z.boolean().optional(),
})), async (c) => {
  const { input, urlSafe } = c.req.valid("json");
  const output = await utilsService.encodeBase64(input, urlSafe);
  return c.json({ output });
});

toolsRoutes.post("/base64/decode", zValidator("json", z.object({
  input: z.string(),
  urlSafe: z.boolean().optional(),
})), async (c) => {
  const { input, urlSafe } = c.req.valid("json");
  
  try {
    const output = await utilsService.decodeBase64(input, urlSafe);
    return c.json({ output });
  } catch (error) {
    return c.json({ error: "Invalid Base64 string" }, 400);
  }
});

toolsRoutes.post("/base64/validate", zValidator("json", z.object({
  input: z.string(),
})), async (c) => {
  const { input } = c.req.valid("json");
  // Simple validation check
  try {
    await utilsService.decodeBase64(input);
    return c.json({ valid: true });
  } catch {
    return c.json({ valid: false });
  }
});

toolsRoutes.post("/base64/file/encode", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  
  if (!file) return c.json({ error: "No file provided" }, 400);
  
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await utilsService.encodeBase64File(buffer, file.type);
  
  return c.json({
    filename: file.name,
    mimeType: file.type,
    size: file.size,
    base64: result.base64,
    dataUri: result.dataUri,
  });
});

// ==================== UUID Generator ====================

toolsRoutes.get("/uuid", async (c) => {
  const version = (c.req.query("version") || "v4") as "v1" | "v4";
  const uuid = await utilsService.generateUUID({ version });
  return c.json({ uuid, version });
});

toolsRoutes.post("/uuid/bulk", zValidator("json", z.object({
  count: z.number().int().min(1).max(1000),
  version: z.enum(["v1", "v4"]).optional(),
})), async (c) => {
  const { count, version = "v4" } = c.req.valid("json");
  const uuids = await utilsService.generateBulkUUIDs(count, version);
  return c.json({ uuids, count, version });
});

toolsRoutes.post("/uuid/validate", zValidator("json", z.object({
  uuid: z.string(),
})), async (c) => {
  const { uuid } = c.req.valid("json");
  const result = await utilsService.validateUUID(uuid);
  return c.json(result);
});

toolsRoutes.post("/uuid/v5", zValidator("json", z.object({
  name: z.string(),
  namespace: z.enum(["DNS", "URL", "OID", "X500"]).or(z.string().uuid()),
})), async (c) => {
  const { name, namespace } = c.req.valid("json");
  const uuid = await utilsService.generateUUID({ 
    version: "v5", 
    name, 
    namespace: namespace as "DNS" | "URL" | "OID" | "X500" 
  });
  return c.json({ uuid, name, namespace });
});

// ==================== Video Downloader ====================

toolsRoutes.post("/video/info", zValidator("json", z.object({
  url: z.string().url(),
})), async (c) => {
  const { url } = c.req.valid("json");
  
  if (!videoService.isUrlSupported(url)) {
    return c.json({ error: "Unsupported platform" }, 400);
  }
  
  try {
    const info = await videoService.getVideoInfo(url);
    return c.json(info);
  } catch (error) {
    log.error("Video info error", error as Error);
    return c.json({ error: (error as Error).message }, 500);
  }
});

toolsRoutes.post("/video/download", requireAuth, zValidator("json", z.object({
  url: z.string().url(),
  quality: z.enum(["best", "worst", "1080p", "720p", "480p", "360p", "audio"]).optional(),
  format: z.enum(["mp4", "webm", "mp3", "m4a", "wav"]).optional(),
  audioOnly: z.boolean().optional(),
})), async (c) => {
  const options = c.req.valid("json");
  
  if (!videoService.isUrlSupported(options.url)) {
    return c.json({ error: "Unsupported platform" }, 400);
  }
  
  try {
    const result = await videoService.downloadVideo(options.url, options);
    
    return new Response(result.buffer, {
      headers: {
        "Content-Type": result.format === "mp3" ? "audio/mpeg" : 
                        result.format === "m4a" ? "audio/mp4" :
                        result.format === "wav" ? "audio/wav" :
                        result.format === "webm" ? "video/webm" : "video/mp4",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(result.filename)}"`,
        "Content-Length": String(result.filesize),
      },
    });
  } catch (error) {
    log.error("Video download error", error as Error);
    return c.json({ error: (error as Error).message }, 500);
  }
});

toolsRoutes.get("/video/platforms", async (c) => {
  return c.json({ platforms: videoService.SUPPORTED_PLATFORMS });
});

export { toolsRoutes };

