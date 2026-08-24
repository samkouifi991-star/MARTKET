// Controlled OANDA PositionBook verification. First batch (GBPUSD, EURUSD,
// USDJPY, AUDUSD, USDCAD) already verified and approved as primary. This
// script's default batch is now the second, user-approved expansion —
// USDCHF, NZDUSD, EURGBP, EURJPY, GBPJPY — and deliberately touches nothing
// beyond it; pass symbols explicitly (argv) to verify a different set.
//
// Exercises the real architecture end to end for each symbol: OANDA
// PositionBook (live) -> Neon write -> Neon read-back -> the Retail
// Sentiment scoring factor (which reads Neon only, never OANDA directly —
// see last-known-good.ts). For each symbol, reports: the OANDA instrument
// mapping, whether the live PositionBook call succeeded, long %/short %,
// the provider's own source timestamp, whether the Neon write succeeded,
// whether the Neon read-back matches what was written, the resolved
// Retail Sentiment factor (raw score, Bullish/Bearish/Neutral
// classification derived from that score's sign, and freshness — which
// now reflects the age of OANDA's own source timestamp, not how recently
// the row was written; see classifyRetailSentimentFreshness).
//
// Calls oandaProvider directly, never the multi-provider combinator, so a
// symbol OANDA doesn't cover is reported honestly as such — this script
// never falls back to IG or Myfxbook mid-verification.
//
// Usage: OANDA_API_TOKEN=xxx npm run test:oanda-verify [SYMBOL...]
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { oandaProvider } from "../src/services/market-data/retail-sentiment/oanda";
import { getSymbolMapping } from "../src/services/market-data/symbol-map";
import { insertRetailSentiment, getLatestStoredRetailSentiment } from "../src/db/queries/market-data";
import { resolveRetailSentimentFactor } from "../src/lib/pipeline/sentiment";
import { DATA_MODE } from "../src/services/data-mode";

const DEFAULT_BATCH = ["USDCHF", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY"];

function log(msg: string): void {
  console.log(`OANDA_VERIFY: ${msg}`);
}

function classify(rawScore: number): "Bullish" | "Bearish" | "Neutral" {
  if (rawScore > 0) return "Bullish";
  if (rawScore < 0) return "Bearish";
  return "Neutral";
}

async function verifyOne(symbol: string): Promise<void> {
  const mapping = getSymbolMapping(symbol);
  log(`==== ${symbol} (OANDA instrument: ${mapping?.oandaInstrument ?? "none"}) ====`);

  const result = await oandaProvider.getRetailSentiment(symbol);
  log(`POSITIONBOOK_RESPONSE status=${result.status}${result.error ? ` error=${result.error}` : ""}`);
  if (!result.value) {
    log(`${symbol} SKIPPED — no usable PositionBook result, nothing to write`);
    return;
  }

  log(`LONG_PCT=${result.value.pctLong.toFixed(2)} SHORT_PCT=${result.value.pctShort.toFixed(2)} SOURCE_TIMESTAMP=${result.sourceUpdatedAt}`);

  await insertRetailSentiment(symbol, result.value.pctLong, result.value.pctShort, result.status, result.provider, result.source, result.sourceUpdatedAt);
  log(`NEON_WRITE ok`);

  const stored = await getLatestStoredRetailSentiment(symbol);
  const readbackMatches = stored !== null && Math.abs(stored.pctLong - result.value.pctLong) < 1e-6 && Math.abs(stored.pctShort - result.value.pctShort) < 1e-6;
  log(`NEON_READBACK ${stored ? `pctLong=${stored.pctLong} pctShort=${stored.pctShort} sourceUpdatedAt=${stored.sourceUpdatedAt?.toISOString() ?? "null"} matches=${readbackMatches}` : "null — write did not land"}`);

  const factor = await resolveRetailSentimentFactor(symbol, "live");
  log(`RETAIL_SENTIMENT_FACTOR rawScore=${factor.rawScore} classification=${classify(factor.rawScore)} freshness=${factor.freshness} explanation="${factor.explanation}"`);
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

  const requested = process.argv.slice(2);
  const symbols = requested.length > 0 ? requested : DEFAULT_BATCH;

  for (const symbol of symbols) {
    try {
      await verifyOne(symbol);
    } catch (err) {
      log(`${symbol} FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log(`DONE (${symbols.join(", ")}) — do not expand further without reviewing these results`);
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
