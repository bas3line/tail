import { db, linkClicks, eq, and, sql } from "@tails/db";
import { createLogger } from "@tails/logger";
import { Parser } from "@json2csv/plainjs";

const log = createLogger("analytics-service");

/**
 * Get hourly analytics for a link
 */
export async function getHourlyAnalytics(
  linkId: string,
  options?: {
    startDate?: Date;
    endDate?: Date;
  }
): Promise<Array<{ hour: number; clicks: number; uniqueClicks: number }>> {
  const startDate = options?.startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const endDate = options?.endDate || new Date();
  const startDateStr = startDate.toISOString();
  const endDateStr = endDate.toISOString();

  const result = await db
    .select({
      hour: linkClicks.hour,
      clicks: sql<number>`count(*)::int`,
      uniqueClicks: sql<number>`count(DISTINCT ${linkClicks.sessionId})::int`,
    })
    .from(linkClicks)
    .where(
      and(
        eq(linkClicks.linkId, linkId),
        sql`${linkClicks.clickedAt} >= ${startDateStr}::timestamp`,
        sql`${linkClicks.clickedAt} <= ${endDateStr}::timestamp`
      )
    )
    .groupBy(linkClicks.hour)
    .orderBy(linkClicks.hour);

  // Fill in missing hours with zeros
  const hourlyData = new Array(24).fill(null).map((_, i) => ({
    hour: i,
    clicks: 0,
    uniqueClicks: 0,
  }));

  for (const row of result) {
    if (row.hour !== null && row.hour >= 0 && row.hour < 24) {
      hourlyData[row.hour] = {
        hour: row.hour,
        clicks: Number(row.clicks),
        uniqueClicks: Number(row.uniqueClicks),
      };
    }
  }

  return hourlyData;
}

/**
 * Get click heatmap (hour x day of week)
 */
export async function getClickHeatmap(
  linkId: string,
  options?: {
    startDate?: Date;
    endDate?: Date;
  }
): Promise<Array<{ dayOfWeek: number; hour: number; clicks: number }>> {
  const startDate = options?.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = options?.endDate || new Date();
  const startDateStr = startDate.toISOString();
  const endDateStr = endDate.toISOString();

  const result = await db
    .select({
      dayOfWeek: sql<number>`EXTRACT(DOW FROM ${linkClicks.clickedAt})::int`,
      hour: linkClicks.hour,
      clicks: sql<number>`count(*)::int`,
    })
    .from(linkClicks)
    .where(
      and(
        eq(linkClicks.linkId, linkId),
        sql`${linkClicks.clickedAt} >= ${startDateStr}::timestamp`,
        sql`${linkClicks.clickedAt} <= ${endDateStr}::timestamp`
      )
    )
    .groupBy(sql`EXTRACT(DOW FROM ${linkClicks.clickedAt})`, linkClicks.hour)
    .orderBy(sql`EXTRACT(DOW FROM ${linkClicks.clickedAt})`, linkClicks.hour);

  return result.map((row: { dayOfWeek: number | null; hour: number | null; clicks: number }) => ({
    dayOfWeek: Number(row.dayOfWeek), // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    hour: Number(row.hour),
    clicks: Number(row.clicks),
  }));
}

/**
 * Export analytics to CSV
 */
export async function exportAnalytics(
  linkId: string,
  options?: {
    startDate?: Date;
    endDate?: Date;
  }
): Promise<string> {
  const startDate = options?.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = options?.endDate || new Date();
  const startDateStr = startDate.toISOString();
  const endDateStr = endDate.toISOString();

  const clicks = await db
    .select({
      clickedAt: linkClicks.clickedAt,
      country: linkClicks.country,
      city: linkClicks.city,
      device: linkClicks.device,
      browser: linkClicks.browser,
      os: linkClicks.os,
      referer: linkClicks.referer,
    })
    .from(linkClicks)
    .where(
      and(
        eq(linkClicks.linkId, linkId),
        sql`${linkClicks.clickedAt} >= ${startDateStr}::timestamp`,
        sql`${linkClicks.clickedAt} <= ${endDateStr}::timestamp`
      )
    )
    .orderBy(linkClicks.clickedAt);

  // Convert to CSV
  const parser = new Parser({
    fields: [
      { label: "Clicked At", value: "clickedAt" },
      { label: "Country", value: "country" },
      { label: "City", value: "city" },
      { label: "Device", value: "device" },
      { label: "Browser", value: "browser" },
      { label: "OS", value: "os" },
      { label: "Referer", value: "referer" },
    ],
  });

  const csv = parser.parse(clicks.map((c: {
    clickedAt: Date | null;
    country: string | null;
    city: string | null;
    device: string | null;
    browser: string | null;
    os: string | null;
    referer: string | null;
  }) => ({
    ...c,
    clickedAt: c.clickedAt?.toISOString() || "",
  })));

  return csv;
}

/**
 * Export analytics to JSON
 */
interface AnalyticsExport {
  clickedAt: string | null;
  country: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  referer: string | null;
}

export async function exportAnalyticsJSON(
  linkId: string,
  options?: {
    startDate?: Date;
    endDate?: Date;
  }
): Promise<AnalyticsExport[]> {
  const startDate = options?.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = options?.endDate || new Date();
  const startDateStr = startDate.toISOString();
  const endDateStr = endDate.toISOString();

  const clicks = await db
    .select({
      clickedAt: linkClicks.clickedAt,
      country: linkClicks.country,
      city: linkClicks.city,
      device: linkClicks.device,
      browser: linkClicks.browser,
      os: linkClicks.os,
      referer: linkClicks.referer,
    })
    .from(linkClicks)
    .where(
      and(
        eq(linkClicks.linkId, linkId),
        sql`${linkClicks.clickedAt} >= ${startDateStr}::timestamp`,
        sql`${linkClicks.clickedAt} <= ${endDateStr}::timestamp`
      )
    )
    .orderBy(linkClicks.clickedAt);

  return clicks.map((c: {
    clickedAt: Date | null;
    country: string | null;
    city: string | null;
    device: string | null;
    browser: string | null;
    os: string | null;
    referer: string | null;
  }) => ({
    clickedAt: c.clickedAt?.toISOString() || null,
    country: c.country,
    city: c.city,
    device: c.device,
    browser: c.browser,
    os: c.os,
    referer: c.referer,
  }));
}
