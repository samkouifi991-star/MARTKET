// Verifies whether OANDA's v20 PositionBook endpoint actually covers gold
// and silver before wiring OANDA in as a retail-sentiment source for
// XAUUSD/XAGUSD — the same "verify live, never assume the ticker/response
// shape" rigor already applied to every other OANDA instrument this
// session. XAU_USD/XAG_USD are OANDA's documented CFD ticker codes for
// gold/silver, but that alone isn't confirmation: this hits the real
// endpoint and logs the raw response shape so a wrong assumption about
// field names or coverage is caught here, not silently in production.
//
// Does NOT change any provider mapping or wiring — read-only verification.
//
// Usage: npm run test:oanda-metals-retail-sentiment-verify
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

const CANDIDATES = [
  { symbol: "XAUUSD", oandaInstrument: "XAU_USD" },
  { symbol: "XAGUSD", oandaInstrument: "XAG_USD" },
];

function log(msg: string): void {
  console.log(`OANDA_METALS_RETAIL_SENTIMENT_VERIFY: ${msg}`);
}

function baseUrl(): string {
  return process.env.OANDA_ENVIRONMENT === "live" ? "https://api-fxtrade.oanda.com" : "https://api-fxpractice.oanda.com";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 520 is a Cloudflare edge error (transient infra hiccup between this build
// environment and OANDA), not a real answer from OANDA about instrument
// coverage — retry a couple of times before treating it as inconclusive,
// rather than mistaking network flakiness for "not covered".
async function fetchWithRetry(url: string, token: string, attempts = 3): Promise<{ res: Response; bodyText: string }> {
  let lastRes: Response | null = null;
  let lastBody = "";
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const bodyText = await res.text();
    if (res.ok || (res.status !== 520 && res.status < 500)) return { res, bodyText };
    lastRes = res;
    lastBody = bodyText;
    if (i < attempts - 1) {
      log(`  transient ${res.status} on attempt ${i + 1}/${attempts}, retrying in 3s...`);
      await sleep(3000);
    }
  }
  return { res: lastRes!, bodyText: lastBody };
}

async function verifyOne(symbol: string, oandaInstrument: string): Promise<void> {
  log(`==== ${symbol} (OANDA instrument: ${oandaInstrument}) ====`);
  const token = process.env.OANDA_API_TOKEN;
  if (!token) {
    log("OANDA_API_TOKEN not configured — cannot verify");
    return;
  }

  const url = `${baseUrl()}/v3/instruments/${encodeURIComponent(oandaInstrument)}/positionBook`;
  try {
    const { res, bodyText } = await fetchWithRetry(url, token);
    log(`HTTP status=${res.status} ${res.statusText}`);
    if (!res.ok) {
      log(`RAW_ERROR_BODY: ${bodyText.slice(0, 500)}`);
      return;
    }
    const data = JSON.parse(bodyText) as {
      positionBook?: { instrument: string; time: string; unclassifiedPositionRatio?: string; buckets?: { price: string; longCountPercent: string; shortCountPercent: string }[] };
    };
    const book = data.positionBook;
    if (!book) {
      log(`NO positionBook FIELD IN RESPONSE — raw keys: ${Object.keys(data).join(",")}`);
      return;
    }
    log(`positionBook.instrument=${book.instrument} time=${book.time} bucketCount=${book.buckets?.length ?? 0}`);
    if (book.buckets && book.buckets.length > 0) {
      let aggregateLong = 0;
      let aggregateShort = 0;
      for (const b of book.buckets) {
        aggregateLong += Number(b.longCountPercent) || 0;
        aggregateShort += Number(b.shortCountPercent) || 0;
      }
      const total = aggregateLong + aggregateShort;
      const pctLong = total > 0 ? (aggregateLong / total) * 100 : 0;
      const pctShort = total > 0 ? (aggregateShort / total) * 100 : 0;
      log(`COMPUTED pctLong=${pctLong.toFixed(2)} pctShort=${pctShort.toFixed(2)} (from ${book.buckets.length} buckets, same aggregation logic as retail-sentiment/oanda.ts)`);
      log(`RESULT: ${symbol} — REAL, USABLE PositionBook data confirmed`);
    } else {
      log(`RESULT: ${symbol} — positionBook present but no buckets, not usable`);
    }
  } catch (err) {
    log(`FAILED — ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  for (const { symbol, oandaInstrument } of CANDIDATES) {
    await verifyOne(symbol, oandaInstrument);
  }
  log("DONE — no wiring changed by this script");
}

main().catch((err) => log(`FATAL — ${err instanceof Error ? err.message : String(err)}`));
