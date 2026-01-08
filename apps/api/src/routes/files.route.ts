import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware";
import { createLogger } from "@tails/logger";
import type { AppVariables } from "../types";
import * as filesService from "../services/files";

const log = createLogger("files-route");

const filesRoutes = new Hono<{ Variables: AppVariables }>();

// Validation schemas
const createFileSchema = z.object({
  folderId: z.string().uuid().optional(),
  visibility: z.enum(["private", "unlisted", "public"]).optional(),
  password: z.string().min(4).max(100).optional(),
  expiresAt: z.string().datetime().optional(),
});

const updateFileSchema = z.object({
  visibility: z.enum(["private", "unlisted", "public"]).optional(),
  password: z.string().min(4).max(100).nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const listFilesSchema = z.object({
  folderId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).optional(),
  sortBy: z.enum(["createdAt", "name", "size"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

// Upload file
filesRoutes.post("/upload", requireAuth, async (c) => {
  const user = c.get("user");
  
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    const metadata = formData.get("metadata") as string | null;
    
    if (!file) {
      return c.json({ error: "No file provided" }, 400);
    }
    
    // Parse metadata
    let parsedMetadata: z.infer<typeof createFileSchema> = {};
    if (metadata) {
      try {
        parsedMetadata = createFileSchema.parse(JSON.parse(metadata));
      } catch {
        return c.json({ error: "Invalid metadata" }, 400);
      }
    }
    
    // Check file size (100MB limit)
    if (file.size > 100 * 1024 * 1024) {
      return c.json({ error: "File too large (max 100MB)" }, 400);
    }
    
    // Convert to buffer
    const buffer = Buffer.from(await file.arrayBuffer());
    
    const newFile = await filesService.createFile({
      userId: user.id,
      file: {
        buffer,
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      },
      ...parsedMetadata,
      expiresAt: parsedMetadata.expiresAt ? new Date(parsedMetadata.expiresAt) : undefined,
    });
    
    return c.json({ 
      success: true, 
      file: {
        id: newFile.id,
        filename: newFile.originalName,
        size: newFile.size,
        mimeType: newFile.mimeType,
        visibility: newFile.visibility,
        shareToken: newFile.shareToken,
        createdAt: newFile.createdAt,
      }
    }, 201);
  } catch (error) {
    log.error("Upload error", error as Error);
    return c.json({ error: "Upload failed" }, 500);
  }
});

// List files
filesRoutes.get("/", requireAuth, zValidator("query", listFilesSchema), async (c) => {
  const user = c.get("user");
  const query = c.req.valid("query");
  
  const result = await filesService.listUserFiles(user.id, {
    folderId: query.folderId === undefined ? null : query.folderId,
    limit: query.limit,
    offset: query.offset,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  });
  
  return c.json({
    files: result.files.map(f => ({
      id: f.id,
      filename: f.originalName,
      size: f.size,
      mimeType: f.mimeType,
      visibility: f.visibility,
      downloads: f.downloads,
      shareToken: f.shareToken,
      folderId: f.folderId,
      createdAt: f.createdAt,
      expiresAt: f.expiresAt,
    })),
    total: result.total,
  });
});

// Get file by ID
filesRoutes.get("/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  
  const file = await filesService.getFileById(id, user.id);
  if (!file) {
    return c.json({ error: "File not found" }, 404);
  }
  
  return c.json({ file });
});

// Download file (stream through API - never expose S3)
filesRoutes.get("/:id/download", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  
  const file = await filesService.getFileById(id, user.id);
  if (!file) {
    return c.json({ error: "File not found" }, 404);
  }
  
  // Get file buffer from S3 and stream it
  const { getFileBuffer } = await import("@tails/s3");
  const fileData = await getFileBuffer(file.key);
  
  if (!fileData) {
    return c.json({ error: "File not found in storage" }, 404);
  }
  
  await filesService.incrementDownloads(id);
  
  return new Response(fileData.buffer, {
    headers: {
      "Content-Type": fileData.contentType,
      "Content-Length": String(fileData.contentLength),
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file.originalName)}"`,
      "Cache-Control": "private, no-cache",
    },
  });
});

