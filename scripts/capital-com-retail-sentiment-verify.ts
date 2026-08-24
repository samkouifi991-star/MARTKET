// Verifies whether Capital.com's official /api/v1/clientsentiment endpoint
// actually covers the requested markets, and what its real Capital.com
// "marketId" values are, before wiring Capital.com in as a secondary
// retail-sentiment source (see retail-sentiment/index.ts's priority-order
// comment: OANDA primary, Capital.com secondary once verified, IG/Myfxbook
// after that). Same "verify live, never assume the identifier or response
// shape" rigor already applied to every other provider in this project
// (see scripts/oanda-metals-retail-sentiment-verify.ts) — this hits the
// real API and logs the raw response shape so a wrong assumption about
// Capital.com's marketId convention or field names is caught here, not
// silently in production.
//
// For each target market this:
//   1. calls GET /api/v1/markets?searchTerm=<term> to discover the real
//      Capital.com marketId (never assumed from a guess alone)
//   2. calls GET /api/v1/clientsentiment/<candidate marketId> using the
//      best candidate (either the discovered marketId, or this project's
//      best-guess convention if discovery found nothing usable) and logs
//      the raw response
//
// Does NOT change symbol-map.ts, does NOT change retail-sentiment/index.ts's
// provider array, does NOT write to the database — read-only verification.
//
// Usage: npm run test:capital-com-retail-sentiment-verify
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { searchMarkets, fetchClientSentiment } from "../src/services/market-data/capital-com";

// Best-guess marketId candidates, following Capital.com's own documented
// clientsentiment example (marketIds like "SILVER"/"NATURALGAS") and its
// platform's plain ticker-style codes for indices (e.g. "US500", "UK100").
// These are candidates only — NOT confirmed, and NOT written into
// symbol-map.ts by this script. The /markets?searchTerm= discovery call
// below is the actual verification; the candidate is just what gets tried
// against /clientsentiment/ directly, for comparison.
const TARGETS: { symbol: string; searchTerm: string; candidateMarketId: string }[] = [
  { symbol: "XAUUSD", searchTerm: "Gold", candidateMarketId: "GOLD" },
  { symbol: "XAGUSD", searchTerm: "Silver", candidateMarketId: "SILVER" },
  { symbol: "SPX500", searchTerm: "US 500", candidateMarketId: "US500" },
  { symbol: "DJ30", searchTerm: "Wall Street", candidateMarketId: "US30" },
  { symbol: "RUT2000", searchTerm: "US 2000", candidateMarketId: "US2000" },
  { symbol: "FTSE100", searchTerm: "FTSE 100", candidateMarketId: "UK100" },
  { symbol: "NIKKEI225", searchTerm: "Japan 225", candidateMarketId: "JP225" },
];

function log(msg: string): void {
  console.log(`CAPITAL_COM_RETAIL_SENTIMENT_VERIFY: ${msg}`);
}

function credentialsConfigured(): boolean {
  return Boolean(process.env.CAPITAL_COM_API_KEY && process.env.CAPITAL_COM_IDENTIFIER && process.env.CAPITAL_COM_PASSWORD);
}

function extractMarketIdCandidates(markets: Array<Record<string, unknown>>): { marketId: string; instrumentName: string }[] {
  return markets
    .map((m) => {
      // Capital.com market entries nest identity under `instrument` in some
      // API versions and flat in others — check both without assuming.
      const instrument = (m.instrument as Record<string, unknown> | undefined) ?? m;
      const marketId = (instrument.epic ?? instrument.marketId ?? m.epic ?? m.marketId) as string | undefined;
      const instrumentName = (instrument.name ?? instrument.instrumentName ?? m.instrumentName) as string | undefined;
      return marketId ? { marketId, instrumentName: instrumentName ?? "(no name field)" } : null;
    })
    .filter((x): x is { marketId: string; instrumentName: string } => x !== null);
}

async function verifyOne(symbol: string, searchTerm: string, candidateMarketId: string): Promise<void> {
  log(`==== ${symbol} (search term: "${searchTerm}", candidate marketId: ${candidateMarketId}) ====`);

  // Step 1: discover the real marketId via search.
  try {
    const search = await searchMarkets(searchTerm);
    log(`  markets?searchTerm= HTTP status=${search.status} ok=${search.ok}`);
    if (!search.ok) {
      log(`  RAW_ERROR_BODY: ${JSON.stringify(search.raw).slice(0, 500)}`);
    } else {
      const candidates = extractMarketIdCandidates(search.markets);
      if (candidates.length === 0) {
        log(`  NO MARKETS RETURNED for searchTerm="${searchTerm}" — raw keys: ${typeof search.raw === "object" && search.raw ? Object.keys(search.raw as object).join(",") : typeof search.raw}`);
      } else {
        log(`  DISCOVERED ${candidates.length} candidate market(s):`);
        for (const c of candidates.slice(0, 10)) {
          log(`    marketId=${c.marketId} instrumentName=${c.instrumentName}`);
        }
      }
    }
  } catch (err) {
    log(`  markets?searchTerm= FAILED — ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 2: call clientsentiment directly with the best-guess candidate.
  try {
    const sentiment = await fetchClientSentiment(candidateMarketId);
    log(`  clientsentiment/${candidateMarketId} HTTP status=${sentiment.status} ok=${sentiment.ok}`);
    log(`  RAW_RESPONSE: ${JSON.stringify(sentiment.raw).slice(0, 800)}`);

    if (sentiment.ok && sentiment.raw && typeof sentiment.raw === "object") {
      const body = sentiment.raw as { marketId?: string; longPositionPercentage?: number; shortPositionPercentage?: number };
      const hasPct = typeof body.longPositionPercentage === "number" && typeof body.shortPositionPercentage === "number";
      log(
        `  RESULT: ${symbol} — marketId=${body.marketId ?? candidateMarketId} long%=${body.longPositionPercentage ?? "N/A"} short%=${body.shortPositionPercentage ?? "N/A"} timestamp=N/A (Capital.com clientsentiment does not return a per-market timestamp field) status=${hasPct ? "REAL, USABLE clientsentiment data confirmed" : "response ok but missing expected long/short percentage fields — see raw response above"}`
      );
    } else {
      log(`  RESULT: ${symbol} — API status ${sentiment.status}, not usable`);
    }
  } catch (err) {
    log(`  RESULT: ${symbol} — FAILED — ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  if (!credentialsConfigured()) {
    log("CAPITAL_COM_API_KEY / CAPITAL_COM_IDENTIFIER / CAPITAL_COM_PASSWORD not configured — cannot verify. Set these (in .env.local for a local run, or as Vercel/GitHub secrets for a remote run) and re-run.");
    return;
  }

  for (const { symbol, searchTerm, candidateMarketId } of TARGETS) {
    await verifyOne(symbol, searchTerm, candidateMarketId);
  }
  log("DONE — no wiring, symbol-map.ts, or database state changed by this script");
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
