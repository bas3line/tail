import { db, links, linkClicks, type Link, type NewLink, eq, and, isNull, desc, sql } from "@tails/db";
import { cacheGet, cacheSet, cacheDelete, CacheNamespaces } from "@tails/cache";
import { getRedis, isRedisAvailable } from "@tails/redis";
import { createLogger } from "@tails/logger";
import { generateQRCode, type QRCodeFormat, type QRCodeResult } from "../qrcode/qrcode.service";
import { toZonedTime } from "date-fns-tz";
import crypto from "crypto";

const log = createLogger("links-service");

const CACHE_CONFIG = {
  namespace: CacheNamespaces.LINKS,
  memoryTTL: 120, // Links are accessed frequently
  redisTTL: 600,
};

// Slug pool configuration
const SLUG_POOL_KEY = "links:slug_pool";
const SLUG_POOL_MIN_SIZE = 100;
const SLUG_POOL_REFILL_SIZE = 200;
const SLUG_LENGTH = 6;

// Generate random slug - optimized with base62 encoding
const SLUG_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function generateSlug(length = SLUG_LENGTH): string {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += SLUG_CHARS[bytes[i] % 62];
  }
  return result;
}

// Generate multiple slugs at once for pool
function generateSlugs(count: number, length = SLUG_LENGTH): string[] {
  const slugs: string[] = [];
  const bytes = crypto.randomBytes(count * length);
  for (let i = 0; i < count; i++) {
    let slug = "";
    for (let j = 0; j < length; j++) {
      slug += SLUG_CHARS[bytes[i * length + j] % 62];
    }
    slugs.push(slug);
  }
  return slugs;
}

// Slug pool management for fast slug allocation
let isRefilling = false;

async function refillSlugPool(): Promise<void> {
  if (isRefilling || !isRedisAvailable()) return;

  isRefilling = true;
  try {
    const redis = getRedis();
    const currentSize = await redis.scard(SLUG_POOL_KEY);

    if (currentSize < SLUG_POOL_MIN_SIZE) {
      const slugs = generateSlugs(SLUG_POOL_REFILL_SIZE);
      if (slugs.length > 0) {
        await redis.sadd(SLUG_POOL_KEY, ...slugs);
        log.debug("Refilled slug pool", { added: slugs.length, newSize: currentSize + slugs.length });
      }
    }
  } catch (err) {
    log.error("Failed to refill slug pool", err as Error);
  } finally {
    isRefilling = false;
  }
}

async function getSlugFromPool(): Promise<string | null> {
  if (!isRedisAvailable()) return null;

  try {
    const redis = getRedis();
    const slug = await redis.spop(SLUG_POOL_KEY);

    // Check pool size and trigger refill if needed (non-blocking)
    const size = await redis.scard(SLUG_POOL_KEY);
    if (size < SLUG_POOL_MIN_SIZE) {
      setImmediate(() => refillSlugPool());
    }

    return slug;
  } catch (err) {
    log.error("Failed to get slug from pool", err as Error);
    return null;
  }
}

// Initialize slug pool on startup
setImmediate(() => refillSlugPool());

export interface CreateLinkInput {
  userId: string;
  url: string;
  slug?: string;
  title?: string;
  description?: string;
  redirectType?: number;
  expiresAt?: Date;
  startsAt?: Date;
  timezone?: string;
  gracePeriod?: number;
  autoArchive?: boolean;
  maxClicks?: number;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

export interface UpdateLinkInput {
  url?: string;
  title?: string;
  description?: string;
  active?: boolean;
  redirectType?: number;
  expiresAt?: Date | null;
  startsAt?: Date | null;
  timezone?: string | null;
  gracePeriod?: number | null;
  autoArchive?: boolean;
  maxClicks?: number | null;
}

/**
 * Create a new short link
 */
function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error("Only HTTP and HTTPS URLs are allowed");
    }
    return url;
  } catch (error) {
    throw new Error("Invalid URL format");
  }
}

