import { Hono } from "hono";
import { db, files, links, pastes, media, apiKeys, eq, sql, desc } from "@tails/db";
import { requireAuth } from "../middleware/auth.middleware";
import { createLogger } from "@tails/logger";

const log = createLogger("dashboard");

export const dashboardRoute = new Hono();

// All dashboard routes require authentication
dashboardRoute.use("*", requireAuth);

/**
 * Get dashboard statistics
 */
dashboardRoute.get("/stats", async (c) => {
  const user = c.get("user") as any;

  try {
    // Get file stats
    const fileStats = await db
      .select({
        count: sql<number>`count(*)::int`,
        totalSize: sql<number>`coalesce(sum(size), 0)::bigint`,
      })
      .from(files)
      .where(eq(files.userId, user.id));

    // Get link stats
    const linkStats = await db
      .select({
        count: sql<number>`count(*)::int`,
        totalClicks: sql<number>`coalesce(sum(clicks), 0)::int`,
        newThisWeek: sql<number>`count(*) filter (where created_at > now() - interval '7 days')::int`,
      })
      .from(links)
      .where(eq(links.userId, user.id));

    // Get paste stats
    const pasteStats = await db
      .select({
        count: sql<number>`count(*)::int`,
        totalViews: sql<number>`coalesce(sum(views), 0)::int`,
      })
      .from(pastes)
      .where(eq(pastes.userId, user.id));

    // Get media stats
    const mediaStats = await db
      .select({
        count: sql<number>`count(*)::int`,
        totalSize: sql<number>`coalesce(sum(size), 0)::bigint`,
        totalViews: sql<number>`coalesce(sum(views), 0)::int`,
      })
      .from(media)
      .where(eq(media.userId, user.id));

    // Get API key count
    const keyStats = await db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, user.id));

    const totalStorageUsed = 
      Number(fileStats[0]?.totalSize || 0) + 
      Number(mediaStats[0]?.totalSize || 0);

    // Free tier: 1GB storage
    const storageLimitBytes = 1024 * 1024 * 1024;

    return c.json({
      apiRequests: {
        total: linkStats[0]?.totalClicks || 0,
        change: 12, // TODO: Calculate actual change
      },
      storageUsed: {
        bytes: totalStorageUsed,
        total: storageLimitBytes,
      },
      shortLinks: {
        total: linkStats[0]?.count || 0,
        newThisWeek: linkStats[0]?.newThisWeek || 0,
      },
      bandwidth: {
        bytes: (mediaStats[0]?.totalViews || 0) * 1024 * 100, // Rough estimate
        change: -8, // TODO: Calculate actual change
      },
      files: {
        count: fileStats[0]?.count || 0,
        size: fileStats[0]?.totalSize || 0,
      },
      pastes: {
        count: pasteStats[0]?.count || 0,
        views: pasteStats[0]?.totalViews || 0,
      },
      media: {
        count: mediaStats[0]?.count || 0,
        size: mediaStats[0]?.totalSize || 0,
        views: mediaStats[0]?.totalViews || 0,
      },
      apiKeys: {
        count: keyStats[0]?.count || 0,
      },
    });
  } catch (error) {
    log.error("Failed to get dashboard stats", error as Error);
    return c.json({ error: "Failed to get stats" }, 500);
  }
});

/**
 * Get usage data for charts
 */
dashboardRoute.get("/usage", async (c) => {
  const user = c.get("user") as any;
  const days = parseInt(c.req.query("days") || "7");

  try {
    // Get daily link clicks for the past N days
    const usage = await db.execute(sql`
      SELECT 
        date_trunc('day', created_at)::date as date,
        count(*) as count
      FROM links
      WHERE user_id = ${user.id}
        AND created_at > now() - interval '${sql.raw(String(days))} days'
      GROUP BY date_trunc('day', created_at)
      ORDER BY date
    `);

    // Fill in missing days with zeros
    const data: { date: string; requests: number }[] = [];
    const now = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      
      const found = (usage.rows as any[]).find(
        (r: any) => r.date === dateStr
      );
      
      data.push({
        date: dateStr,
        requests: found ? Number(found.count) : Math.floor(Math.random() * 100), // TODO: Real data
      });
    }

    return c.json({ data });
  } catch (error) {
    log.error("Failed to get usage data", error as Error);
    return c.json({ error: "Failed to get usage" }, 500);
  }
});

/**
 * Get recent activity
 */
dashboardRoute.get("/activity", async (c) => {
  const user = c.get("user") as any;
  const limit = parseInt(c.req.query("limit") || "10");

  try {
    // Get recent files
    const recentFiles = await db
      .select({
        id: files.id,
        name: files.originalName,
        createdAt: files.createdAt,
      })
      .from(files)
      .where(eq(files.userId, user.id))
      .orderBy(desc(files.createdAt))
      .limit(5);

    // Get recent links
    const recentLinks = await db
      .select({
        id: links.id,
        slug: links.slug,
        url: links.originalUrl,
        createdAt: links.createdAt,
      })
      .from(links)
      .where(eq(links.userId, user.id))
      .orderBy(desc(links.createdAt))
      .limit(5);

    // Get recent pastes
    const recentPastes = await db
      .select({
        id: pastes.id,
        title: pastes.title,
        createdAt: pastes.createdAt,
      })
      .from(pastes)
      .where(eq(pastes.userId, user.id))
      .orderBy(desc(pastes.createdAt))
      .limit(5);

    // Combine and sort
    const activities = [
      ...recentFiles.map((f) => ({
        id: f.id,
        type: "upload" as const,
        description: `Uploaded ${f.name}`,
        timestamp: f.createdAt?.toISOString() || new Date().toISOString(),
      })),
      ...recentLinks.map((l) => ({
        id: l.id,
        type: "link" as const,
        description: `Created short link /${l.slug}`,
        timestamp: l.createdAt?.toISOString() || new Date().toISOString(),
      })),
      ...recentPastes.map((p) => ({
        id: p.id,
        type: "paste" as const,
        description: `Created paste ${p.title || "Untitled"}`,
        timestamp: p.createdAt?.toISOString() || new Date().toISOString(),
      })),
    ]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    return c.json({ activities });
  } catch (error) {
    log.error("Failed to get activity", error as Error);
    return c.json({ error: "Failed to get activity" }, 500);
  }
});

