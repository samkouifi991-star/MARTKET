// Diagnoses a live FMP 429 with exactly ONE request — does not use fmpGet's
// circuit breaker or cache, and never retries. Prints HTTP status,
// Retry-After, every rate-limit-related response header, and the response
// body (which for FMP normally names the exact plan/quota problem, e.g.
// "Limit Reach" for a daily cap vs. a generic throttle message for a
// per-minute one). The API key is never logged — it's sent only as a query
// param on the outbound request, never echoed back into any printed value.
//
// Usage: FMP_API_KEY=xxx npm run test:fmp-rate-limit-diagnose
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

const FMP_BASE = "https://financialmodelingprep.com/stable";

// Headers whose names commonly carry rate-limit/quota information across
// APIs generally (FMP doesn't document a fixed set, so this checks broadly
// rather than assuming one convention).
const RATE_LIMIT_HEADER_NAMES = [
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-rate-limit-limit",
  "x-rate-limit-remaining",
  "x-rate-limit-reset",
  "x-quota-limit",
  "x-quota-remaining",
  "x-daily-limit",
  "x-daily-remaining",
];

function log(msg: string): void {
  console.log(`FMP_DIAGNOSE: ${msg}`);
}

async function main() {
  const key = process.env.FMP_API_KEY?.trim();
  if (!key) {
    log("SKIPPED — FMP_API_KEY not set");
    return;
  }

  const url = new URL(`${FMP_BASE}/quote`);
  url.searchParams.set("symbol", "AAPL");
  url.searchParams.set("apikey", key);

  let res: Response;
  try {
    res = await fetch(url.toString(), { next: { revalidate: 0 } });
  } catch (err) {
    log(`REQUEST FAILED (network) — ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  log(`HTTP_STATUS: ${res.status} ${res.statusText}`);

  for (const name of RATE_LIMIT_HEADER_NAMES) {
    const value = res.headers.get(name);
    if (value !== null) log(`HEADER ${name}: ${value}`);
  }

  // Print every header for completeness — none of these carry the API key
  // (it was only ever sent as an outbound query param, never reflected back).
  const allHeaders: string[] = [];
  res.headers.forEach((value, name) => allHeaders.push(`${name}=${value}`));
  log(`ALL_HEADERS: ${allHeaders.join(" | ")}`);

  const bodyText = await res.text();
  log(`BODY (first 1000 chars): ${bodyText.slice(0, 1000)}`);

  if (res.status === 429) {
    log("This was a live 429 — see BODY above for FMP's own error message, which usually distinguishes a daily/account quota from per-minute throttling.");
  } else if (res.ok) {
    log("This request succeeded (not currently rate-limited).");
  }
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
