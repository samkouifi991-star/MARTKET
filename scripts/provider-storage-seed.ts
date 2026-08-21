// One-time seed for CFTC positioning / FRED macro / retail sentiment
// storage, for the current live batch (GBPUSD + the second-phase 5:
// EURUSD, USDJPY, XAUUSD, BTCUSD, SPX500). Same root cause as
// five-market-seed.ts: Vercel Cron Jobs only fire against the Production
// deployment, and this project has stayed Preview-only, so the real
// positioning/macro/retail-sentiment crons have never actually populated
// these three tables. Without this seed, the new storage-first fallback
// wrappers (getPositioningWithFallback, getFredSeriesWithFallback,
// getRetailSentimentWithFallback) have nothing to fall back to for any of
// these symbols — this seeds real data so that layer can be genuinely
// tested against Neon, not just unit-tested with mocks.
//
// Mirrors exactly what the three cron routes do — same upsert calls, same
// "store any real value (live/delayed/stale), not just live" guard — just
// triggered once, manually, instead of on a schedule that never fires here.
//
// Usage: npm run test:provider-storage-seed
import * as cftc from "../src/services/market-data/cftc";
import * as retailSentiment from "../src/services/market-data/retail-sentiment";
import * as fred from "../src/services/market-data/fred";
import { upsertPositioning, insertRetailSentiment, upsertEconomicIndicator, getLatestStoredPositioning, getLatestStoredRetailSentiment, getLatestStoredEconomicSeries } from "../src/db/queries/market-data";
import { getSymbolMapping } from "../src/services/market-data/symbol-map";
import { FRED_SERIES, FredIndicatorKey } from "../src/services/market-data/fred-series";
import { DATA_MODE } from "../src/services/data-mode";

// Third-phase batch: AUDUSD, USDCAD, XAGUSD, NAS100, DJ30 (GBPUSD + the
// second-phase 5 already seeded in earlier runs).
const SYMBOLS = ["AUDUSD", "USDCAD", "XAGUSD", "NAS100", "DJ30"];

function log(msg: string): void {
  console.log(`PROVIDER_STORAGE_SEED: ${msg}`);
}

async function seedPositioning(symbol: string) {
  if (!getSymbolMapping(symbol)?.cftc) {
    log(`${symbol} CFTC skipped — no CFTC-reportable contract (not_applicable)`);
    return;
  }
  const result = await cftc.getInstitutionalPositioning(symbol);
  if (!result.value) {
    log(`${symbol} CFTC SKIPPED — ${result.error ?? result.status}`);
    return;
  }
  await upsertPositioning(symbol, result.value, result.source);
  log(`${symbol} CFTC stored status=${result.status} reportDate=${result.value.reportDate} netPositioning=${result.value.netPositioning}`);
}

async function seedRetailSentiment(symbol: string) {
  const mapping = getSymbolMapping(symbol);
  if (!mapping?.myfxbookSymbol && !mapping?.igEpic) {
    log(`${symbol} retail sentiment skipped — no provider coverage (not_applicable)`);
    return;
  }
  const result = await retailSentiment.getRetailSentiment(symbol);
  if (!result.value) {
    log(`${symbol} retail sentiment SKIPPED — ${result.error ?? result.status}`);
    return;
  }
  await insertRetailSentiment(symbol, result.value.pctLong, result.value.pctShort, result.status, result.provider, result.source);
  log(`${symbol} retail sentiment stored status=${result.status} pctLong=${result.value.pctLong} pctShort=${result.value.pctShort} provider=${result.provider}`);
}

async function seedFred() {
  let ok = 0;
  let skipped = 0;
  for (const [country, indicators] of Object.entries(FRED_SERIES)) {
    for (const [indicatorKey, meta] of Object.entries(indicators) as [FredIndicatorKey, { id: string; verified: boolean }][]) {
      if (!meta.verified) continue;
      const result = await fred.getSeries(country, indicatorKey, 36);
      if (!result.value) {
        skipped++;
        continue;
      }
      for (const point of result.value) {
        await upsertEconomicIndicator(country, indicatorKey, meta.id, point.date, point.value);
      }
      ok++;
    }
  }
  log(`FRED stored ${ok} series (${skipped} skipped — unavailable/error)`);
}

async function main() {
  if (DATA_MODE === "demo") {
    log("SKIPPED — DATA_MODE is demo in this environment");
    return;
  }

  for (const symbol of SYMBOLS) {
    await seedPositioning(symbol);
    await seedRetailSentiment(symbol);
  }
  await seedFred();

  // Round-trip verification: read back through the exact same DB helpers
  // getPositioningWithFallback/getFredSeriesWithFallback/
  // getRetailSentimentWithFallback call on a live failure — proves the
  // read side actually works against real stored rows, not just mocks.
  log("---- round-trip verification (the read side the fallback wrappers use) ----");
  for (const symbol of SYMBOLS) {
    const pos = await getLatestStoredPositioning(symbol);
    log(`${symbol} getLatestStoredPositioning: ${pos ? `reportDate=${pos.positioning.reportDate} netHistory.length=${pos.positioning.netHistory.length} fetchedAt=${pos.fetchedAt.toISOString()}` : "null"}`);
    const sent = await getLatestStoredRetailSentiment(symbol);
    log(`${symbol} getLatestStoredRetailSentiment: ${sent ? `pctLong=${sent.pctLong} fetchedAt=${sent.fetchedAt.toISOString()}` : "null"}`);
  }
  const gbGrowth = await getLatestStoredEconomicSeries("GB", "realGdp", 6);
  log(`GB getLatestStoredEconomicSeries(realGdp): ${gbGrowth ? `${gbGrowth.points.length} points, latest=${gbGrowth.points[gbGrowth.points.length - 1]?.date}` : "null"}`);
  const euCpi = await getLatestStoredEconomicSeries("EU", "cpi", 6);
  log(`EU getLatestStoredEconomicSeries(cpi): ${euCpi ? `${euCpi.points.length} points, latest=${euCpi.points[euCpi.points.length - 1]?.date}` : "null"}`);

  log("DONE");
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
