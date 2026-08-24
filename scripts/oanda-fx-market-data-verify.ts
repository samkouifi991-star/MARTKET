// Controlled coverage test for OANDA as an FX price/candle source —
// NOT wired into the live pipeline. Tests exactly what the user asked for,
// in the order asked: the three FMP-blocked crosses (EURGBP, EURJPY,
// GBPJPY) first, then all 10 configured FX pairs.
//
// For each symbol: current pricing, daily candles, H1 candles, H4 candles,
// maximum historical depth (single-request cap), earliest/latest candle.
//
// Neon write+read-back is only exercised for symbols confirmed to have ZERO
// existing price/candle rows in Neon (the three crosses — never seeded,
// FMP-blocked — plus USDCHF/NZDUSD, whose FMP seed never completed). For
// the five already-STRICT_LIVE pairs (GBPUSD/EURUSD/USDJPY/AUDUSD/USDCAD),
// writing OANDA candles into the SAME market_candles rows real FMP data
// already occupies risks silently overwriting or duplicating production
// history (upsertCandles conflicts on symbol+timeframe+date) before any
// deliberate provider-priority decision has been made — so those five get
// the full read-side coverage/quality check only, with the write step
// explicitly skipped and logged as such, not silently omitted.
//
// Usage: OANDA_API_TOKEN=xxx OANDA_ACCOUNT_ID=xxx npm run test:oanda-fx-market-data-verify
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import * as oanda from "../src/services/market-data/oanda-market-data";
import { getSymbolMapping } from "../src/services/market-data/symbol-map";
import { upsertMarketPrice, upsertCandles, getLatestStoredPrice, getLatestStoredDailyCandles } from "../src/db/queries/market-data";
import { DATA_MODE } from "../src/services/data-mode";

const CROSSES = ["EURGBP", "EURJPY", "GBPJPY"];
const ALL_10 = ["GBPUSD", "EURUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY"];
// Confirmed empty of stored price/candle rows this session (five-market-verify.ts,
// the remaining-market coverage audit) — safe to write OANDA data into without
// colliding with existing FMP-sourced rows.
const SAFE_TO_WRITE = new Set(["EURGBP", "EURJPY", "GBPJPY", "USDCHF", "NZDUSD"]);

function log(msg: string): void {
  console.log(`OANDA_FX_MARKET_DATA_VERIFY: ${msg}`);
}

function span(candles: { date: string }[]): string {
  if (candles.length === 0) return "n/a";
  return `${candles[0].date} .. ${candles[candles.length - 1].date} (${candles.length} bars)`;
}

async function verifyOne(symbol: string): Promise<void> {
  const mapping = getSymbolMapping(symbol);
  log(`==== ${symbol} (OANDA instrument: ${mapping?.oandaInstrument ?? "none"}) ====`);

  const quote = await oanda.getQuote(symbol);
  log(`QUOTE status=${quote.status}${quote.value ? ` price=${quote.value.price} changePct24h=${quote.value.changePct24h.toFixed(3)} timestamp=${quote.value.timestamp}` : ""}${quote.error ? ` error=${quote.error}` : ""}`);

  const daily = await oanda.getDailyCandles(symbol, 260);
  log(`DAILY status=${daily.status} span=${daily.value ? span(daily.value) : "n/a"}${daily.error ? ` error=${daily.error}` : ""}`);

  const h1 = await oanda.getIntradayCandles(symbol, "H1");
  log(`H1 status=${h1.status} span=${h1.value ? span(h1.value) : "n/a"}${h1.error ? ` error=${h1.error}` : ""}`);

  const h4 = await oanda.getIntradayCandles(symbol, "H4");
  log(`H4 status=${h4.status} span=${h4.value ? span(h4.value) : "n/a"}${h4.error ? ` error=${h4.error}` : ""}`);

  const backfill = await oanda.getDailyCandlesBackfill(symbol);
  log(`MAX_HISTORY status=${backfill.status} span=${backfill.value ? span(backfill.value) : "n/a"}${backfill.error ? ` error=${backfill.error}` : ""}`);

  if (!SAFE_TO_WRITE.has(symbol)) {
    log(`NEON_WRITE skipped — ${symbol} already has real FMP-sourced price/candle history in Neon; see file header for why writing OANDA data here is deferred`);
    return;
  }

  if (!quote.value || !backfill.value || backfill.value.length === 0) {
    log(`NEON_WRITE skipped — quote or candle data unavailable for ${symbol}, nothing valid to write`);
    return;
  }

  await upsertMarketPrice(symbol, quote.value, "oanda");
  await upsertCandles(symbol, "1d", backfill.value, "oanda");
  log(`NEON_WRITE ok (price + ${backfill.value.length} daily candles)`);

  const storedPrice = await getLatestStoredPrice(symbol);
  const storedCandles = await getLatestStoredDailyCandles(symbol);
  const priceMatches = storedPrice !== null && Math.abs(storedPrice.price - quote.value.price) < 1e-6;
  const candleCountMatches = storedCandles !== null && storedCandles.candles.length === backfill.value.length;
  log(`NEON_READBACK price=${storedPrice ? storedPrice.price : "null"} matches=${priceMatches} candleCount=${storedCandles?.candles.length ?? 0} matches=${candleCountMatches}`);
}

async function main() {
  if (DATA_MODE === "demo") {
    log("SKIPPED — DATA_MODE is demo in this environment");
    return;
  }
  if (!process.env.OANDA_API_TOKEN) {
    log("SKIPPED — OANDA_API_TOKEN not set");
    return;
  }
  if (!process.env.OANDA_ACCOUNT_ID) {
    log("NOTE — OANDA_ACCOUNT_ID not set; quote/pricing will report unavailable, candle checks still run");
  }

  log("=== PHASE 1: the three FMP-blocked crosses ===");
  for (const symbol of CROSSES) {
    try {
      await verifyOne(symbol);
    } catch (err) {
      log(`${symbol} FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log("=== PHASE 2: all 10 configured FX pairs ===");
  for (const symbol of ALL_10) {
    try {
      await verifyOne(symbol);
    } catch (err) {
      log(`${symbol} FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log("DONE — not wired into the live pipeline; provider priority unchanged pending review");
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
