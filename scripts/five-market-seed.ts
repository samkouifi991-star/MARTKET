// One-time seed for the current 5-market batch (originally EURUSD, USDJPY,
// XAUUSD, BTCUSD, SPX500). five-market-verify.ts found zero stored rows
// for any of them — price, candles, CFTC, retail sentiment, FRED — for the
// same reason GBPUSD needed manual one-off backfills earlier this session:
// Vercel Cron Jobs only fire against the Production deployment, and this
// project has deliberately stayed on Preview-only deploys, so the real
// cron schedule in vercel.json has never actually executed here. Without
// this seed, promoting these symbols to STRICT_LIVE_SYMBOLS would make
// their pages show UNAVAILABLE everywhere — exactly the failure mode the
// storage-first architecture exists to prevent.
//
// Seeds price + daily candles only (the two datasets the last-known-good
// fallback and Technical/Seasonality actually read from storage).
// Institutional/retail-sentiment/macro are called live on every request in
// the current architecture (no DB-storage-first layer for them yet — same
// as GBPUSD), so there's nothing to backfill for those.
//
// Usage: npm run test:five-market-seed
import * as fmp from "../src/services/market-data/fmp";
import { upsertMarketPrice, upsertCandles } from "../src/db/queries/market-data";
import { DATA_MODE } from "../src/services/data-mode";

// Third-phase batch: AUDUSD, USDCAD, XAGUSD, NAS100, DJ30.
const SYMBOLS = ["AUDUSD", "USDCAD", "XAGUSD", "NAS100", "DJ30"];

function log(msg: string): void {
  console.log(`FIVE_MARKET_SEED: ${msg}`);
}

async function seedOne(symbol: string): Promise<void> {
  const quote = await fmp.getQuote(symbol);
  if (quote.status === "live" && quote.value) {
    await upsertMarketPrice(symbol, quote.value, "fmp");
    log(`${symbol} PRICE stored=${quote.value.price} sourceUpdatedAt=${quote.sourceUpdatedAt}`);
  } else {
    log(`${symbol} PRICE SKIPPED — ${quote.error ?? quote.status}`);
  }

  const history = await fmp.getDailyCandles(symbol, 20 * 365);
  if (history.status === "live" && history.value) {
    await upsertCandles(symbol, "1d", history.value, "fmp");
    const earliest = history.value[0]?.date;
    const latest = history.value[history.value.length - 1]?.date;
    log(`${symbol} CANDLES stored count=${history.value.length} span=${earliest} to ${latest}`);
  } else {
    log(`${symbol} CANDLES SKIPPED — ${history.error ?? history.status}`);
  }
}

async function main() {
  if (DATA_MODE === "demo") {
    log("SKIPPED — DATA_MODE is demo in this environment");
    return;
  }

  for (const symbol of SYMBOLS) {
    try {
      await seedOne(symbol);
    } catch (err) {
      log(`${symbol} FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log("DONE");
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
