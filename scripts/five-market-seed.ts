// Controlled seed for the fourth-phase batch (RUT2000, FTSE100, NIKKEI225,
// ETHUSD, USDCHF, NZDUSD). five-market-verify.ts found zero stored rows for
// any of them — price, candles — for the same reason GBPUSD needed manual
// one-off backfills earlier this session: Vercel Cron Jobs only fire
// against the Production deployment, and this project has deliberately
// stayed on Preview-only deploys, so the real cron schedule in vercel.json
// has never actually executed here. Without this seed, promoting these
// symbols to STRICT_LIVE_SYMBOLS would make their pages show UNAVAILABLE
// everywhere — exactly the failure mode the storage-first architecture
// exists to prevent.
//
// Seeds price + daily candles only (the two datasets the last-known-good
// fallback and Technical/Seasonality actually read from storage).
// Institutional/retail-sentiment/macro are seeded separately by
// provider-storage-seed.ts.
//
// Runs symbols SEQUENTIALLY, one at a time, and — after an FMP 429 —
// STOPS immediately instead of continuing to the next symbol, so a single
// rate-limit event never burns through the whole batch's request budget.
// Pass a single symbol as argv[2] to seed just that one (the intended
// per-symbol "seed -> verify" workflow); with no argv[2], runs the full
// batch in order, still stopping at the first 429.
//
// Usage: npm run test:five-market-seed [SYMBOL]
import * as fmp from "../src/services/market-data/fmp";
import { upsertMarketPrice, upsertCandles } from "../src/db/queries/market-data";
import { DATA_MODE } from "../src/services/data-mode";

const BATCH = ["RUT2000", "FTSE100", "NIKKEI225", "ETHUSD", "USDCHF", "NZDUSD"];

function log(msg: string): void {
  console.log(`FIVE_MARKET_SEED: ${msg}`);
}

function isRateLimited(status: string, error?: string): boolean {
  return status === "unavailable" && !!error?.startsWith("RATE_LIMITED");
}

/** Returns true if this symbol hit a live FMP 429 (caller should stop). */
async function seedOne(symbol: string): Promise<boolean> {
  let rateLimited = false;

  const quote = await fmp.getQuote(symbol);
  if (quote.status === "live" && quote.value) {
    await upsertMarketPrice(symbol, quote.value, "fmp");
    log(`${symbol} PRICE stored=${quote.value.price} sourceUpdatedAt=${quote.sourceUpdatedAt}`);
  } else {
    log(`${symbol} PRICE SKIPPED — ${quote.error ?? quote.status}`);
    if (isRateLimited(quote.status, quote.error)) rateLimited = true;
  }

  if (rateLimited) {
    log(`${symbol} — stopping before candles fetch, FMP is rate-limiting right now`);
    return true;
  }

  const history = await fmp.getDailyCandles(symbol, 20 * 365);
  if (history.status === "live" && history.value) {
    await upsertCandles(symbol, "1d", history.value, "fmp");
    const earliest = history.value[0]?.date;
    const latest = history.value[history.value.length - 1]?.date;
    log(`${symbol} CANDLES stored count=${history.value.length} span=${earliest} to ${latest}`);
  } else {
    log(`${symbol} CANDLES SKIPPED — ${history.error ?? history.status}`);
    if (isRateLimited(history.status, history.error)) rateLimited = true;
  }

  return rateLimited;
}

async function main() {
  if (DATA_MODE === "demo") {
    log("SKIPPED — DATA_MODE is demo in this environment");
    return;
  }

  const requested = process.argv[2];
  if (requested && !BATCH.includes(requested)) {
    log(`FATAL — ${requested} is not part of the fourth-phase batch (${BATCH.join(", ")})`);
    return;
  }
  const symbols = requested ? [requested] : BATCH;

  for (const symbol of symbols) {
    try {
      const rateLimited = await seedOne(symbol);
      if (rateLimited) {
        log(`STOPPED — FMP rate limit hit at ${symbol}; not attempting remaining symbols this run`);
        return;
      }
    } catch (err) {
      log(`${symbol} FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log("DONE");
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
