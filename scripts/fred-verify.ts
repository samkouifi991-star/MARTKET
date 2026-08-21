// Automated FRED series verification — run this against a real
// FRED_API_KEY before letting any FRED-sourced macro factor contribute to
// a live score. For every series currently configured in
// src/services/market-data/fred-series.ts (verified or not), fetches the
// latest observations directly and reports whether the series ID actually
// resolves. For GBPUSD's dependency chain specifically (US + GB), also
// runs FRED's series-search endpoint against descriptive queries so a
// human can pick the correct ID for anything unconfigured or wrong —
// never guesses one automatically.
//
// Usage:
//   FRED_API_KEY=xxx npm run test:fred-verify
// or place FRED_API_KEY in .env.local and just run: npm run test:fred-verify
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { FRED_SERIES, FredIndicatorKey } from "../src/services/market-data/fred-series";
import { searchSeries } from "../src/services/market-data/fred";

const FRED_BASE = "https://api.stlouisfed.org/fred";

type RawObservations = { observations: { date: string; value: string }[] };

async function fredGetRaw<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.FRED_API_KEY!;
  const url = new URL(`${FRED_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

type SeriesCheck = {
  country: string;
  indicator: FredIndicatorKey;
  id: string;
  verifiedFlag: boolean;
  result: "OK" | "EMPTY" | "ERROR";
  latestDate: string;
  latestValue: string;
  error?: string;
};

async function checkSeries(country: string, indicator: FredIndicatorKey, id: string, verifiedFlag: boolean): Promise<SeriesCheck> {
  try {
    const data = await fredGetRaw<RawObservations>("/series/observations", { series_id: id, sort_order: "desc", limit: "5" });
    const nonMissing = data.observations.filter((o) => o.value !== ".");
    if (nonMissing.length === 0) {
      return { country, indicator, id, verifiedFlag, result: "EMPTY", latestDate: "n/a", latestValue: "n/a" };
    }
    return { country, indicator, id, verifiedFlag, result: "OK", latestDate: nonMissing[0].date, latestValue: nonMissing[0].value };
  } catch (err) {
    return { country, indicator, id, verifiedFlag, result: "ERROR", latestDate: "n/a", latestValue: "n/a", error: err instanceof Error ? err.message : String(err) };
  }
}

// Search for candidates for any country/indicator gap a live batch needs,
// rather than silently skipping it or guessing an ID.
const SEARCH_QUERIES: { country: string; indicator: FredIndicatorKey; query: string }[] = [
  { country: "GB", indicator: "realGdp", query: "United Kingdom Real GDP" },
  { country: "GB", indicator: "gdpGrowth", query: "United Kingdom GDP Growth Rate" },
  // AUDUSD batch: AU has no growth or policy-rate series configured at all.
  { country: "AU", indicator: "realGdp", query: "Australia Real GDP" },
  { country: "AU", indicator: "gdpGrowth", query: "Australia GDP Growth Rate" },
  { country: "AU", indicator: "policyRate", query: "Australia Interbank Rate" },
  // USDCAD batch: CA has no growth series configured (policyRate exists,
  // unverified — the main verification loop above already checks it live).
  { country: "CA", indicator: "realGdp", query: "Canada Real GDP" },
  { country: "CA", indicator: "gdpGrowth", query: "Canada GDP Growth Rate" },
  // NIKKEI225 batch: JP has cpi/unemploymentRate verified already, but no
  // growth or policy-rate series configured at all — needed for the full
  // 4-category primary local macro model (growth/inflation/labor/rates).
  { country: "JP", indicator: "realGdp", query: "Japan Real GDP" },
  { country: "JP", indicator: "gdpGrowth", query: "Japan GDP Growth Rate" },
  { country: "JP", indicator: "policyRate", query: "Japan Interbank Rate" },
  // USDCHF batch: CH has cpi/policyRate configured (unverified), but no
  // growth or labor series at all.
  { country: "CH", indicator: "realGdp", query: "Switzerland Real GDP" },
  { country: "CH", indicator: "gdpGrowth", query: "Switzerland GDP Growth Rate" },
  { country: "CH", indicator: "unemploymentRate", query: "Switzerland Unemployment Rate" },
  // NZDUSD batch: NZ has only cpi configured (unverified) — needs growth,
  // labor, and policy-rate series (RBNZ).
  { country: "NZ", indicator: "realGdp", query: "New Zealand Real GDP" },
  { country: "NZ", indicator: "gdpGrowth", query: "New Zealand GDP Growth Rate" },
  { country: "NZ", indicator: "unemploymentRate", query: "New Zealand Unemployment Rate" },
  { country: "NZ", indicator: "policyRate", query: "New Zealand Interbank Rate" },
  // EURGBP/EURJPY batch: EU has cpi/unemploymentRate/policyRate verified,
  // but no growth series at all — needed so EURGBP (EU vs GB) and EURJPY
  // (EU vs JP) get a genuine economicGrowth factor instead of one side
  // always reading unavailable.
  { country: "EU", indicator: "realGdp", query: "Euro Area Real GDP" },
  { country: "EU", indicator: "gdpGrowth", query: "Euro Area GDP Growth Rate" },
];

async function main() {
  if (!process.env.FRED_API_KEY) {
    console.error("FRED_API_KEY is not set. Set it in .env.local or the environment before running this script.");
    process.exit(1);
  }

  console.log("Verifying every FRED series currently configured in fred-series.ts...\n");

  const checks: SeriesCheck[] = [];
  for (const [country, series] of Object.entries(FRED_SERIES)) {
    for (const [indicator, meta] of Object.entries(series) as [FredIndicatorKey, { id: string; verified: boolean }][]) {
      process.stdout.write(`  ${country}/${indicator} (${meta.id})...`);
      const check = await checkSeries(country, indicator, meta.id, meta.verified);
      checks.push(check);
      console.log(` ${check.result}${check.result === "OK" ? ` — latest ${check.latestDate} = ${check.latestValue}` : ""}`);
    }
  }

  console.log("\n" + "=".repeat(100));
  console.log("Country".padEnd(10) + "Indicator".padEnd(22) + "Series ID".padEnd(24) + "verified:".padEnd(11) + "Live result");
  console.log("-".repeat(100));
  for (const c of checks) {
    console.log(c.country.padEnd(10) + c.indicator.padEnd(22) + c.id.padEnd(24) + String(c.verifiedFlag).padEnd(11) + c.result + (c.error ? ` (${c.error})` : ""));
  }

  const mismatches = checks.filter((c) => (c.result === "OK") !== c.verifiedFlag);
  console.log("\n" + "=".repeat(100));
  if (mismatches.length === 0) {
    console.log("Every configured series' verified:true/false flag matches its live result. No fred-series.ts changes needed.");
  } else {
    console.log(`${mismatches.length} series need fred-series.ts updated to match the live result:\n`);
    for (const m of mismatches) {
      if (m.result === "OK" && !m.verifiedFlag) {
        console.log(`  ${m.country}/${m.indicator} (${m.id}): resolves live and returns real data — SAFE to flip verified:true.`);
      } else {
        console.log(`  ${m.country}/${m.indicator} (${m.id}): marked verified:true but live result is ${m.result}${m.error ? ` (${m.error})` : ""} — flip to verified:false or fix the series ID.`);
      }
    }
  }

  console.log("\n" + "=".repeat(100));
  console.log("Searching for series that aren't configured yet...\n");
  for (const { country, indicator, query } of SEARCH_QUERIES) {
    const existing = FRED_SERIES[country]?.[indicator];
    if (existing) {
      console.log(`  ${country}/${indicator}: already configured as ${existing.id} (verified: ${existing.verified}) — skipping search.`);
      continue;
    }
    console.log(`  ${country}/${indicator}: not configured. Candidates for "${query}":`);
    try {
      const results = await searchSeries(query);
      for (const r of results.slice(0, 5)) {
        console.log(`    ${r.id.padEnd(20)} ${r.frequency.padEnd(14)} ${r.title}`);
      }
      if (results.length === 0) console.log("    (no results)");
    } catch (err) {
      console.log(`    search failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("\nPick the correct ID from the candidates above, confirm it on https://fred.stlouisfed.org, then add it to");
  console.log("FRED_SERIES.GB in src/services/market-data/fred-series.ts with verified: true. Never guess an ID from this list");
  console.log("without opening it on fred.stlouisfed.org first — title text alone can be ambiguous (e.g. nominal vs. real GDP).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