// Get file by share token (public)
filesRoutes.get("/share/:token", async (c) => {
  const token = c.req.param("token");
  
  const file = await filesService.getFileByShareToken(token);
  if (!file) {
    return c.json({ error: "File not found" }, 404);
  }
  
  // Check if password protected
  if (file.password) {
    return c.json({ 
      requiresPassword: true,
      file: {
        id: file.id,
        filename: file.originalName,
        size: file.size,
        mimeType: file.mimeType,
      }
    });
  }
  
  // Stream file through API
  const { getFileBuffer } = await import("@tails/s3");
  const fileData = await getFileBuffer(file.key);
  
  if (!fileData) {
    return c.json({ error: "File not found in storage" }, 404);
  }
  
  await filesService.incrementDownloads(file.id);
  
  return new Response(fileData.buffer, {
    headers: {
      "Content-Type": fileData.contentType,
      "Content-Length": String(fileData.contentLength),
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.originalName)}"`,
      "Cache-Control": "private, no-cache",
    },
  });
});

// Verify file password and download
filesRoutes.post("/share/:token/verify", zValidator("json", z.object({ password: z.string() })), async (c) => {
  const token = c.req.param("token");
  const { password } = c.req.valid("json");
  
  const file = await filesService.getFileByShareToken(token);
  if (!file) {
    return c.json({ error: "File not found" }, 404);
  }
  
  const valid = await filesService.verifyFilePassword(file.id, password);
  if (!valid) {
    return c.json({ error: "Invalid password" }, 401);
  }
  
  // Stream file through API
  const { getFileBuffer } = await import("@tails/s3");
  const fileData = await getFileBuffer(file.key);
  
  if (!fileData) {
    return c.json({ error: "File not found in storage" }, 404);
  }
  
  await filesService.incrementDownloads(file.id);
  
  return new Response(fileData.buffer, {
    headers: {
      "Content-Type": fileData.contentType,
      "Content-Length": String(fileData.contentLength),
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file.originalName)}"`,
      "Cache-Control": "private, no-cache",
    },
  });
});

// Update file
filesRoutes.patch("/:id", requireAuth, zValidator("json", updateFileSchema), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const input = c.req.valid("json");
  
  const updated = await filesService.updateFile(id, user.id, {
    ...input,
    expiresAt: input.expiresAt === null 
      ? null 
      : input.expiresAt 
        ? new Date(input.expiresAt) 
        : undefined,
  });
  
  if (!updated) {
    return c.json({ error: "File not found" }, 404);
  }
  
  return c.json({ file: updated });
});

// Delete file (soft delete)
filesRoutes.delete("/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  
  const deleted = await filesService.deleteFileById(id, user.id);
  if (!deleted) {
    return c.json({ error: "File not found" }, 404);
  }
  
  return c.json({ success: true });
});

// Permanently delete file
filesRoutes.delete("/:id/permanent", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  
  const deleted = await filesService.permanentlyDeleteFile(id, user.id);
  if (!deleted) {
    return c.json({ error: "File not found" }, 404);
  }
  
  return c.json({ success: true });
});

// Get storage usage
filesRoutes.get("/usage/storage", requireAuth, async (c) => {
  const user = c.get("user");
  
  const usage = await filesService.getUserStorageUsage(user.id);
  
  return c.json({ 
    used: usage,
    limit: 1024 * 1024 * 1024, // 1GB default
  });
});

// Folder routes
filesRoutes.post("/folders", requireAuth, zValidator("json", z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().uuid().optional(),
})), async (c) => {
  const user = c.get("user");
  const { name, parentId } = c.req.valid("json");
  
  const folder = await filesService.createFolder(user.id, name, parentId);
  
  return c.json({ folder }, 201);
});

filesRoutes.get("/folders", requireAuth, async (c) => {
  const user = c.get("user");
  const parentId = c.req.query("parentId");
  
  const folders = await filesService.listFolders(
    user.id, 
    parentId === undefined ? null : parentId || null
  );
  
  return c.json({ folders });
});

filesRoutes.delete("/folders/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  
  await filesService.deleteFolder(id, user.id);
  
  return c.json({ success: true });
});

export { filesRoutes };
