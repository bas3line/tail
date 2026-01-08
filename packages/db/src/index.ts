import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

// Check if DATABASE_URL is configured
if (!connectionString) {
  console.warn(
    "\x1b[33m⚠️  DATABASE_URL not set. Database features will not work.\x1b[0m"
  );
  console.warn(
    "\x1b[33m   Set DATABASE_URL in your .env file to connect to PostgreSQL.\x1b[0m"
  );
  console.warn(
    "\x1b[33m   Example: DATABASE_URL=postgresql://user:pass@localhost:5432/tails\x1b[0m"
  );
}

// Create postgres client with lazy connection (only connects when first query is made)
const client = connectionString
  ? postgres(connectionString, {
      max: 100,
      idle_timeout: 20,
      connect_timeout: 5,
      max_lifetime: 60 * 30,
      prepare: true,
      transform: {
        undefined: null,
      },
      onnotice: () => {},
    })
  : (null as unknown as ReturnType<typeof postgres>);

// Create drizzle instance
export const db = client ? drizzle(client, { schema }) : (null as any);

// Helper to check if database is available
export const isDatabaseAvailable = (): boolean => {
  return !!connectionString && !!client;
};

// Helper to test database connection
export const testConnection = async (): Promise<boolean> => {
  if (!client) return false;
  try {
    await client`SELECT 1`;
    return true;
  } catch (error) {
    console.error("Database connection failed:", (error as Error).message);
    return false;
  }
};

export * from "./schema";
export type { schema };

// Re-export drizzle-orm utilities for consistent versioning
export { eq, and, or, not, isNull, isNotNull, desc, asc, sql, inArray } from "drizzle-orm";
