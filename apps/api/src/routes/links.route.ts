import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware";
import { rateLimiters } from "../middleware/security.middleware";
import { createLogger } from "@tails/logger";
import type { AppVariables } from "../types";
import * as linksService from "../services/links";
import * as tagsService from "../services/links/tags.service";
import * as analyticsService from "../services/links/analytics.service";
import * as metadataService from "../services/links/metadata.service";
import * as aliasesService from "../services/links/aliases.service";

const log = createLogger("links-route");

const linksRoutes = new Hono<{ Variables: AppVariables }>();

// Validation schemas
const createLinkSchema = z.object({
  url: z.string().url().max(2048),
  slug: z.string().min(2).max(50).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  redirectType: z.enum(["301", "302", "307", "308"]).optional(),
  expiresAt: z.string().datetime().optional(),
  startsAt: z.string().datetime().optional(),
  timezone: z.string().max(100).optional(),
  gracePeriod: z.number().int().min(0).max(86400).optional(), // Max 24 hours
  autoArchive: z.boolean().optional(),
  maxClicks: z.number().int().positive().optional(),
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
});

const updateLinkSchema = z.object({
  url: z.string().url().max(2048).optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  active: z.boolean().optional(),
  redirectType: z.enum(["301", "302", "307", "308"]).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  timezone: z.string().max(100).nullable().optional(),
  gracePeriod: z.number().int().min(0).max(86400).nullable().optional(),
  autoArchive: z.boolean().optional(),
  maxClicks: z.number().int().positive().nullable().optional(),
});

