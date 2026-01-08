import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, optionalAuth } from "../middleware/auth.middleware";
import { createLogger } from "@tails/logger";
import type { AppVariables } from "../types";
import * as mediaService from "../services/media";

const log = createLogger("media-route");

const mediaRoutes = new Hono<{ Variables: AppVariables }>();

// Upload media
mediaRoutes.post("/upload", requireAuth, async (c) => {
  const user = c.get("user");
  
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    const alt = formData.get("alt") as string | null;
    const folderId = formData.get("folderId") as string | null;
    const isPublic = formData.get("isPublic") === "true";
    const password = formData.get("password") as string | null;
    
    if (!file) {
      return c.json({ error: "No file provided" }, 400);
    }
    
    // Check file size (100MB limit)
    if (file.size > 100 * 1024 * 1024) {
      return c.json({ error: "File too large (max 100MB)" }, 400);
    }
    
    const buffer = Buffer.from(await file.arrayBuffer());
    
    const media = await mediaService.createMedia({
      userId: user.id,
      file: {
        buffer,
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      },
      alt: alt || undefined,
      folderId: folderId || undefined,
      isPublic,
      password: password || undefined,
    });
    
    return c.json({ 
      success: true, 
      media: {
        id: media.id,
        filename: media.originalName,
        type: media.type,
        size: media.size,
        url: `/media/${media.id}`,
        thumbnailUrl: media.thumbnailUrl,
        createdAt: media.createdAt,
      }
    }, 201);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("not allowed")) {
        return c.json({ error: error.message }, 400);
      }
      if (error.message.includes("too large")) {
        return c.json({ error: error.message }, 400);
      }
    }
    log.error("Upload error", error as Error);
    return c.json({ error: "Upload failed" }, 500);
  }
});

// List user's media
mediaRoutes.get("/", requireAuth, async (c) => {
  const user = c.get("user");
  const type = c.req.query("type") as "image" | "video" | "audio" | "document" | undefined;
  const folderId = c.req.query("folderId");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");
  
  const result = await mediaService.listUserMedia(user.id, {
    type,
    folderId: folderId === undefined ? undefined : folderId || null,
    limit: Math.min(limit, 100),
    offset,
  });
  
  return c.json({
    media: result.media.map(m => ({
      id: m.id,
      filename: m.originalName,
      type: m.type,
      size: m.size,
      mimeType: m.mimeType,
      url: `/media/${m.id}`,
      thumbnailUrl: m.thumbnailUrl,
      alt: m.alt,
      views: m.views,
      createdAt: m.createdAt,
    })),
    total: result.total,
  });
});

// Get media metadata
mediaRoutes.get("/:id/info", optionalAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  
  const media = await mediaService.getMediaById(id);
  if (!media) {
    return c.json({ error: "Media not found" }, 404);
  }
  
  // Check access
  const access = mediaService.checkMediaAccess(media, user?.id);
  if (!access.accessible && !access.requiresPassword) {
    return c.json({ error: access.reason }, 403);
  }
  
  return c.json({
    media: {
      id: media.id,
      filename: media.originalName,
      type: media.type,
      size: media.size,
      mimeType: media.mimeType,
      width: media.width,
      height: media.height,
      alt: media.alt,
      views: media.views,
      createdAt: media.createdAt,
      requiresPassword: access.requiresPassword,
    }
  });
});

