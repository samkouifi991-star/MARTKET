// fmp-coverage-test.ts's table only shows OK/MISSING/ERROR, not why — this
// gets the real .error string for every symbol it flagged ERROR, so BLOCKED
// (a genuine 402 plan-tier gap) can be told apart from a real mapping bug
// that should be fixed rather than reported as blocked.
//
// Usage: npm run test:fmp-error-detail
import * as fmp from "../src/services/market-data/fmp";

const SYMBOLS = ["EURGBP", "EURJPY", "GBPJPY", "DAX40", "COPPER", "XPTUSD", "WTIUSD", "NATGAS"];

function log(msg: string): void {
  console.log(`FMP_ERROR_DETAIL: ${msg}`);
}

async function main() {
  for (const symbol of SYMBOLS) {
    const quote = await fmp.getQuote(symbol);
    log(`${symbol} QUOTE status=${quote.status} error=${quote.error ?? "n/a"}`);
    const daily = await fmp.getDailyCandles(symbol, 260);
    log(`${symbol} DAILY status=${daily.status} error=${daily.error ?? "n/a"}`);
  }
  log("DONE");
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
