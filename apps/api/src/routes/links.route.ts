import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth, optionalAuth } from "../middleware/auth.middleware";
import { createLogger } from "@tails/logger";
import type { AppVariables } from "../types";
import * as linksService from "../services/links";

const log = createLogger("links-route");

const linksRoutes = new Hono<{ Variables: AppVariables }>();

// Validation schemas
const createLinkSchema = z.object({
  url: z.string().url().max(2048),
  slug: z.string().min(2).max(50).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  password: z.string().min(4).max(100).optional(),
  expiresAt: z.string().datetime().optional(),
  maxClicks: z.number().int().positive().optional(),
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
});

const updateLinkSchema = z.object({
  url: z.string().url().max(2048).optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  password: z.string().min(4).max(100).nullable().optional(),
  active: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  maxClicks: z.number().int().positive().nullable().optional(),
});

// Create link
linksRoutes.post("/", requireAuth, zValidator("json", createLinkSchema), async (c) => {
  const user = c.get("user");
  const input = c.req.valid("json");
  
  try {
    const link = await linksService.createLink({
      userId: user.id,
      ...input,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
    });
    
    return c.json({ 
      success: true, 
      link: {
        id: link.id,
        slug: link.slug,
        url: link.url,
        title: link.title,
        clicks: link.clicks,
        active: link.active,
        createdAt: link.createdAt,
      }
    }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === "Slug already taken") {
      return c.json({ error: "Slug already taken" }, 409);
    }
    throw error;
  }
});

// List links
linksRoutes.get("/", requireAuth, async (c) => {
  const user = c.get("user");
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");
  const active = c.req.query("active");
  
  const result = await linksService.listUserLinks(user.id, {
    limit: Math.min(limit, 100),
    offset,
    active: active === undefined ? undefined : active === "true",
  });
  
  return c.json({
    links: result.links.map(l => ({
      id: l.id,
      slug: l.slug,
      url: l.url,
      title: l.title,
      clicks: l.clicks,
      active: l.active,
      expiresAt: l.expiresAt,
      createdAt: l.createdAt,
    })),
    total: result.total,
  });
});

// Get link by ID
linksRoutes.get("/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  
  const link = await linksService.getLinkById(id, user.id);
  if (!link) {
    return c.json({ error: "Link not found" }, 404);
  }
  
  return c.json({ link });
});

// Get link analytics
linksRoutes.get("/:id/analytics", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  
  try {
    const analytics = await linksService.getLinkAnalytics(id, user.id, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
    
    return c.json(analytics);
  } catch (error) {
    if (error instanceof Error && error.message === "Link not found") {
      return c.json({ error: "Link not found" }, 404);
    }
    throw error;
  }
});

// Update link
linksRoutes.patch("/:id", requireAuth, zValidator("json", updateLinkSchema), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const input = c.req.valid("json");
  
  const updated = await linksService.updateLink(id, user.id, {
    ...input,
    expiresAt: input.expiresAt === null 
      ? null 
      : input.expiresAt 
        ? new Date(input.expiresAt) 
        : undefined,
  });
  
  if (!updated) {
    return c.json({ error: "Link not found" }, 404);
  }
  
  return c.json({ link: updated });
});

// Delete link
linksRoutes.delete("/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  
  const deleted = await linksService.deleteLink(id, user.id);
  if (!deleted) {
    return c.json({ error: "Link not found" }, 404);
  }
  
  return c.json({ success: true });
});

// Redirect route (public)
linksRoutes.get("/r/:slug", async (c) => {
  const slug = c.req.param("slug");
  
  const link = await linksService.getLinkBySlug(slug);
  if (!link) {
    return c.json({ error: "Link not found" }, 404);
  }
  
  // Check if password protected
  if (link.password) {
    return c.json({ 
      requiresPassword: true,
      slug: link.slug,
      title: link.title,
    });
  }
  
  // Check validity
  const validity = linksService.isLinkValid(link);
  if (!validity.valid) {
    return c.json({ error: validity.reason }, 410);
  }
  
  // Record click and get URL
  const result = await linksService.recordClick(slug, {
    ip: c.req.header("x-forwarded-for") || c.req.header("x-real-ip"),
    userAgent: c.req.header("user-agent"),
    referer: c.req.header("referer"),
  });
  
  if (!result) {
    return c.json({ error: "Link not available" }, 410);
  }
  
  return c.redirect(result.url, 302);
});

// Verify password and redirect
linksRoutes.post("/r/:slug/verify", zValidator("json", z.object({ password: z.string() })), async (c) => {
  const slug = c.req.param("slug");
  const { password } = c.req.valid("json");
  
  const valid = await linksService.verifyLinkPassword(slug, password);
  if (!valid) {
    return c.json({ error: "Invalid password" }, 401);
  }
  
  const result = await linksService.recordClick(slug, {
    ip: c.req.header("x-forwarded-for") || c.req.header("x-real-ip"),
    userAgent: c.req.header("user-agent"),
    referer: c.req.header("referer"),
  });
  
  if (!result) {
    return c.json({ error: "Link not available" }, 410);
  }
  
  return c.json({ url: result.url });
});

export { linksRoutes };
