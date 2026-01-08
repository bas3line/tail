import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, optionalAuth } from "../middleware/auth.middleware";
import { createLogger } from "@tails/logger";
import type { AppVariables } from "../types";
import * as pastesService from "../services/pastes";

const log = createLogger("pastes-route");

const pastesRoutes = new Hono<{ Variables: AppVariables }>();

// Validation schemas
const languageValues = [
  "plaintext", "javascript", "typescript", "python", "go", "rust", "java",
  "c", "cpp", "csharp", "php", "ruby", "swift", "kotlin", "scala",
  "html", "css", "scss", "json", "yaml", "xml", "markdown",
  "sql", "graphql", "bash", "powershell", "dockerfile",
  "toml", "ini", "diff", "makefile"
] as const;

const createPasteSchema = z.object({
  content: z.string().min(1).max(1024 * 1024),
  title: z.string().max(200).optional(),
  language: z.enum(languageValues).optional(),
  visibility: z.enum(["private", "unlisted", "public"]).optional(),
  password: z.string().min(4).max(100).optional(),
  expiresAt: z.string().datetime().optional(),
  burnAfterRead: z.boolean().optional(),
});

const updatePasteSchema = z.object({
  content: z.string().min(1).max(1024 * 1024).optional(),
  title: z.string().max(200).optional(),
  language: z.enum(languageValues).optional(),
  visibility: z.enum(["private", "unlisted", "public"]).optional(),
  password: z.string().min(4).max(100).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

// Create paste (auth optional)
pastesRoutes.post("/", optionalAuth, zValidator("json", createPasteSchema), async (c) => {
  const user = c.get("user");
  const input = c.req.valid("json");
  
  if (!user && input.visibility === "private") {
    return c.json({ error: "Anonymous users cannot create private pastes" }, 400);
  }
  
  const paste = await pastesService.createPaste({
    userId: user?.id,
    ...input,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
  });
  
  return c.json({ 
    success: true, 
    paste: {
      id: paste.id,
      title: paste.title,
      language: paste.language,
      visibility: paste.visibility,
      views: paste.views,
      createdAt: paste.createdAt,
      expiresAt: paste.expiresAt,
      burnAfterRead: paste.burnAfterRead,
    }
  }, 201);
});

// List user's pastes
pastesRoutes.get("/", requireAuth, async (c) => {
  const user = c.get("user");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");
  
  const result = await pastesService.listUserPastes(user.id, {
    limit: Math.min(limit, 100),
    offset,
  });
  
  return c.json({
    pastes: result.pastes.map(p => ({
      id: p.id,
      title: p.title,
      language: p.language,
      visibility: p.visibility,
      views: p.views,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
    })),
    total: result.total,
  });
});

// List public pastes (explore)
pastesRoutes.get("/explore", async (c) => {
  const limit = parseInt(c.req.query("limit") || "20");
  const offset = parseInt(c.req.query("offset") || "0");
  const language = c.req.query("language") as pastesService.SupportedLanguage | undefined;
  
  const pastes = await pastesService.listPublicPastes({
    limit: Math.min(limit, 50),
    offset,
    language,
  });
  
  return c.json({
    pastes: pastes.map(p => ({
      id: p.id,
      title: p.title,
      language: p.language,
      views: p.views,
      createdAt: p.createdAt,
    })),
  });
});

// Get paste by ID (public)
pastesRoutes.get("/:id", optionalAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  
  const paste = await pastesService.getPasteById(id);
  if (!paste) {
    return c.json({ error: "Paste not found" }, 404);
  }
  
  const access = pastesService.isPasteAccessible(paste, user?.id);
  if (!access.accessible) {
    return c.json({ error: access.reason }, 403);
  }
  
  if (access.requiresPassword) {
    return c.json({ 
      requiresPassword: true,
      paste: {
        id: paste.id,
        title: paste.title,
        language: paste.language,
      }
    });
  }
  
  const viewed = await pastesService.viewPaste(id);
  if (!viewed) {
    return c.json({ error: "Paste not available" }, 410);
  }
  
  return c.json({ 
    paste: {
      id: viewed.id,
      title: viewed.title,
      content: viewed.content,
      language: viewed.language,
      visibility: viewed.visibility,
      views: viewed.views + 1,
      createdAt: viewed.createdAt,
      expiresAt: viewed.expiresAt,
      burnAfterRead: viewed.burnAfterRead,
    }
  });
});

// Verify paste password
pastesRoutes.post("/:id/verify", zValidator("json", z.object({ password: z.string() })), async (c) => {
  const id = c.req.param("id");
  const { password } = c.req.valid("json");
  
  const valid = await pastesService.verifyPastePassword(id, password);
  if (!valid) {
    return c.json({ error: "Invalid password" }, 401);
  }
  
  const paste = await pastesService.viewPaste(id);
  if (!paste) {
    return c.json({ error: "Paste not available" }, 410);
  }
  
  return c.json({ 
    paste: {
      id: paste.id,
      title: paste.title,
      content: paste.content,
      language: paste.language,
      views: paste.views + 1,
      createdAt: paste.createdAt,
    }
  });
});

// Get raw content
pastesRoutes.get("/:id/raw", async (c) => {
  const id = c.req.param("id");
  
  const content = await pastesService.getRawContent(id);
  if (content === null) {
    return c.json({ error: "Paste not found or not accessible" }, 404);
  }
  
  return c.text(content, 200, {
    "Content-Type": "text/plain; charset=utf-8",
  });
});

// Update paste
pastesRoutes.patch("/:id", requireAuth, zValidator("json", updatePasteSchema), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const input = c.req.valid("json");
  
  const updated = await pastesService.updatePaste(id, user.id, {
    ...input,
    expiresAt: input.expiresAt === null 
      ? null 
      : input.expiresAt 
        ? new Date(input.expiresAt) 
        : undefined,
  });
  
  if (!updated) {
    return c.json({ error: "Paste not found" }, 404);
  }
  
  return c.json({ paste: updated });
});

// Delete paste
pastesRoutes.delete("/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  
  const deleted = await pastesService.deletePaste(id, user.id);
  if (!deleted) {
    return c.json({ error: "Paste not found" }, 404);
  }
  
  return c.json({ success: true });
});

// Get supported languages
pastesRoutes.get("/meta/languages", async (c) => {
  return c.json({ languages: pastesService.SUPPORTED_LANGUAGES });
});

export { pastesRoutes };
