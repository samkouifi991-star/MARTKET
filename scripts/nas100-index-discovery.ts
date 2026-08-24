// Determines whether NAS100 can be supported on the current FMP plan via
// a different symbol before considering a plan upgrade. ^NDX returned 402
// Payment Required on both /quote and /historical-price-eod/full — this
// script queries FMP's real index directory for every legitimate
// Nasdaq-100 candidate, tests each one's quote + daily-candle coverage
// under the current plan, and separately tests QQQ (an ETF proxy, never
// to be silently presented as the index itself). Every call goes through
// fmp.ts's existing getIndexList/getQuoteForTicker/getDailyCandlesForTicker
// — same rate-limit circuit breaker and caching as the live pipeline, no
// naive retry loop of its own.
//
// Usage: npm run test:nas100-discovery
import * as fmp from "../src/services/market-data/fmp";
import { DATA_MODE } from "../src/services/data-mode";

function log(msg: string): void {
  console.log(`NAS100_DISCOVERY: ${msg}`);
}

const NASDAQ_100_PATTERN = /nasdaq.?100|ndx|us100|nas100/i;

async function testCandidate(label: string, ticker: string): Promise<void> {
  log(`---- testing ${label} (ticker="${ticker}") ----`);

  const quote = await fmp.getQuoteForTicker(ticker);
  if (quote.status === "live" && quote.value) {
    log(`${label} QUOTE ok price=${quote.value.price} changePct24h=${quote.value.changePct24h} sourceUpdatedAt=${quote.sourceUpdatedAt}`);
  } else {
    log(`${label} QUOTE FAILED status=${quote.status} error=${quote.error ?? "n/a"}`);
  }

  const candles = await fmp.getDailyCandlesForTicker(ticker, 20 * 365);
  if (candles.status === "live" && candles.value && candles.value.length > 0) {
    const earliest = candles.value[0].date;
    const latest = candles.value[candles.value.length - 1].date;
    log(`${label} CANDLES ok count=${candles.value.length} earliest=${earliest} latest=${latest}`);
  } else {
    log(`${label} CANDLES FAILED status=${candles.status} error=${candles.error ?? "n/a"}`);
  }
}

async function main() {
  if (DATA_MODE === "demo") {
    log("SKIPPED — DATA_MODE is demo in this environment");
    return;
  }

  // Step 1: query the real FMP index directory, report every candidate.
  const indexList = await fmp.getIndexList();
  if (indexList.status !== "live" || !indexList.value) {
    log(`INDEX_LIST FAILED status=${indexList.status} error=${indexList.error ?? "n/a"} — cannot proceed with candidate discovery`);
    return;
  }
  log(`INDEX_LIST ok — ${indexList.value.length} total indices returned`);

  const candidates = indexList.value.filter((i) => NASDAQ_100_PATTERN.test(i.symbol) || NASDAQ_100_PATTERN.test(i.name));
  log(`Found ${candidates.length} candidate(s) matching Nasdaq-100/NDX/US100/NAS100:`);
  for (const c of candidates) {
    log(`CANDIDATE symbol="${c.symbol}" name="${c.name}" exchange="${c.exchange}" currency="${c.currency}"`);
  }
  if (candidates.length === 0) {
    log("No candidates found in the index directory matching the Nasdaq-100 by name/symbol.");
  }

  // Step 2: test each genuine candidate's quote + daily candle coverage.
  for (const c of candidates) {
    await testCandidate(`INDEX:${c.symbol}`, c.symbol);
  }

  // Step 4: test QQQ separately as an explicit ETF-proxy fallback — never
  // to be silently treated as the index itself.
  await testCandidate("QQQ (Invesco QQQ ETF proxy)", "QQQ");

  log("DONE");
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
