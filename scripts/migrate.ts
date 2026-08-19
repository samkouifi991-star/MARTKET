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
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { marketPrices } from "../src/db/schema";
import * as fmp from "../src/services/market-data/fmp";
import { upsertMarketPrice } from "../src/db/queries/market-data";

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
  } catch (err) {
    console.log(`DB_MIGRATE_RESULT: FAIL (table-existence check) — ${describeError(err)}`);
    return;
  }

  // 4/5. Real insert + read-back, using the actual production pipeline
  // (fmp.getQuote -> upsertMarketPrice), not synthetic test data — this is
  // GBPUSD's real current price landing in Neon for real, the same write
  // the prices cron performs. Gated to non-demo DATA_MODE (Preview=hybrid)
  // so a Production build (DATA_MODE=demo) never writes live data, per the
  // standing "do not switch Production to live" constraint — schema
  // migration above still always runs, since empty tables change nothing
  // user-visible.
  const dataMode = (process.env.DATA_MODE ?? "demo").toLowerCase().trim();
  if (dataMode === "demo") {
    console.log("DB_MIGRATE_RESULT: SUCCESS — schema verified (insert/readback skipped, DATA_MODE=demo)");
    return;
  }

  try {
    const quote = await fmp.getQuote("GBPUSD");
    if (quote.status !== "live" || !quote.value) {
      console.log(`DB_MIGRATE_STEP: write/readback skipped — FMP quote unavailable right now (${quote.error ?? quote.status}); schema is still verified`);
      console.log("DB_MIGRATE_RESULT: SUCCESS — schema verified, write/readback deferred to the next successful prices cron run");
      return;
    }

    await upsertMarketPrice("GBPUSD", quote.value, "fmp");
    const readBack = await db.select().from(marketPrices).where(eq(marketPrices.symbol, "GBPUSD")).limit(1);

    if (readBack.length === 0 || readBack[0].price !== quote.value.price) {
      console.log("DB_MIGRATE_RESULT: FAIL (readback mismatch) — wrote a GBPUSD price row but could not read the same value back");
      return;
    }

    console.log(`DB_MIGRATE_STEP: wrote and read back a real GBPUSD price (${readBack[0].price}, fetched ${readBack[0].fetchedAt.toISOString()})`);
    console.log("DB_MIGRATE_RESULT: SUCCESS");
  } catch (err) {
    console.log(`DB_MIGRATE_RESULT: FAIL (insert/readback) — ${describeError(err)}`);
  }
}

main()
  .catch((err) => console.log(`DB_MIGRATE_RESULT: FAIL (unexpected) — ${describeError(err)}`))
  .finally(() => {
    // Never block the build on this script's outcome — see file header.
    process.exit(0);
  });
