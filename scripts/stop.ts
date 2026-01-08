#!/usr/bin/env bun
/**
 * Stop all Tails development servers
 * Usage: bun run stop
 */

import { $ } from "bun";

const PORTS = [3000, 4321, 4322, 4323];

async function killPort(port: number): Promise<boolean> {
  try {
    // Get PIDs using the port
    const result = await $`lsof -ti:${port}`.quiet().text();
    const pids = result.trim().split("\n").filter(Boolean);

    if (pids.length === 0) {
      return false;
    }

    // Kill each PID
    for (const pid of pids) {
      try {
        await $`kill -9 ${pid}`.quiet();
        console.log(`  ✓ Killed process ${pid} on port ${port}`);
      } catch {
        // Process may have already exited
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log("🛑 Stopping Tails servers...\n");

  let killed = 0;

  for (const port of PORTS) {
    const wasKilled = await killPort(port);
    if (wasKilled) {
      killed++;
    }
  }

  if (killed === 0) {
    console.log("No servers were running.");
  } else {
    console.log(`\n✅ Stopped ${killed} server(s)`);
  }
}

main().catch(console.error);