const BLOCKED_DOMAINS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::]',
  '169.254.',
  '10.',
  '192.168.',
  '172.16.',
];

function isUrlAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    for (const blocked of BLOCKED_DOMAINS) {
      if (hostname === blocked || hostname.startsWith(blocked)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

export async function createLink(input: CreateLinkInput): Promise<Link> {
  const { userId, url, slug, title, description, redirectType, expiresAt, startsAt, timezone, gracePeriod, autoArchive, maxClicks, utmSource, utmMedium, utmCampaign } = input;

  const sanitizedUrl = sanitizeUrl(url);

  if (!isUrlAllowed(sanitizedUrl)) {
    throw new Error("URL not allowed - private/local addresses are blocked");
  }

  const id = crypto.randomUUID();

  // Custom slug: validate uniqueness
  if (slug) {
    const [existing] = await db.select({ id: links.id })
      .from(links)
      .where(and(eq(links.slug, slug), isNull(links.deletedAt)))
      .limit(1);

    if (existing) {
      throw new Error("Slug already taken");
    }
  }

  // Get slug from pool or generate one - fast path uses Redis pool
  let finalSlug = slug || await getSlugFromPool() || generateSlug();

  const insertLink = async (slugToUse: string): Promise<Link> => {
    const [link] = await db.insert(links).values({
      id,
      userId,
      slug: slugToUse,
      url: sanitizedUrl,
      title,
      description,
      redirectType: redirectType || 302,
      expiresAt,
      startsAt,
      timezone,
      gracePeriod,
      autoArchive: autoArchive || false,
      maxClicks,
      utmSource,
      utmMedium,
      utmCampaign,
    }).returning();
    return link;
  };

  try {
    const link = await insertLink(finalSlug);
    log.info("Link created", { id, slug: finalSlug, userId });
    return link;
  } catch (err: any) {
    // Unique constraint violation - retry with longer slug (only for auto-generated slugs)
    if (err.code === '23505' && !slug) {
      finalSlug = generateSlug(8);
      const link = await insertLink(finalSlug);
      log.info("Link created", { id: link.id, slug: finalSlug, userId });
      return link;
    }
    throw err;
  }
}

/**
 * Get link by slug (for redirects)
 * Supports both main slugs and aliases
 */
export async function getLinkBySlug(slug: string): Promise<Link | null> {
  // Try cache first
  const cached = await cacheGet<Link>(`slug:${slug}`, CACHE_CONFIG);
  if (cached) return cached;

  // Try main links table first
  const [link] = await db.select()
    .from(links)
    .where(and(
      eq(links.slug, slug),
      isNull(links.deletedAt)
    ))
    .limit(1);

  if (link) {
    await cacheSet(`slug:${slug}`, link, CACHE_CONFIG);
    return link;
  }

  // Try aliases table
  const { getLinkIdByAlias } = await import("./aliases.service");
  const linkId = await getLinkIdByAlias(slug);

  if (linkId) {
    const aliasedLink = await getLinkById(linkId);
    if (aliasedLink) {
      await cacheSet(`slug:${slug}`, aliasedLink, CACHE_CONFIG);
      return aliasedLink;
    }
  }

  return null;
}

/**
 * Get link by ID
 */
export async function getLinkById(
  id: string,
  userId?: string
): Promise<Link | null> {
  const conditions = [eq(links.id, id), isNull(links.deletedAt)];
  if (userId) {
    conditions.push(eq(links.userId, userId));
  }
  
  const [link] = await db.select()
    .from(links)
    .where(and(...conditions))
    .limit(1);
  
  return link || null;
}

/**
 * Check if link is valid for redirect
 */
export function isLinkValid(link: Link): { valid: boolean; reason?: string } {
  if (!link.active) {
    return { valid: false, reason: "Link is disabled" };
  }

  const now = new Date();
  const tz = link.timezone || "UTC";

  // Check if link has started (with timezone support)
  if (link.startsAt) {
    try {
      const startsAtInTz = toZonedTime(new Date(link.startsAt), tz);
      const nowInTz = toZonedTime(now, tz);
      if (nowInTz < startsAtInTz) {
        return { valid: false, reason: "Link is not yet active" };
      }
    } catch (err) {
      log.error("Invalid timezone for link", err as Error, { linkId: link.id, timezone: tz });
      // Fall back to UTC comparison
      if (new Date(link.startsAt) > now) {
        return { valid: false, reason: "Link is not yet active" };
      }
    }
  }

  // Check expiry with grace period (with timezone support)
  if (link.expiresAt) {
    try {
      const expiresAtInTz = toZonedTime(new Date(link.expiresAt), tz);
      const nowInTz = toZonedTime(now, tz);

      // Add grace period (in seconds)
      if (link.gracePeriod) {
        expiresAtInTz.setSeconds(expiresAtInTz.getSeconds() + link.gracePeriod);
      }

      if (nowInTz > expiresAtInTz) {
        return { valid: false, reason: "Link has expired" };
      }
    } catch (err) {
      log.error("Invalid timezone for link", err as Error, { linkId: link.id, timezone: tz });
      // Fall back to UTC comparison
      let expiryDate = new Date(link.expiresAt);
      if (link.gracePeriod) {
        expiryDate = new Date(expiryDate.getTime() + link.gracePeriod * 1000);
      }
      if (now > expiryDate) {
        return { valid: false, reason: "Link has expired" };
      }
    }
  }

  if (link.maxClicks && link.clicks >= link.maxClicks) {
    return { valid: false, reason: "Link has reached max clicks" };
  }

  return { valid: true };
}

export async function recordClick(
  slug: string,
  clickData: {
    ip?: string;
    userAgent?: string;
    referer?: string;
    country?: string;
    city?: string;
    device?: string;
    browser?: string;
    os?: string;
  }
): Promise<{ url: string; redirectType: number } | null> {
  const link = await getLinkBySlug(slug);
  if (!link) return null;

  const validity = isLinkValid(link);
  if (!validity.valid) return null;

  let finalUrl = link.url;

  // Add UTM parameters
  const utmParams = new URLSearchParams();
  if (link.utmSource) utmParams.set("utm_source", link.utmSource);
  if (link.utmMedium) utmParams.set("utm_medium", link.utmMedium);
  if (link.utmCampaign) utmParams.set("utm_campaign", link.utmCampaign);

  if (utmParams.toString()) {
    const separator = finalUrl.includes("?") ? "&" : "?";
    finalUrl += separator + utmParams.toString();
  }

  // Generate session ID (hash of IP + User Agent with daily salt)
  const sessionSalt = new Date().toISOString().split('T')[0]; // Daily salt (YYYY-MM-DD)
  const sessionData = `${clickData.ip || ''}:${clickData.userAgent || ''}:${sessionSalt}`;
  const sessionId = crypto.createHash("sha256").update(sessionData).digest("hex").slice(0, 16);

  // Get hour of day (0-23)
  const hour = new Date().getHours();

  setImmediate(() => {
    Promise.all([
      db.update(links)
        .set({ clicks: sql`${links.clicks} + 1` })
        .where(eq(links.id, link.id))
        .catch((err: Error) => log.error("Failed to increment click count", err)),

      db.insert(linkClicks).values({
        id: crypto.randomUUID(),
        linkId: link.id,
        ip: clickData.ip ? crypto.createHash("sha256").update(clickData.ip).digest("hex").slice(0, 16) : null,
        userAgent: clickData.userAgent?.slice(0, 500),
        referer: clickData.referer?.slice(0, 500),
        country: clickData.country,
        city: clickData.city,
        device: clickData.device,
        browser: clickData.browser,
        os: clickData.os,
        sessionId,
        hour,
      }).catch((err: Error) => log.error("Failed to record click analytics", err)),
    ]).catch((err: Error) => log.error("Failed to record click", err));
  });

  return { url: finalUrl, redirectType: link.redirectType };
}

/**
 * List user's links
 */
export async function listUserLinks(
  userId: string,
  options?: {
    limit?: number;
    offset?: number;
    active?: boolean;
    tagIds?: string[];
  }
): Promise<{ links: Link[]; total: number }> {
  const { limit = 50, offset = 0, active, tagIds } = options || {};

  const conditions = [
    eq(links.userId, userId),
    isNull(links.deletedAt),
  ];

  if (active !== undefined) {
    conditions.push(eq(links.active, active));
  }

  // If filtering by tags, get link IDs first
  if (tagIds && tagIds.length > 0) {
    const { getLinkIdsByTags } = await import("./tags.service");
    const linkIds = await getLinkIdsByTags(tagIds);

    if (linkIds.length === 0) {
      // No links match the tags
      return { links: [], total: 0 };
    }

    const { inArray } = await import("@tails/db");
    conditions.push(inArray(links.id, linkIds));
  }

  const [result, countResult] = await Promise.all([
    db.select()
      .from(links)
      .where(and(...conditions))
      .orderBy(desc(links.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` })
      .from(links)
      .where(and(...conditions)),
  ]);

  return {
    links: result,
    total: Number(countResult[0]?.count || 0),
  };
}

/**
 * Update link
 */
export async function updateLink(
  id: string,
  userId: string,
  input: UpdateLinkInput
): Promise<Link | null> {
  const link = await getLinkById(id, userId);
  if (!link) return null;

  const updates: Partial<NewLink> = {
    updatedAt: new Date(),
  };

  if (input.url !== undefined) {
    const sanitizedUrl = sanitizeUrl(input.url);
    if (!isUrlAllowed(sanitizedUrl)) {
      throw new Error("URL not allowed - private/local addresses are blocked");
    }
    updates.url = sanitizedUrl;
  }
  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.active !== undefined) updates.active = input.active;
  if (input.redirectType !== undefined) updates.redirectType = input.redirectType;
  if (input.expiresAt !== undefined) updates.expiresAt = input.expiresAt;
  if (input.startsAt !== undefined) updates.startsAt = input.startsAt;
  if (input.timezone !== undefined) updates.timezone = input.timezone;
  if (input.gracePeriod !== undefined) updates.gracePeriod = input.gracePeriod;
  if (input.autoArchive !== undefined) updates.autoArchive = input.autoArchive;
  if (input.maxClicks !== undefined) updates.maxClicks = input.maxClicks;

  const [updated] = await db.update(links)
    .set(updates)
    .where(and(eq(links.id, id), eq(links.userId, userId)))
    .returning();

  if (updated) {
    setImmediate(() => {
      cacheDelete(`slug:${link.slug}`, { namespace: CacheNamespaces.LINKS })
        .catch(err => log.error("Failed to invalidate cache", err));
    });
  }

  log.info("Link updated", { id, userId });

  return updated || null;
}

/**
 * Delete link (soft delete)
 */
export async function deleteLink(
  id: string,
  userId: string
): Promise<boolean> {
  const link = await getLinkById(id, userId);
  if (!link) return false;
  
  await db.update(links)
    .set({ deletedAt: new Date() })
    .where(and(eq(links.id, id), eq(links.userId, userId)));

  setImmediate(() => {
    cacheDelete(`slug:${link.slug}`, { namespace: CacheNamespaces.LINKS })
      .catch(err => log.error("Failed to invalidate cache", err));
  });

  log.info("Link deleted", { id, userId });

  return true;
}

/**
 * Get link analytics
 */
export async function getLinkAnalytics(
  id: string,
  userId: string,
  options?: {
    startDate?: Date;
    endDate?: Date;
  }
): Promise<{
  totalClicks: number;
  clicksByDay: Array<{ date: string; clicks: number }>;
  topCountries: Array<{ country: string; clicks: number }>;
  topReferers: Array<{ referer: string; clicks: number }>;
  browsers: Array<{ browser: string; clicks: number }>;
  devices: Array<{ device: string; clicks: number }>;
}> {
  const link = await getLinkById(id, userId);
  if (!link) {
    throw new Error("Link not found");
  }
  
  const startDate = options?.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = options?.endDate || new Date();
  const startDateStr = startDate.toISOString();
  const endDateStr = endDate.toISOString();

  // Get clicks in date range
  const clicks = await db.select()
    .from(linkClicks)
    .where(and(
      eq(linkClicks.linkId, id),
      sql`${linkClicks.clickedAt} >= ${startDateStr}::timestamp`,
      sql`${linkClicks.clickedAt} <= ${endDateStr}::timestamp`
    ));
  
  // Aggregate data
  const clicksByDay = new Map<string, number>();
  const countries = new Map<string, number>();
  const referers = new Map<string, number>();
  const browsers = new Map<string, number>();
  const devices = new Map<string, number>();
  
  for (const click of clicks) {
    const day = new Date(click.clickedAt).toISOString().split("T")[0];
    clicksByDay.set(day, (clicksByDay.get(day) || 0) + 1);
    
    if (click.country) {
      countries.set(click.country, (countries.get(click.country) || 0) + 1);
    }
    if (click.referer) {
      referers.set(click.referer, (referers.get(click.referer) || 0) + 1);
    }
    if (click.browser) {
      browsers.set(click.browser, (browsers.get(click.browser) || 0) + 1);
    }
    if (click.device) {
      devices.set(click.device, (devices.get(click.device) || 0) + 1);
    }
  }
  
  return {
    totalClicks: clicks.length,
    clicksByDay: Array.from(clicksByDay.entries())
      .map(([date, clicks]) => ({ date, clicks }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    topCountries: Array.from(countries.entries())
      .map(([country, clicks]) => ({ country, clicks }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10),
    topReferers: Array.from(referers.entries())
      .map(([referer, clicks]) => ({ referer, clicks }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10),
    browsers: Array.from(browsers.entries())
      .map(([browser, clicks]) => ({ browser, clicks }))
      .sort((a, b) => b.clicks - a.clicks),
    devices: Array.from(devices.entries())
      .map(([device, clicks]) => ({ device, clicks }))
      .sort((a, b) => b.clicks - a.clicks),
  };
}

/**
 * Generate QR code for a link
 */
export async function getLinkQRCode(
  id: string,
  format: "png" | "svg" = "png",
  width: number = 300
): Promise<QRCodeResult> {
  const cacheKey = `qr:${id}:${format}:${width}`;

  // Try cache first
  const cached = await cacheGet<QRCodeResult>(cacheKey, {
    namespace: CacheNamespaces.LINKS,
    memoryTTL: 3600,
    redisTTL: 3600,
  });
  if (cached) return cached;

  const [link] = await db.select()
    .from(links)
    .where(and(eq(links.id, id), isNull(links.deletedAt)))
    .limit(1);

  if (!link) {
    throw new Error("Link not found");
  }

  // Generate short URL
  const baseUrl = process.env.WEB_URL || "http://localhost:3000";
  const shortUrl = `${baseUrl}/l/${link.slug}`;

  // Generate QR code
  const qrCode = await generateQRCode(shortUrl, {
    format: format as QRCodeFormat,
    width,
    errorCorrectionLevel: "M",
  });

  // Cache the result
  await cacheSet(cacheKey, qrCode, {
    namespace: CacheNamespaces.LINKS,
    memoryTTL: 3600,
    redisTTL: 3600,
  });

  return qrCode;
}

