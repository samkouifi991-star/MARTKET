// One-off: backfill GBPUSD's full daily candle history (matching the
// candles cron's own 20*365 window) into Neon. The persistence-proof and
// migrate scripts only ever stored the default ~260-day window, so
// Seasonality's real MIN_YEARS_FOR_LIVE (2) minimum can't be met from
// stored data alone yet — this closes that gap so the last-known-good
// fallback (last-known-good.ts) has genuine multi-year depth to read
// during a future FMP outage, not just ~1 year.
//
// Usage: npm run test:gbpusd-backfill
import * as fmp from "../src/services/market-data/fmp";
import { upsertCandles } from "../src/db/queries/market-data";
import { getDb } from "../src/db/client";
import { marketCandles } from "../src/db/schema";
import { and, count, eq } from "drizzle-orm";
import { DATA_MODE } from "../src/services/data-mode";

const SYMBOL = "GBPUSD";

function log(msg: string): void {
  console.log(`BACKFILL: ${msg}`);
}

async function main() {
  if (DATA_MODE === "demo") {
    log("SKIPPED — DATA_MODE is demo in this environment");
    return;
  }

  const history = await fmp.getDailyCandles(SYMBOL, 20 * 365);
  log(`fetch status=${history.status} count=${history.value?.length ?? 0}`);
  if (history.status !== "live" || !history.value) {
    log(`RESULT SKIPPED — live fetch unavailable (${history.error ?? history.status}); no change made, existing stored history untouched`);
    return;
  }

  await upsertCandles(SYMBOL, "1d", history.value, "fmp");
  log(`stored ${history.value.length} daily candles`);

  const db = getDb();
  const [row] = await db.select({ value: count() }).from(marketCandles).where(and(eq(marketCandles.symbol, SYMBOL), eq(marketCandles.timeframe, "1d")));
  const earliest = history.value[0]?.date;
  const latest = history.value[history.value.length - 1]?.date;
  const years = earliest && latest ? ((new Date(latest).getTime() - new Date(earliest).getTime()) / (365.25 * 86_400_000)).toFixed(1) : "unknown";
  log(`ROW_COUNT market_candles(1d)=${row.value}, span ${earliest} to ${latest} (~${years} years)`);
  log("RESULT SUCCESS");
}

main().catch((err) => log(`RESULT FAIL — ${err instanceof Error ? err.message : String(err)}`));