// Create link
linksRoutes.post("/", rateLimiters.linkCreate, requireAuth, zValidator("json", createLinkSchema), async (c) => {
  const user = c.get("user");
  const input = c.req.valid("json");

  try {
    const link = await linksService.createLink({
      userId: user.id,
      ...input,
      redirectType: input.redirectType ? parseInt(input.redirectType) : undefined,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
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
  const tagsQuery = c.req.query("tags");

  // Parse tag IDs if provided
  const tagIds = tagsQuery ? tagsQuery.split(",").filter(Boolean) : undefined;

  const result = await linksService.listUserLinks(user.id, {
    limit: Math.min(limit, 100),
    offset,
    active: active === undefined ? undefined : active === "true",
    tagIds,
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

// Get hourly analytics
linksRoutes.get("/:id/analytics/hourly", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");

  // Verify ownership
  const link = await linksService.getLinkById(id, user.id);
  if (!link) {
    return c.json({ error: "Link not found" }, 404);
  }

  const hourly = await analyticsService.getHourlyAnalytics(id, {
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
  });

  return c.json({ hourly });
});

// Get click heatmap
linksRoutes.get("/:id/analytics/heatmap", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");

  // Verify ownership
  const link = await linksService.getLinkById(id, user.id);
  if (!link) {
    return c.json({ error: "Link not found" }, 404);
  }

  const heatmap = await analyticsService.getClickHeatmap(id, {
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
  });

  return c.json({ heatmap });
});

// Export analytics
linksRoutes.get("/:id/analytics/export", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const format = c.req.query("format") || "csv";
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");

  // Verify ownership
  const link = await linksService.getLinkById(id, user.id);
  if (!link) {
    return c.json({ error: "Link not found" }, 404);
  }

  if (format === "csv") {
    const csv = await analyticsService.exportAnalytics(id, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="link-${id}-analytics.csv"`,
      },
    });
  } else if (format === "json") {
    const json = await analyticsService.exportAnalyticsJSON(id, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });

    return c.json({ data: json });
  } else {
    return c.json({ error: "Invalid format. Use 'csv' or 'json'" }, 400);
  }
});

// Refresh link metadata
linksRoutes.post("/:id/metadata/refresh", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  // Verify ownership
  const link = await linksService.getLinkById(id, user.id);
  if (!link) {
    return c.json({ error: "Link not found" }, 404);
  }

  try {
    const metadata = await metadataService.refreshLinkMetadata(id);

    return c.json({
      success: true,
      metadata,
    });
  } catch (error) {
    log.error("Failed to refresh metadata", error as Error);
    return c.json({
      error: "Failed to fetch metadata",
      details: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

// Update link
linksRoutes.patch("/:id", requireAuth, zValidator("json", updateLinkSchema), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const input = c.req.valid("json");

  const updated = await linksService.updateLink(id, user.id, {
    ...input,
    redirectType: input.redirectType ? parseInt(input.redirectType) : undefined,
    expiresAt: input.expiresAt === null
      ? null
      : input.expiresAt
        ? new Date(input.expiresAt)
        : undefined,
    startsAt: input.startsAt === null
      ? null
      : input.startsAt
        ? new Date(input.startsAt)
        : undefined,
  });

  if (!updated) {
    return c.json({ error: "Link not found" }, 404);
  }

  return c.json({ link: updated });
});

// Delete link
linksRoutes.delete("/:id", rateLimiters.linkDelete, requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const deleted = await linksService.deleteLink(id, user.id);
  if (!deleted) {
    return c.json({ error: "Link not found" }, 404);
  }

  return c.json({ success: true });
});

// Get link QR code
linksRoutes.get("/:id/qr", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const format = c.req.query("format") || "png";
  const width = parseInt(c.req.query("width") || "300");

  // Validate format
  if (!["png", "svg"].includes(format)) {
    return c.json({ error: "Invalid format. Use 'png' or 'svg'" }, 400);
  }

  // Validate width
  if (width < 100 || width > 2000) {
    return c.json({ error: "Width must be between 100 and 2000" }, 400);
  }

  const link = await linksService.getLinkById(id, user.id);
  if (!link) {
    return c.json({ error: "Link not found" }, 404);
  }

  try {
    const qrCode = await linksService.getLinkQRCode(id, format as "png" | "svg", width);

    return new Response(qrCode.data, {
      headers: {
        "Content-Type": qrCode.mimeType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    log.error("Failed to generate QR code", error as Error);
    return c.json({ error: "Failed to generate QR code" }, 500);
  }
});

// Add tag to link
linksRoutes.post("/:id/tags", requireAuth, zValidator("json", z.object({ tagId: z.string() })), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const { tagId } = c.req.valid("json");

  // Verify link ownership
  const link = await linksService.getLinkById(id, user.id);
  if (!link) {
    return c.json({ error: "Link not found" }, 404);
  }

  // Verify tag ownership
  const tag = await tagsService.getTagById(tagId, user.id);
  if (!tag) {
    return c.json({ error: "Tag not found" }, 404);
  }

  await tagsService.addTagToLink(id, tagId);

  return c.json({ success: true });
});

// Remove tag from link
linksRoutes.delete("/:id/tags/:tagId", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const tagId = c.req.param("tagId");

  // Verify link ownership
  const link = await linksService.getLinkById(id, user.id);
  if (!link) {
    return c.json({ error: "Link not found" }, 404);
  }

  const deleted = await tagsService.removeTagFromLink(id, tagId);
  if (!deleted) {
    return c.json({ error: "Tag not found on link" }, 404);
  }

  return c.json({ success: true });
});

// Get link tags
linksRoutes.get("/:id/tags", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  // Verify link ownership
  const link = await linksService.getLinkById(id, user.id);
  if (!link) {
    return c.json({ error: "Link not found" }, 404);
  }

  const tags = await tagsService.getLinkTags(id);

  return c.json({ tags });
});

// Create alias
linksRoutes.post("/:id/aliases", requireAuth, zValidator("json", z.object({
  slug: z.string().min(2).max(50).regex(/^[a-zA-Z0-9_-]+$/),
})), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const { slug } = c.req.valid("json");

  // Verify link ownership
  const link = await linksService.getLinkById(id, user.id);
  if (!link) {
    return c.json({ error: "Link not found" }, 404);
  }

  try {
    const alias = await aliasesService.createAlias({
      linkId: id,
      slug,
    });

    return c.json({ alias }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === "Slug already taken") {
      return c.json({ error: "Slug already taken" }, 409);
    }
    log.error("Failed to create alias", error as Error);
    return c.json({ error: "Failed to create alias" }, 400);
  }
});

// List link aliases
linksRoutes.get("/:id/aliases", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  // Verify link ownership
  const link = await linksService.getLinkById(id, user.id);
  if (!link) {
    return c.json({ error: "Link not found" }, 404);
  }

  const aliases = await aliasesService.getLinkAliases(id);

  return c.json({ aliases });
});

// Delete alias
linksRoutes.delete("/:id/aliases/:aliasId", requireAuth, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const aliasId = c.req.param("aliasId");

  // Verify link ownership
  const link = await linksService.getLinkById(id, user.id);
  if (!link) {
    return c.json({ error: "Link not found" }, 404);
  }

  const deleted = await aliasesService.deleteAlias(aliasId, id);
  if (!deleted) {
    return c.json({ error: "Alias not found" }, 404);
  }

  return c.json({ success: true });
});

// Redirect route (public)
linksRoutes.get("/r/:slug", rateLimiters.linkRedirect, async (c) => {
  const slug = c.req.param("slug");

  const link = await linksService.getLinkBySlug(slug);
  if (!link) {
    return c.json({ error: "Link not found" }, 404);
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

  return c.redirect(result.url, result.redirectType as 301 | 302 | 307 | 308);
});

export { linksRoutes };
