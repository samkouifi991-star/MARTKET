// Read-only diagnostic: for every STRICT_LIVE_SYMBOLS market, reports what
// resolveRetailSentimentFactor (the exact function the score breakdown
// uses) actually returns right now, plus the raw stored retail_sentiment
// row underneath it — so a genuine UNAVAILABLE can be told apart from a
// stale-but-real row, a NOT_APPLICABLE-by-design gap, or a provider/cron
// bug, instead of guessed at.
//
// Usage: npm run test:retail-sentiment-status-check
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { resolveRetailSentimentFactor } from "../src/lib/pipeline/sentiment";
import { getSymbolMapping } from "../src/services/market-data/symbol-map";
import { getDb } from "../src/db/client";
import { retailSentiment as retailSentimentTable } from "../src/db/schema";
import { eq, desc } from "drizzle-orm";
import { DATA_MODE } from "../src/services/data-mode";

// Every currently-promoted STRICT_LIVE symbol — mirrors data-mode.ts.
const SYMBOLS = [
  "GBPUSD", "EURUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY",
  "XAUUSD", "XAGUSD", "BTCUSD", "SPX500", "DJ30", "RUT2000", "FTSE100", "NIKKEI225", "ETHUSD",
];

function log(msg: string): void {
  console.log(`RETAIL_SENTIMENT_STATUS_CHECK: ${msg}`);
}

function ageHours(d: Date | null): string {
  if (!d) return "n/a";
  return `${((Date.now() - d.getTime()) / 3_600_000).toFixed(1)}h`;
}

async function main() {
  log(`DATA_MODE=${DATA_MODE}`);
  const db = getDb();

  for (const symbol of SYMBOLS) {
    const mapping = getSymbolMapping(symbol);
    const factor = await resolveRetailSentimentFactor(symbol, "live");
    log(
      `${symbol} | oandaInstrument=${mapping?.oandaInstrument ?? "null"} igEpic=${mapping?.igEpic ?? "null"} myfxbookSymbol=${mapping?.myfxbookSymbol ?? "null"} | FACTOR freshness=${factor.freshness} provider=${factor.provider ?? "n/a"} explanation="${factor.explanation}"`
    );

    // Raw stored rows (any status, not just "live") so a cron-side failure
    // that never wrote a live row is visible too, not just "nothing here".
    const rows = await db.select().from(retailSentimentTable).where(eq(retailSentimentTable.symbol, symbol)).orderBy(desc(retailSentimentTable.fetchedAt)).limit(3);
    if (rows.length === 0) {
      log(`  RAW_ROWS: none stored, ever`);
    } else {
      for (const r of rows) {
        log(`  RAW_ROW status=${r.status} provider=${r.provider} pctLong=${r.pctLong} source=${r.source} fetchedAt=${r.fetchedAt.toISOString()} (age ${ageHours(r.fetchedAt)}) sourceUpdatedAt=${r.sourceUpdatedAt?.toISOString() ?? "null"}`);
      }
    }
  }

  log("DONE");
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
