# tail.tools

The internet's swiss army knife.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.0+
- PostgreSQL database
- Redis (optional, for caching)
- S3-compatible storage (AWS S3, Cloudflare R2, MinIO)

### Installation

```bash
# Install dependencies
bun install

# Copy environment file and configure
cp .env.example .env

# Run database migrations
bun run db:migrate

# Start development servers
bun run dev
```

### Environment Variables

See `.env.example` for all configuration options.

## Project Structure

```
apps/
  api/          # Hono API server
  web/          # Astro frontend

packages/
  auth/         # Authentication (better-auth)
  cache/        # Multi-layer caching
  db/           # Database (Drizzle + PostgreSQL)
  logger/       # Structured logging
  redis/        # Redis client
  s3/           # S3 storage
  validators/   # Shared validation schemas
```

## By

- [MegaLLM](https://megallm.com)

## Special Thanks

- [marblecms](https://github.com/marblecms) for Astro layouts

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

This means:

1. You can use, modify, and distribute this software
2. **If you modify it, you must share the source** - if you change the code, improve it, or add features, you must release your modified source code under the same AGPL license
3. Network use counts as distribution - if you run a modified version on a server, you must make the source available to users

No closing it up later.

See [LICENSE](LICENSE) for the full license text.

## Support

For support, contact Shubham (Kira) at hi@ykira.com