import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { setEmailHandler } from "@tails/auth";
import { createLogger } from "@tails/logger";
import { emailService } from "./services/email";
import { 
  securityHeaders, 
  rateLimiters, 
  requestSizeLimit,
} from "./middleware/security.middleware";
import { requestLogger } from "./middleware/logger.middleware";

// Routes
import { authRoutes } from "./routes/auth.route";
import { healthRoutes } from "./routes/health.route";
import { filesRoutes } from "./routes/files.route";
import { linksRoutes } from "./routes/links.route";
import { pastesRoutes } from "./routes/pastes.route";
import { apiKeysRoutes } from "./routes/api-keys.route";
import { mediaRoutes } from "./routes/media.route";
import { toolsRoutes } from "./routes/tools.route";
import { workersRoute } from "./routes/workers.route";
import { dashboardRoute } from "./routes/dashboard.route";

// Initialize worker pools on startup
import { getImagePool, getPdfPool, getGeneralPool, getQRCodePool, getVideoPool } from "./workers";

// Create logger for this service
const log = createLogger("api");

// Set up email handler for auth
setEmailHandler((email, otp, type) => emailService.sendOTP(email, otp, type));

// Pre-initialize worker pools for faster first requests
log.info("Initializing worker pools...");
const imagePool = getImagePool();
const pdfPool = getPdfPool();
const generalPool = getGeneralPool();
const qrcodePool = getQRCodePool();
const videoPool = getVideoPool();
log.info("Worker pools initialized", {
  image: imagePool.getStats().totalWorkers,
  pdf: pdfPool.getStats().totalWorkers,
  general: generalPool.getStats().totalWorkers,
  qrcode: qrcodePool.getStats().totalWorkers,
  video: videoPool.getStats().totalWorkers,
});

const app = new Hono();

// Security middleware (order matters)
app.use("*", securityHeaders);
app.use("*", secureHeaders());
app.use("*", requestSizeLimit(100 * 1024 * 1024)); // 100MB max for file uploads

// Request logging
app.use("*", requestLogger);

// CORS - strict configuration
app.use(
  "*",
  cors({
    origin: (origin) => {
      const allowedOrigins = [
        process.env.WEB_URL || "http://localhost:4321",
        "http://localhost:4321",
        "http://localhost:4322",
        "http://localhost:4323",
      ];
      
      // In production, be strict
      if (process.env.NODE_ENV === "production") {
        return allowedOrigins.includes(origin) ? origin : null;
      }
      
      // In development, allow localhost origins
      if (origin?.includes("localhost")) {
        return origin;
      }
      
      return allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Cookie", "X-API-Key"],
    exposeHeaders: ["Set-Cookie", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
    maxAge: 86400, // 24 hours
  })
);

// Rate limiting for auth endpoints
app.use("/api/auth/email-otp/send-verification-otp", rateLimiters.authOtpSend);
app.use("/api/auth/email-otp/verify-email", rateLimiters.authOtpVerify);
app.use("/api/auth/sign-in/*", rateLimiters.authLogin);
app.use("/api/auth/sign-up/*", rateLimiters.authSignup);

// Rate limiting for API endpoints
app.use("/api/files/*", rateLimiters.apiGeneral);
app.use("/api/links/*", rateLimiters.apiGeneral);
app.use("/api/pastes/*", rateLimiters.apiGeneral);
app.use("/api/keys/*", rateLimiters.apiGeneral);
app.use("/api/media/*", rateLimiters.apiGeneral);

// Routes
app.route("/", healthRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/files", filesRoutes);
app.route("/api/links", linksRoutes);
app.route("/api/pastes", pastesRoutes);
app.route("/api/keys", apiKeysRoutes);
app.route("/api/media", mediaRoutes);
app.route("/api/tools", toolsRoutes);
app.route("/api/workers", workersRoute);
app.route("/api/dashboard", dashboardRoute);

// Public media routes (tail.tools/media/:id)
app.get("/media/:id", async (c) => {
  const id = c.req.param("id");
  const { getMediaById, getMediaStream, checkMediaAccess } = await import("./services/media");
  
  const media = await getMediaById(id);
  if (!media) {
    return c.json({ error: "Media not found" }, 404);
  }
  
  // For public access, check if accessible
  const access = checkMediaAccess(media, undefined, false);
  if (!access.accessible) {
    if (access.requiresPassword) {
      // Redirect to password page
      const webUrl = process.env.WEB_URL || "http://localhost:4321";
      return c.redirect(`${webUrl}/media/${id}/unlock`, 302);
    }
    return c.json({ error: "Access denied" }, 403);
  }
  
  const fileData = await getMediaStream(id, undefined, false);
  if (!fileData) {
    return c.json({ error: "File not found" }, 404);
  }
  
  return new Response(fileData.stream, {
    headers: {
      "Content-Type": fileData.contentType,
      "Content-Length": String(fileData.contentLength),
      "Content-Disposition": `inline; filename="${encodeURIComponent(fileData.filename)}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// Public PDF route (tail.tools/pdf/:id)
app.get("/pdf/:id", async (c) => {
  const id = c.req.param("id");
  const { isPDF, getPDFBuffer } = await import("./services/media");
  
  const isPdf = await isPDF(id);
  if (!isPdf) {
    return c.json({ error: "Not a PDF" }, 400);
  }
  
  const pdfData = await getPDFBuffer(id, undefined, false);
  if (!pdfData) {
    return c.json({ error: "PDF not found or access denied" }, 404);
  }
  
  return new Response(pdfData.buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdfData.buffer.length),
      "Content-Disposition": `inline; filename="${encodeURIComponent(pdfData.filename)}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
});

// Short link redirect (root level for clean URLs)
app.get("/l/:slug", async (c) => {
  const slug = c.req.param("slug");
  // Import dynamically to avoid circular deps
  const { getLinkBySlug, isLinkValid, recordClick } = await import("./services/links");
  
  const link = await getLinkBySlug(slug);
  if (!link) {
    return c.redirect("/404", 302);
  }
  
  if (link.password) {
    return c.redirect(`/l/${slug}/unlock`, 302);
  }
  
  const validity = isLinkValid(link);
  if (!validity.valid) {
    return c.redirect("/link-expired", 302);
  }
  
  const result = await recordClick(slug, {
    ip: c.req.header("x-forwarded-for") || c.req.header("x-real-ip"),
    userAgent: c.req.header("user-agent"),
    referer: c.req.header("referer"),
  });
  
  if (!result) {
    return c.redirect("/link-expired", 302);
  }
  
  return c.redirect(result.url, 302);
});

// Paste viewer (root level for clean URLs)
app.get("/p/:id", async (c) => {
  // This would typically render a page, but for API-only, redirect to web app
  const id = c.req.param("id");
  const webUrl = process.env.WEB_URL || "http://localhost:4321";
  return c.redirect(`${webUrl}/p/${id}`, 302);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not Found" }, 404);
});

// Error handler - don't expose internal errors
app.onError((err, c) => {
  log.error("Unhandled error", err, {
    path: c.req.path,
    method: c.req.method,
  });
  
  // In production, don't expose error details
  if (process.env.NODE_ENV === "production") {
    return c.json({ error: "Internal Server Error" }, 500);
  }
  
  return c.json({ 
    error: "Internal Server Error",
    message: err.message,
  }, 500);
});

const port = parseInt(process.env.PORT || "3000");

log.info("Server started", {
  port,
  env: process.env.NODE_ENV || "development",
});

export default {
  port,
  fetch: app.fetch,
};
