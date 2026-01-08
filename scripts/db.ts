#!/usr/bin/env bun
/**
 * Database migration script
 * Usage: bun run database
 * 
 * This script will:
 * 1. Generate migrations from schema changes
 * 2. Push schema to database
 */

import { $ } from "bun";
import { resolve } from "path";

const ROOT_DIR = resolve(import.meta.dir, "..");
const DB_DIR = resolve(ROOT_DIR, "packages/db");
const ENV_FILE = resolve(ROOT_DIR, ".env");

async function main() {
  console.log("🗄️  Database Migration Tool\n");

  // Check if .env exists
  const envExists = await Bun.file(ENV_FILE).exists();
  if (!envExists) {
    console.error("❌ .env file not found at project root");
    console.error("   Create a .env file with DATABASE_URL");
    process.exit(1);
  }

  // Load env to check DATABASE_URL
  const envContent = await Bun.file(ENV_FILE).text();
  const hasDbUrl = envContent.includes("DATABASE_URL=") && 
    !envContent.match(/DATABASE_URL=\s*#/) &&
    !envContent.match(/DATABASE_URL=\s*$/m);

  if (!hasDbUrl) {
    console.error("❌ DATABASE_URL not set in .env");
    console.error("   Add: DATABASE_URL=postgresql://user:pass@host:port/database");
    process.exit(1);
  }

  console.log("✓ Environment configured\n");

  // Step 1: Generate migrations
  console.log("📝 Generating migrations from schema...");
  try {
    await $`cd ${DB_DIR} && bun --env-file=${ENV_FILE} run generate`.quiet();
    console.log("✓ Migrations generated\n");
  } catch (error) {
    // Generate might fail if no changes, that's ok
    console.log("ℹ No schema changes detected\n");
  }

  // Step 2: Push to database
  console.log("🚀 Pushing schema to database...");
  try {
    const result = await $`cd ${DB_DIR} && bun --env-file=${ENV_FILE} run push`.text();
    
    if (result.includes("Changes applied") || result.includes("No changes")) {
      console.log("✓ Database schema synced\n");
    } else {
      console.log(result);
    }
  } catch (error) {
    console.error("❌ Failed to push schema to database");
    console.error((error as Error).message);
    process.exit(1);
  }

  console.log("✅ Database migration complete!");
}

main().catch((err) => {
  console.error("❌ Migration failed:", err.message);
  process.exit(1);
});

