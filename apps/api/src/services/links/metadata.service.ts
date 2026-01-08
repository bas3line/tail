import { db, links, eq, and, isNull } from "@tails/db";
import { createLogger } from "@tails/logger";
import * as cheerio from "cheerio";

const log = createLogger("metadata-service");

interface LinkMetadata {
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogImageWidth?: number;
  ogImageHeight?: number;
}

/**
 * Fetch metadata from URL with timeout
 */
async function fetchWithTimeout(url: string, timeoutMs: number = 5000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "TailTools-Bot/1.0 (+https://tail.tools)",
      },
    });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

/**
 * Parse Open Graph metadata from HTML
 */
function parseOpenGraphMetadata(html: string): LinkMetadata {
  const $ = cheerio.load(html);
  const metadata: LinkMetadata = {};

  // Extract OG title
  const ogTitle = $('meta[property="og:title"]').attr("content");
  if (ogTitle) {
    metadata.ogTitle = ogTitle.slice(0, 200);
  }

  // Extract OG description
  const ogDescription = $('meta[property="og:description"]').attr("content");
  if (ogDescription) {
    metadata.ogDescription = ogDescription.slice(0, 500);
  }

  // Extract OG image
  const ogImage = $('meta[property="og:image"]').attr("content");
  if (ogImage) {
    metadata.ogImage = ogImage.slice(0, 2048);
  }

  // Extract OG image dimensions
  const ogImageWidth = $('meta[property="og:image:width"]').attr("content");
  if (ogImageWidth) {
    metadata.ogImageWidth = parseInt(ogImageWidth, 10);
  }

  const ogImageHeight = $('meta[property="og:image:height"]').attr("content");
  if (ogImageHeight) {
    metadata.ogImageHeight = parseInt(ogImageHeight, 10);
  }

  // Fallback to standard meta tags if OG tags not found
  if (!metadata.ogTitle) {
    const title = $("title").text();
    if (title) {
      metadata.ogTitle = title.slice(0, 200);
    }
  }

  if (!metadata.ogDescription) {
    const description = $('meta[name="description"]').attr("content");
    if (description) {
      metadata.ogDescription = description.slice(0, 500);
    }
  }

  return metadata;
}

/**
 * Fetch and update link metadata
 */
export async function refreshLinkMetadata(linkId: string): Promise<LinkMetadata | null> {
  // Get link
  const [link] = await db.select()
    .from(links)
    .where(and(eq(links.id, linkId), isNull(links.deletedAt)))
    .limit(1);

  if (!link) {
    throw new Error("Link not found");
  }

  try {
    // Fetch URL with timeout
    const response = await fetchWithTimeout(link.url, 5000);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("text/html")) {
      throw new Error("URL does not return HTML content");
    }

    const html = await response.text();
    const metadata = parseOpenGraphMetadata(html);

    // Update link with metadata
    await db.update(links)
      .set({
        ogTitle: metadata.ogTitle || null,
        ogDescription: metadata.ogDescription || null,
        ogImage: metadata.ogImage || null,
        ogImageWidth: metadata.ogImageWidth || null,
        ogImageHeight: metadata.ogImageHeight || null,
        metadataFetchedAt: new Date(),
        metadataError: null,
      })
      .where(eq(links.id, linkId));

    log.info("Metadata fetched successfully", { linkId, url: link.url });

    return metadata;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Update link with error
    await db.update(links)
      .set({
        metadataFetchedAt: new Date(),
        metadataError: errorMessage.slice(0, 500),
      })
      .where(eq(links.id, linkId));

    log.error("Failed to fetch metadata", error as Error, { linkId, url: link.url });

    throw error;
  }
}

/**
 * Check if metadata needs refreshing (>7 days old or has error)
 */
export function needsMetadataRefresh(link: {
  metadataFetchedAt: Date | null;
  metadataError: string | null;
}): boolean {
  // Never fetched
  if (!link.metadataFetchedAt) {
    return true;
  }

  // Has error - retry
  if (link.metadataError) {
    return true;
  }

  // Older than 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return new Date(link.metadataFetchedAt) < sevenDaysAgo;
}

/**
 * Get links that need metadata refresh
 */
export async function getLinksNeedingMetadataRefresh(limit: number = 100): Promise<string[]> {
  const result = await db.select({ id: links.id })
    .from(links)
    .where(
      and(
        isNull(links.deletedAt),
        // Either never fetched or has error
        isNull(links.metadataFetchedAt)
      )
    )
    .limit(limit);

  return result.map((r: { id: string }) => r.id);
}
