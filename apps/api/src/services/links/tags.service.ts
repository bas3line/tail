import { db, tags, linkTags, type Tag, type NewTag, eq, and, sql, inArray } from "@tails/db";
import { cacheGet, cacheSet, cacheDelete, CacheNamespaces } from "@tails/cache";
import { createLogger } from "@tails/logger";
import crypto from "crypto";

const log = createLogger("tags-service");

const CACHE_CONFIG = {
  namespace: CacheNamespaces.LINKS,
  memoryTTL: 600,
  redisTTL: 600,
};

/**
 * Create a new tag
 */
export async function createTag(
  userId: string,
  name: string,
  color?: string
): Promise<Tag> {
  // Check if tag already exists for user
  const [existing] = await db.select()
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.name, name)))
    .limit(1);

  if (existing) {
    throw new Error("Tag already exists");
  }

  const [tag] = await db.insert(tags).values({
    id: crypto.randomUUID(),
    userId,
    name,
    color: color || null,
  }).returning();

  // Invalidate user tags cache
  await cacheDelete(`user:${userId}`, { namespace: CacheNamespaces.LINKS });

  log.info("Tag created", { id: tag.id, userId, name });

  return tag;
}

/**
 * List user's tags
 */
export async function listUserTags(userId: string): Promise<Tag[]> {
  const cacheKey = `user:${userId}`;

  // Try cache first
  const cached = await cacheGet<Tag[]>(cacheKey, CACHE_CONFIG);
  if (cached) return cached;

  const result = await db.select()
    .from(tags)
    .where(eq(tags.userId, userId))
    .orderBy(tags.name);

  // Cache the result
  await cacheSet(cacheKey, result, CACHE_CONFIG);

  return result;
}

/**
 * Get tag by ID
 */
export async function getTagById(id: string, userId: string): Promise<Tag | null> {
  const [tag] = await db.select()
    .from(tags)
    .where(and(eq(tags.id, id), eq(tags.userId, userId)))
    .limit(1);

  return tag || null;
}

/**
 * Update tag
 */
export async function updateTag(
  id: string,
  userId: string,
  updates: { name?: string; color?: string }
): Promise<Tag | null> {
  const tag = await getTagById(id, userId);
  if (!tag) return null;

  const [updated] = await db.update(tags)
    .set(updates)
    .where(and(eq(tags.id, id), eq(tags.userId, userId)))
    .returning();

  // Invalidate user tags cache
  await cacheDelete(`user:${userId}`, { namespace: CacheNamespaces.LINKS });

  log.info("Tag updated", { id, userId });

  return updated || null;
}

/**
 * Delete tag
 */
export async function deleteTag(id: string, userId: string): Promise<boolean> {
  const tag = await getTagById(id, userId);
  if (!tag) return false;

  await db.delete(tags)
    .where(and(eq(tags.id, id), eq(tags.userId, userId)));

  // Invalidate user tags cache
  await cacheDelete(`user:${userId}`, { namespace: CacheNamespaces.LINKS });

  log.info("Tag deleted", { id, userId });

  return true;
}

/**
 * Add tag to link
 */
export async function addTagToLink(linkId: string, tagId: string): Promise<void> {
  // Check if already exists
  const [existing] = await db.select()
    .from(linkTags)
    .where(and(eq(linkTags.linkId, linkId), eq(linkTags.tagId, tagId)))
    .limit(1);

  if (existing) {
    return; // Already tagged
  }

  await db.insert(linkTags).values({
    linkId,
    tagId,
  });

  // Invalidate link tags cache
  await cacheDelete(`link:${linkId}:tags`, { namespace: CacheNamespaces.LINKS });

  log.info("Tag added to link", { linkId, tagId });
}

/**
 * Remove tag from link
 */
export async function removeTagFromLink(linkId: string, tagId: string): Promise<boolean> {
  const result = await db.delete(linkTags)
    .where(and(eq(linkTags.linkId, linkId), eq(linkTags.tagId, tagId)))
    .returning();

  if (result.length > 0) {
    // Invalidate link tags cache
    await cacheDelete(`link:${linkId}:tags`, { namespace: CacheNamespaces.LINKS });

    log.info("Tag removed from link", { linkId, tagId });
    return true;
  }

  return false;
}

/**
 * Get tags for a link
 */
export async function getLinkTags(linkId: string): Promise<Tag[]> {
  const cacheKey = `link:${linkId}:tags`;

  // Try cache first
  const cached = await cacheGet<Tag[]>(cacheKey, {
    namespace: CacheNamespaces.LINKS,
    memoryTTL: 300,
    redisTTL: 300,
  });
  if (cached) return cached;

  const result = await db
    .select({
      id: tags.id,
      userId: tags.userId,
      name: tags.name,
      color: tags.color,
      createdAt: tags.createdAt,
    })
    .from(linkTags)
    .innerJoin(tags, eq(linkTags.tagId, tags.id))
    .where(eq(linkTags.linkId, linkId));

  // Cache the result
  await cacheSet(cacheKey, result, {
    namespace: CacheNamespaces.LINKS,
    memoryTTL: 300,
    redisTTL: 300,
  });

  return result;
}

/**
 * Get link IDs by tag IDs
 */
export async function getLinkIdsByTags(tagIds: string[]): Promise<string[]> {
  if (tagIds.length === 0) return [];

  const result = await db
    .select({ linkId: linkTags.linkId })
    .from(linkTags)
    .where(inArray(linkTags.tagId, tagIds))
    .groupBy(linkTags.linkId)
    .having(sql`count(DISTINCT ${linkTags.tagId}) = ${tagIds.length}`);

  return result.map(r => r.linkId);
}