// Stream media file (secure - never expose S3 URL)
// Public URL: tail.tools/media/:id
mediaRoutes.get("/:id", optionalAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const apiKey = c.req.header("x-api-key");
  
  const media = await mediaService.getMediaById(id);
  if (!media) {
    return c.json({ error: "Media not found" }, 404);
  }
  
  // Check access
  const access = mediaService.checkMediaAccess(media, user?.id, !!apiKey);
  if (!access.accessible) {
    if (access.requiresPassword) {
      return c.json({ 
        error: "Password required",
        requiresPassword: true,
        media: {
          id: media.id,
          filename: media.originalName,
          type: media.type,
        }
      }, 401);
    }
    return c.json({ error: access.reason }, 403);
  }
  
  // Handle range requests for video/audio streaming
  const rangeHeader = c.req.header("range");
  let range: { start: number; end: number } | undefined;
  
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1]);
      const end = match[2] ? parseInt(match[2]) : media.size - 1;
      range = { start, end };
    }
  }
  
  // Stream the file
  const fileData = await mediaService.getMediaStream(id, user?.id, !!apiKey, range);
  if (!fileData) {
    return c.json({ error: "File not found in storage" }, 404);
  }
  
  const headers: Record<string, string> = {
    "Content-Type": fileData.contentType,
    "Content-Disposition": `inline; filename="${encodeURIComponent(fileData.filename)}"`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    // Security headers - prevent embedding on other sites
    "X-Content-Type-Options": "nosniff",
  };
  
  if (range && fileData.contentRange) {
    headers["Content-Range"] = fileData.contentRange;
    headers["Content-Length"] = String(range.end - range.start + 1);
    
    return new Response(fileData.stream, {
      status: 206,
      headers,
    });
  }
  
  headers["Content-Length"] = String(fileData.contentLength);
  
  return new Response(fileData.stream, {
    status: 200,
    headers,
  });
});

// Download media file (force download)
mediaRoutes.get("/:id/download", optionalAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const apiKey = c.req.header("x-api-key");
  
  const fileData = await mediaService.getMediaBuffer(id, user?.id, !!apiKey);
  if (!fileData) {
    return c.json({ error: "Media not found or access denied" }, 404);
  }
  
  return new Response(fileData.buffer, {
    headers: {
      "Content-Type": fileData.contentType,
      "Content-Length": String(fileData.buffer.length),
      "Content-Disposition": `attachment; filename="${encodeURIComponent(fileData.filename)}"`,
      "Cache-Control": "private, no-cache",
    },
  });
});

// Verify password and get access
mediaRoutes.post("/:id/verify", zValidator("json", z.object({ password: z.string() })), async (c) => {
  const id = c.req.param("id");
  const { password } = c.req.valid("json");
  
  const valid = await mediaService.verifyMediaPassword(id, password);
  if (!valid) {
    return c.json({ error: "Invalid password" }, 401);
  }
  
  // Return a temporary access token or stream the file
  const fileData = await mediaService.getMediaBuffer(id, undefined, true);
  if (!fileData) {
    return c.json({ error: "Media not found" }, 404);
  }
  
  return new Response(fileData.buffer, {
    headers: {
      "Content-Type": fileData.contentType,
      "Content-Length": String(fileData.buffer.length),
      "Content-Disposition": `inline; filename="${encodeURIComponent(fileData.filename)}"`,
      "Cache-Control": "private, no-cache",
    },
  });
});

// Delete media
mediaRoutes.delete("/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  
  const deleted = await mediaService.deleteMedia(id, user.id);
  if (!deleted) {
    return c.json({ error: "Media not found" }, 404);
  }
  
  return c.json({ success: true });
});

// Permanently delete media
mediaRoutes.delete("/:id/permanent", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  
  const deleted = await mediaService.permanentlyDeleteMedia(id, user.id);
  if (!deleted) {
    return c.json({ error: "Media not found" }, 404);
  }
  
  return c.json({ success: true });
});

// Get storage usage
mediaRoutes.get("/usage/storage", requireAuth, async (c) => {
  const user = c.get("user");
  
  const usage = await mediaService.getUserMediaStorage(user.id);
  
  return c.json({ 
    used: usage,
    limit: 1024 * 1024 * 1024, // 1GB default
  });
});

// PDF specific routes
mediaRoutes.get("/pdf/:id", optionalAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const apiKey = c.req.header("x-api-key");
  
  // Check if it's a PDF
  const isPdf = await mediaService.isPDF(id);
  if (!isPdf) {
    return c.json({ error: "Not a PDF" }, 400);
  }
  
  const pdfData = await mediaService.getPDFBuffer(id, user?.id, !!apiKey);
  if (!pdfData) {
    return c.json({ error: "PDF not found or access denied" }, 404);
  }
  
  return new Response(pdfData.buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdfData.buffer.length),
      "Content-Disposition": `inline; filename="${encodeURIComponent(pdfData.filename)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
});

export { mediaRoutes };

