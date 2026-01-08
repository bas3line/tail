# Build stage
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./
COPY packages/db/package.json ./packages/db/
COPY packages/auth/package.json ./packages/auth/
COPY packages/redis/package.json ./packages/redis/
COPY packages/s3/package.json ./packages/s3/
COPY packages/logger/package.json ./packages/logger/
COPY packages/cache/package.json ./packages/cache/
COPY packages/validators/package.json ./packages/validators/
COPY apps/api/package.json ./apps/api/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# Build packages (if needed)
WORKDIR /app/apps/api

# Production stage
FROM oven/bun:1-slim AS runner

WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 tails && \
    adduser --system --uid 1001 tails

# Copy built application
COPY --from=builder --chown=tails:tails /app/node_modules ./node_modules
COPY --from=builder --chown=tails:tails /app/packages ./packages
COPY --from=builder --chown=tails:tails /app/apps/api ./apps/api

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Switch to non-root user
USER tails

WORKDIR /app/apps/api

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["bun", "run", "src/index.ts"]

