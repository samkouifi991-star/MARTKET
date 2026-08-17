// Automated FMP coverage test — run this against a real FMP_API_KEY before
// relying on FMP for any market. For all 25 tracked instruments, checks:
// quote availability, daily history depth, 1H history, 4H history, latest
// timestamp, and provider status. Prints a summary table and, at the end, a
// list of exactly which markets look like they need a higher FMP plan
// (Ultimate) so that decision can be made from evidence, not guesswork.
//
// Usage:
//   FMP_API_KEY=xxx npm run test:fmp-coverage
// or place FMP_API_KEY in .env.local and just run: npm run test:fmp-coverage
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv(); // fall back to a plain .env if present

import { INSTRUMENTS } from "../src/lib/instruments";
import * as fmp from "../src/services/market-data/fmp";

type Row = {
  symbol: string;
  quote: "OK" | "MISSING" | "ERROR";
  quotePrice: string;
  daily: "OK" | "MISSING" | "ERROR";
  dailyBars: number;
  dailyYears: string;
  dailyLatest: string;
  h4: "OK" | "MISSING" | "ERROR";
  h4Bars: number;
  h1: "OK" | "MISSING" | "ERROR";
  h1Bars: number;
  needsReview: boolean;
  notes: string[];
};

function statusOf<T>(p: { status: string; value: T | null }): "OK" | "MISSING" | "ERROR" {
  if (p.status === "live" && p.value !== null) return "OK";
  if (p.status === "error") return "ERROR";
  return "MISSING";
}

async function checkInstrument(symbol: string): Promise<Row> {
  const [quote, daily, h4, h1] = await Promise.all([
    fmp.getQuote(symbol),
    fmp.getDailyCandles(symbol, 20 * 365),
    fmp.getIntradayCandles(symbol, "4hour"),
    fmp.getIntradayCandles(symbol, "1hour"),
  ]);

  const dailyBars = daily.value?.length ?? 0;
  const dailyYears = dailyBars > 0 ? (dailyBars / 252).toFixed(1) : "0";
  const dailyLatest = daily.value?.[daily.value.length - 1]?.date ?? "n/a";

  const notes: string[] = [];
  if (statusOf(quote) !== "OK") notes.push("quote unavailable");
  if (statusOf(daily) !== "OK") notes.push("no daily history");
  else if (dailyBars < 252 * 2) notes.push(`only ${dailyYears}y daily history (seasonality needs 2y+)`);
  if (statusOf(h4) !== "OK") notes.push("no 4H history");
  if (statusOf(h1) !== "OK") notes.push("no 1H history");

  return {
    symbol,
    quote: statusOf(quote),
    quotePrice: quote.value ? String(quote.value.price) : "-",
    daily: statusOf(daily),
    dailyBars,
    dailyYears,
    dailyLatest,
    h4: statusOf(h4),
    h4Bars: h4.value?.length ?? 0,
    h1: statusOf(h1),
    h1Bars: h1.value?.length ?? 0,
    needsReview: notes.length > 0,
    notes,
  };
}

async function main() {
  if (!process.env.FMP_API_KEY) {
    console.error("FMP_API_KEY is not set. Set it in .env.local or the environment before running this script.");
    process.exit(1);
  }

  console.log(`Testing FMP coverage for ${INSTRUMENTS.length} instruments...\n`);
  const rows: Row[] = [];
  for (const instrument of INSTRUMENTS) {
    process.stdout.write(`  ${instrument.symbol}...`);
    try {
      const row = await checkInstrument(instrument.symbol);
      rows.push(row);
      console.log(row.needsReview ? " needs review" : " OK");
    } catch (err) {
      console.log(" FAILED");
      rows.push({
        symbol: instrument.symbol,
        quote: "ERROR",
        quotePrice: "-",
        daily: "ERROR",
        dailyBars: 0,
        dailyYears: "0",
        dailyLatest: "n/a",
        h4: "ERROR",
        h4Bars: 0,
        h1: "ERROR",
        h1Bars: 0,
        needsReview: true,
        notes: [err instanceof Error ? err.message : String(err)],
      });
    }
  }

  console.log("\n" + "=".repeat(100));
  console.log(
    "Symbol".padEnd(10) +
      "Quote".padEnd(8) +
      "Daily".padEnd(8) +
      "Years".padEnd(8) +
      "4H".padEnd(6) +
      "1H".padEnd(6) +
      "Latest daily bar"
  );
  console.log("-".repeat(100));
  for (const r of rows) {
    console.log(r.symbol.padEnd(10) + r.quote.padEnd(8) + r.daily.padEnd(8) + r.dailyYears.padEnd(8) + r.h4.padEnd(6) + r.h1.padEnd(6) + r.dailyLatest);
  }

  const needsReview = rows.filter((r) => r.needsReview);
  console.log("\n" + "=".repeat(100));
  if (needsReview.length === 0) {
    console.log("All 25 markets have full quote/daily/4H/1H coverage on the current FMP plan.");
  } else {
    console.log(`${needsReview.length} market(s) need review before enabling live mode for them:\n`);
    for (const r of needsReview) {
      console.log(`  ${r.symbol}: ${r.notes.join("; ")}`);
    }
    console.log("\nIf these gaps are plan-tier limits (not symbol mapping errors), that's the exact list to check against FMP's Ultimate plan coverage before upgrading.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
