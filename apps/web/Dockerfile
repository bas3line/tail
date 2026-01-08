# Build stage
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY apps/web/ ./apps/web/

# Build the Astro app
WORKDIR /app/apps/web
RUN bun run build

# Production stage - using nginx to serve static files
FROM nginx:alpine AS runner

# Copy nginx config
COPY apps/web/nginx.conf /etc/nginx/nginx.conf

# Copy built static files
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Create non-root user
RUN addgroup -g 1001 -S tails && \
    adduser -S -D -H -u 1001 -h /var/cache/nginx -s /sbin/nologin -G tails tails && \
    chown -R tails:tails /var/cache/nginx /var/run /var/log/nginx /usr/share/nginx/html

USER tails

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]

