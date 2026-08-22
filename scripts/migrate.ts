// One-time-per-deploy database bootstrap, run from Vercel's "vercel-build"
// step (see package.json) — the ONLY place with both a real DATABASE_URL
// and real network access to Neon. The agent sandbox that develops this
// repo cannot reach Neon, CFTC, FRED, FMP, or *.vercel.app directly (a
// standing, structural network restriction — see project history), so this
// script is designed to run unattended inside Vercel's build container and
// print results that are greppable straight out of the build log.
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
// Deliberately has ZERO dependency on any external market-data provider
// (FMP/FRED/CFTC/Myfxbook) — a database migration must never be coupled to
// a third-party API's availability or rate limits. This script only:
// connect to Neon -> apply schema -> verify tables exist -> exit. Provider
// verification and data seeding belong in their own controlled scripts
// (see fmp-*.ts, fred-*.ts, cftc-*.ts, five-market-seed.ts,
// provider-storage-seed.ts), run explicitly and separately from the build.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
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
];

function describeError(err: unknown): string {
  if (err instanceof Error) {
    // Neon's HTTP driver often nests the real Postgres error under `.cause`
    // — surface both, not just the outer wrapper ("Failed query") that
    // hides what actually went wrong.
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

  const sqlClient = neon(url);
  const db = drizzle(sqlClient, { schema });

  // 1. Verify the connection with the simplest possible round trip before
  // touching schema, so a connection failure is reported distinctly from a
  // migration failure.
  try {
    await sqlClient`select 1`;
    console.log("DB_MIGRATE_STEP: connection OK");
  } catch (err) {
    console.log(`DB_MIGRATE_RESULT: FAIL (connection) — ${describeError(err)}`);
    return;
  }

  // 2. Run the actual Drizzle migration (drizzle/0000_*.sql, generated via
  // `npx drizzle-kit generate` from src/db/schema.ts).
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("DB_MIGRATE_STEP: migrate() completed");
  } catch (err) {
    console.log(`DB_MIGRATE_RESULT: FAIL (migration) — ${describeError(err)}`);
    return;
  }

  // 3. Confirm every table the app actually queries exists — this is what
  // directly fixes "queries against market_candles/economic_indicators/
  // market_scores fail": those failures are relation-does-not-exist errors
  // from a database that had never been migrated, not a data problem.
  try {
    const rows = (await sqlClient`select table_name from information_schema.tables where table_schema = 'public'`) as { table_name: string }[];
    const present = new Set(rows.map((r) => r.table_name));
    const missing = EXPECTED_TABLES.filter((t) => !present.has(t));
    if (missing.length > 0) {
      console.log(`DB_MIGRATE_RESULT: FAIL (tables missing after migration) — ${missing.join(", ")}`);
      return;
    }
    console.log(`DB_MIGRATE_STEP: all ${EXPECTED_TABLES.length} expected tables present`);
    console.log("DB_MIGRATE_RESULT: SUCCESS — schema verified");
  } catch (err) {
    console.log(`DB_MIGRATE_RESULT: FAIL (table-existence check) — ${describeError(err)}`);
  }
}

main()
  .catch((err) => console.log(`DB_MIGRATE_RESULT: FAIL (unexpected) — ${describeError(err)}`))
  .finally(() => {
    // Never block the build on this script's outcome — see file header.
    process.exit(0);
  });
