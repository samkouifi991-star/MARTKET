import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

// Lazily initialized so importing this module in demo mode (no DATABASE_URL
// set) never throws — the database is only ever touched when DATA_MODE is
// "hybrid" or "live" and a service actually needs to read/write it.
//
// Standard TCP Postgres driver (node-postgres), not Neon's HTTP-only
// driver — this app must run against any Postgres host (Supabase, RDS,
// self-hosted, or Neon's own standard TCP endpoint), not be locked to one
// vendor's serverless HTTP API. A single pooled connection is reused
// across invocations within the same serverless instance; each instance
// gets its own pool, which is the standard node-postgres pattern for
// Vercel's Node.js runtime.
let cached: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not configured. Provision a Postgres database and set DATABASE_URL before using DATA_MODE=hybrid or DATA_MODE=live.");
  }
  const pool = new Pool({ connectionString: url });
  cached = drizzle(pool, { schema });
  return cached;
}
