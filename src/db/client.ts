import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Lazily initialized so importing this module in demo mode (no DATABASE_URL
// set) never throws — the database is only ever touched when DATA_MODE is
// "hybrid" or "live" and a service actually needs to read/write it.
let cached: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not configured. Provision a Postgres database (e.g. Neon via the Vercel Marketplace) and set DATABASE_URL before using DATA_MODE=hybrid or DATA_MODE=live."
    );
  }
  const sql = neon(url);
  cached = drizzle(sql, { schema });
  return cached;
}
