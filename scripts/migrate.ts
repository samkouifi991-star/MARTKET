// One-time-per-deploy database bootstrap, run from Vercel's "vercel-build"
// step (see package.json) — the ONLY place with both a real DATABASE_URL
// and real network access to the database. The agent sandbox that develops
// this repo cannot reach the database, CFTC, FRED, FMP, or *.vercel.app
// directly (a standing, structural network restriction — see project
// history), so this script is designed to run unattended inside Vercel's
// build container and print results that are greppable straight out of the
// build log.
//
// Idempotent: drizzle's migrate() tracks applied migrations in its own
// `__drizzle_migrations` table, so re-running this on every build is safe
// and fast after the first real run.
//
// Never fails the build: a broken DATABASE_URL should still let the app
// deploy, so /admin/gbpusd-validation can show the real error to a human
// instead of there being no deployment to look at at all. Every branch
// prints an explicit DB_MIGRATE_RESULT line carrying the exact underlying
// driver/Postgres error — never a generic "Failed query" — so a failure is
// diagnosable straight from Vercel's build output.
//
// Standard TCP Postgres driver (node-postgres) — this must run against any
// Postgres host (Supabase, RDS, self-hosted, or Neon's own standard TCP
// endpoint), not a vendor-specific serverless HTTP API.
//
// Deliberately has ZERO dependency on any external market-data provider
// (FMP/FRED/CFTC/Myfxbook) — a database migration must never be coupled to
// a third-party API's availability or rate limits. This script only:
// connect -> apply schema -> verify tables exist -> exit. Provider
// verification and data seeding belong in their own controlled scripts
// (see fmp-*.ts, fred-*.ts, cftc-*.ts, five-market-seed.ts,
// provider-storage-seed.ts), run explicitly and separately from the build.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "../src/db/schema";

const EXPECTED_TABLES = [
  "market_prices",
  "market_candles",
  "institutional_positioning",
  "retail_sentiment",
  "economic_indicators",
  "economic_events",
  "news_articles",
  "factor_scores",
  "market_scores",
  "current_market_scores",
  "current_factor_scores",
  "provider_health",
  "data_mode_audit",
  "users",
  "sessions",
  "subscriptions",
  "scoring_configurations",
  // Scoring Engine V2 (shadow mode) — see src/db/schema.ts's V2 section.
  "economic_release_surprises",
  "event_shocks",
  "current_market_scores_v2",
  "current_factor_scores_v2",
  "market_scores_v2",
  "factor_scores_v2",
  "scoring_shadow_comparisons",
  "scoring_integrity_errors",
  "economic_release_tracking",
  "economic_watch_diagnostics",
  // Email/Zapier + manual-entry ingestion (replaces FMP economic-calendar/news deps).
  "zapier_ingest_log",
];

// Column-level checks for the newest schema additions (platform-redesign
// Phases 1/8) — table-name presence alone doesn't prove a column exists,
// and these two specifically gate real application behavior (channel
// distinguishes manual vs. Zapier provenance; risk_category feeds the
// Geopolitical Risk Tracker's sub-scores).
const EXPECTED_COLUMNS: { table: string; column: string }[] = [
  { table: "zapier_ingest_log", column: "channel" },
  { table: "news_articles", column: "risk_category" },
];

function describeError(err: unknown): string {
  if (err instanceof Error) {
    // node-postgres often nests the real Postgres error under `.cause` —
    // surface both, not just the outer wrapper ("Failed query") that hides
    // what actually went wrong.
    const cause = (err as { cause?: unknown }).cause;
    const causeMsg = cause instanceof Error ? ` | cause: ${cause.message}` : cause ? ` | cause: ${String(cause)}` : "";
    return `${err.name}: ${err.message}${causeMsg}`;
  }
  return String(err);
}

async function main() {
  console.log("=== DB_MIGRATE_START ===");

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DB_MIGRATE_RESULT: SKIPPED — DATABASE_URL is not set in this build environment");
    return;
  }

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  // 1. Verify the connection with the simplest possible round trip before
  // touching schema, so a connection failure is reported distinctly from a
  // migration failure.
  try {
    await pool.query("select 1");
    console.log("DB_MIGRATE_STEP: connection OK");
  } catch (err) {
    console.log(`DB_MIGRATE_RESULT: FAIL (connection) — ${describeError(err)}`);
    await pool.end().catch(() => {});
    return;
  }

  // 2. Run the actual Drizzle migration (drizzle/0000_*.sql, generated via
  // `npx drizzle-kit generate` from src/db/schema.ts).
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("DB_MIGRATE_STEP: migrate() completed");
  } catch (err) {
    console.log(`DB_MIGRATE_RESULT: FAIL (migration) — ${describeError(err)}`);
    await pool.end().catch(() => {});
    return;
  }

  // 3. Confirm every table the app actually queries exists — this is what
  // directly fixes "queries against market_candles/economic_indicators/
  // market_scores fail": those failures are relation-does-not-exist errors
  // from a database that had never been migrated, not a data problem.
  try {
    const result = await pool.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public'");
    const present = new Set(result.rows.map((r) => r.table_name));
    const missing = EXPECTED_TABLES.filter((t) => !present.has(t));
    if (missing.length > 0) {
      console.log(`DB_MIGRATE_RESULT: FAIL (tables missing after migration) — ${missing.join(", ")}`);
      return;
    }
    console.log(`DB_MIGRATE_STEP: all ${EXPECTED_TABLES.length} expected tables present`);
  } catch (err) {
    console.log(`DB_MIGRATE_RESULT: FAIL (table-existence check) — ${describeError(err)}`);
    await pool.end().catch(() => {});
    return;
  }

  // 4. Column-level check for the newest additions — a real
  // information_schema.columns query, not an inference from the migration
  // script having "exited successfully".
  try {
    const result = await pool.query<{ table_name: string; column_name: string }>(
      "select table_name, column_name from information_schema.columns where table_schema = 'public'"
    );
    const present = new Set(result.rows.map((r) => `${r.table_name}.${r.column_name}`));
    const missing = EXPECTED_COLUMNS.filter((c) => !present.has(`${c.table}.${c.column}`));
    if (missing.length > 0) {
      console.log(`DB_MIGRATE_RESULT: FAIL (columns missing after migration) — ${missing.map((c) => `${c.table}.${c.column}`).join(", ")}`);
      return;
    }
    console.log(`DB_MIGRATE_STEP: all ${EXPECTED_COLUMNS.length} newest columns present (${EXPECTED_COLUMNS.map((c) => `${c.table}.${c.column}`).join(", ")})`);
    console.log("DB_MIGRATE_RESULT: SUCCESS — schema verified");
  } catch (err) {
    console.log(`DB_MIGRATE_RESULT: FAIL (column-existence check) — ${describeError(err)}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

main()
  .catch((err) => console.log(`DB_MIGRATE_RESULT: FAIL (unexpected) — ${describeError(err)}`))
  .finally(() => {
    // Never block the build on this script's outcome — see file header.
    process.exit(0);
  });
