import { db, linkAliases, type LinkAlias, eq, and, isNull } from "@tails/db";
import { cacheGet, cacheSet, cacheDelete, CacheNamespaces } from "@tails/cache";
import { createLogger } from "@tails/logger";
import crypto from "crypto";

const log = createLogger("aliases-service");

const CACHE_CONFIG = {
  namespace: CacheNamespaces.LINKS,
  memoryTTL: 600,
  redisTTL: 600,
};

export interface CreateAliasInput {
  linkId: string;
  slug: string;
}

/**
 * Create an alias for a link
 */
export async function createAlias(input: CreateAliasInput): Promise<LinkAlias> {
  const { linkId, slug } = input;

  // Check if slug is already taken (in main links table or aliases)
  const { links } = await import("@tails/db");
  const [existingLink] = await db.select({ id: links.id })
    .from(links)
    .where(and(eq(links.slug, slug), isNull(links.deletedAt)))
    .limit(1);

  if (existingLink) {
    throw new Error("Slug already taken");
  }

  const [existingAlias] = await db.select({ id: linkAliases.id })
    .from(linkAliases)
    .where(eq(linkAliases.slug, slug))
    .limit(1);

  if (existingAlias) {
    throw new Error("Slug already taken");
  }

  const id = crypto.randomUUID();

  const [alias] = await db.insert(linkAliases).values({
    id,
    linkId,
    slug,
  }).returning();

  // Cache the alias mapping
  await cacheSet(`alias:${slug}`, linkId, CACHE_CONFIG);

  log.info("Alias created", { id, linkId, slug });

  return alias;
}

/**
 * Get link ID from alias slug
 */
export async function getLinkIdByAlias(slug: string): Promise<string | null> {
  // Try cache first
  const cached = await cacheGet<string>(`alias:${slug}`, CACHE_CONFIG);
  if (cached) return cached;

  const [alias] = await db.select()
    .from(linkAliases)
    .where(eq(linkAliases.slug, slug))
    .limit(1);

  if (alias) {
    // Cache the result
    await cacheSet(`alias:${slug}`, alias.linkId, CACHE_CONFIG);
    return alias.linkId;
  }

  return null;
}

/**
 * Get all aliases for a link
 */
export async function getLinkAliases(linkId: string): Promise<LinkAlias[]> {
  const aliases = await db.select()
    .from(linkAliases)
    .where(eq(linkAliases.linkId, linkId));

  return aliases;
}

/**
 * Get alias by ID
 */
export async function getAliasById(id: string, linkId: string): Promise<LinkAlias | null> {
  const [alias] = await db.select()
    .from(linkAliases)
    .where(and(
      eq(linkAliases.id, id),
      eq(linkAliases.linkId, linkId)
    ))
    .limit(1);

  return alias || null;
}

/**
 * Delete an alias
 */
export async function deleteAlias(id: string, linkId: string): Promise<boolean> {
  const alias = await getAliasById(id, linkId);
  if (!alias) return false;

  await db.delete(linkAliases)
    .where(and(
      eq(linkAliases.id, id),
      eq(linkAliases.linkId, linkId)
    ));

  // Invalidate cache
  setImmediate(() => {
    cacheDelete(`alias:${alias.slug}`, { namespace: CacheNamespaces.LINKS })
      .catch(err => log.error("Failed to invalidate alias cache", err));
  });

  log.info("Alias deleted", { id, linkId, slug: alias.slug });

  return true;
}
