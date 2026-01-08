import { db, links, linkClicks, type Link, type NewLink, type LinkClick, eq, and, isNull, desc, sql } from "@tails/db";
import { cacheGet, cacheSet, cacheDelete, CacheNamespaces } from "@tails/cache";
import { createLogger } from "@tails/logger";
import crypto from "crypto";

const log = createLogger("links-service");

const CACHE_CONFIG = {
  namespace: CacheNamespaces.LINKS,
  memoryTTL: 120, // Links are accessed frequently
  redisTTL: 600,
};

// Password hashing
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 64, "sha512", (err, key) => {
      if (err) reject(err);
      resolve(`${salt}:${key.toString("hex")}`);
    });
  });
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(":");
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 64, "sha512", (err, derivedKey) => {
      if (err) reject(err);
      resolve(key === derivedKey.toString("hex"));
    });
  });
}

// Generate random slug
function generateSlug(length = 6): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export interface CreateLinkInput {
  userId: string;
  url: string;
  slug?: string;
  title?: string;
  description?: string;
  password?: string;
  expiresAt?: Date;
  maxClicks?: number;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

export interface UpdateLinkInput {
  url?: string;
  title?: string;
  description?: string;
  password?: string | null;
  active?: boolean;
  expiresAt?: Date | null;
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
  const { userId, url, slug, title, description, password, expiresAt, maxClicks, utmSource, utmMedium, utmCampaign } = input;

  const sanitizedUrl = sanitizeUrl(url);

  if (!isUrlAllowed(sanitizedUrl)) {
    throw new Error("URL not allowed - private/local addresses are blocked");
  }

  const id = crypto.randomUUID();
  let finalSlug = slug || generateSlug();

  if (slug) {
    const [existing] = await db.select()
      .from(links)
      .where(and(eq(links.slug, slug), isNull(links.deletedAt)))
      .limit(1);

    if (existing) {
      throw new Error("Slug already taken");
    }
  }

  const passwordHash = password ? await hashPassword(password) : null;

  try {
    const [link] = await db.insert(links).values({
      id,
      userId,
      slug: finalSlug,
      url: sanitizedUrl,
      title,
      description,
      password: passwordHash,
      expiresAt,
      maxClicks,
      utmSource,
      utmMedium,
      utmCampaign,
    }).returning();

    log.info("Link created", { id, slug: finalSlug, userId });
    return link;
  } catch (err: any) {
    if (err.code === '23505' && !slug) {
      finalSlug = generateSlug(8);
      const [link] = await db.insert(links).values({
        id: crypto.randomUUID(),
        userId,
        slug: finalSlug,
        url: sanitizedUrl,
        title,
        description,
        password: passwordHash,
        expiresAt,
        maxClicks,
        utmSource,
        utmMedium,
        utmCampaign,
      }).returning();

      log.info("Link created", { id: link.id, slug: finalSlug, userId });
      return link;
    }
    throw err;
  }
}

/**
 * Get link by slug (for redirects)
 */
export async function getLinkBySlug(slug: string): Promise<Link | null> {
  // Try cache first
  const cached = await cacheGet<Link>(`slug:${slug}`, CACHE_CONFIG);
  if (cached) return cached;
  
  const [link] = await db.select()
    .from(links)
    .where(and(
      eq(links.slug, slug),
      isNull(links.deletedAt)
    ))
    .limit(1);
  
  if (link) {
    await cacheSet(`slug:${slug}`, link, CACHE_CONFIG);
  }
  
  return link || null;
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
 * Verify link password
 */
export async function verifyLinkPassword(
  slug: string,
  password: string
): Promise<boolean> {
  const link = await getLinkBySlug(slug);
  if (!link || !link.password) return false;
  
  return verifyPassword(password, link.password);
}

/**
 * Check if link is valid for redirect
 */
export function isLinkValid(link: Link): { valid: boolean; reason?: string } {
  if (!link.active) {
    return { valid: false, reason: "Link is disabled" };
  }
  
  if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
    return { valid: false, reason: "Link has expired" };
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
): Promise<{ url: string } | null> {
  const link = await getLinkBySlug(slug);
  if (!link) return null;

  const validity = isLinkValid(link);
  if (!validity.valid) return null;

  let finalUrl = link.url;
  const utmParams = new URLSearchParams();
  if (link.utmSource) utmParams.set("utm_source", link.utmSource);
  if (link.utmMedium) utmParams.set("utm_medium", link.utmMedium);
  if (link.utmCampaign) utmParams.set("utm_campaign", link.utmCampaign);

  if (utmParams.toString()) {
    const separator = finalUrl.includes("?") ? "&" : "?";
    finalUrl += separator + utmParams.toString();
  }

  setImmediate(() => {
    Promise.all([
      db.update(links)
        .set({ clicks: sql`${links.clicks} + 1` })
        .where(eq(links.id, link.id))
        .catch(err => log.error("Failed to increment click count", err)),

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
      }).catch(err => log.error("Failed to record click analytics", err)),
    ]).catch(err => log.error("Failed to record click", err));
  });

  return { url: finalUrl };
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
  }
): Promise<{ links: Link[]; total: number }> {
  const { limit = 50, offset = 0, active } = options || {};
  
  const conditions = [
    eq(links.userId, userId),
    isNull(links.deletedAt),
  ];
  
  if (active !== undefined) {
    conditions.push(eq(links.active, active));
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
  if (input.expiresAt !== undefined) updates.expiresAt = input.expiresAt;
  if (input.maxClicks !== undefined) updates.maxClicks = input.maxClicks;
  
  if (input.password !== undefined) {
    updates.password = input.password 
      ? await hashPassword(input.password)
      : null;
  }
  
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
  
  // Get clicks in date range
  const clicks = await db.select()
    .from(linkClicks)
    .where(and(
      eq(linkClicks.linkId, id),
      sql`${linkClicks.clickedAt} >= ${startDate}`,
      sql`${linkClicks.clickedAt} <= ${endDate}`
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

