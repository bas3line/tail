import { Hono } from "hono";
import { getImagePool, getPdfPool, getGeneralPool, getQRCodePool, getVideoPool } from "../workers";

export const workersRoute = new Hono();

/**
 * Get worker pool statistics
 */
workersRoute.get("/stats", async (c) => {
  try {
    const imageStats = getImagePool().getStats();
    const pdfStats = getPdfPool().getStats();
    const generalStats = getGeneralPool().getStats();
    const qrcodeStats = getQRCodePool().getStats();
    const videoStats = getVideoPool().getStats();

    const allStats = [imageStats, pdfStats, generalStats, qrcodeStats, videoStats];

    return c.json({
      image: imageStats,
      pdf: pdfStats,
      general: generalStats,
      qrcode: qrcodeStats,
      video: videoStats,
      total: {
        totalWorkers: allStats.reduce((sum, s) => sum + s.totalWorkers, 0),
        busyWorkers: allStats.reduce((sum, s) => sum + s.busyWorkers, 0),
        idleWorkers: allStats.reduce((sum, s) => sum + s.idleWorkers, 0),
        queuedTasks: allStats.reduce((sum, s) => sum + s.queuedTasks, 0),
        totalTasksCompleted: allStats.reduce((sum, s) => sum + s.totalTasksCompleted, 0),
        totalErrors: allStats.reduce((sum, s) => sum + s.totalErrors, 0),
      },
    });
  } catch (error) {
    return c.json({ error: "Failed to get worker stats" }, 500);
  }
});

/**
 * Health check for workers
 */
workersRoute.get("/health", async (c) => {
  try {
    const pools = {
      image: getImagePool().getStats(),
      pdf: getPdfPool().getStats(),
      general: getGeneralPool().getStats(),
      qrcode: getQRCodePool().getStats(),
      video: getVideoPool().getStats(),
    };

    const poolHealth = Object.fromEntries(
      Object.entries(pools).map(([name, stats]) => [
        name,
        stats.totalWorkers > 0 ? "healthy" : "unhealthy",
      ])
    );

    const healthy = Object.values(pools).every((s) => s.totalWorkers > 0);

    return c.json({
      healthy,
      pools: poolHealth,
    }, healthy ? 200 : 503);
  } catch (error) {
    return c.json({ healthy: false, error: "Failed to check worker health" }, 503);
  }
});

