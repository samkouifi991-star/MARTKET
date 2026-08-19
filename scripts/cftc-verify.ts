// Automated CFTC Commitments of Traders verification — CFTC's dataset is
// public (no API key), but publicreporting.cftc.gov is unreachable from
// this sandbox, so the dataset resource IDs and column names in
// src/services/market-data/cftc.ts are this project's best-documented
// guess, not a confirmed live response. Run this from an environment with
// real internet access before letting CFTC contribute to any live score.
//
// For every instrument with a CFTC mapping in symbol-map.ts: confirms the
// configured reportName actually matches a row in the dataset (a wrong
// name silently returns zero rows), prints the raw column names of that
// row so they can be compared against cftc.ts's FIELD_CANDIDATES lists,
// and runs the app's real getInstitutionalPositioning() client so its
// parsed output (classification, longContracts, shortContracts,
// netPositioning, netWeeklyChange, percentile) can be eyeballed for
// correctness. GBPUSD is checked first and in the most detail since it's
// the live reference market.
//
// Usage: npm run test:cftc-verify
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { INSTRUMENTS } from "../src/lib/instruments";
import { getSymbolMapping, CftcReportType } from "../src/services/market-data/symbol-map";
import * as cftc from "../src/services/market-data/cftc";

const CFTC_BASE = "https://publicreporting.cftc.gov/resource";
// Mirrors the DATASET_IDS in cftc.ts — kept independent here so this script
// still tells you if the app's constant has drifted from what's live.
const DATASET_IDS: Record<CftcReportType, string> = {
  financial_futures: "gpe5-46if",
  disaggregated: "72hh-3qpy",
  legacy: "6dca-aqww",
};

type RawRow = Record<string, string | number | undefined>;

async function fetchRawRows(reportType: CftcReportType, marketName: string, limit = 3): Promise<RawRow[]> {
  const url = new URL(`${CFTC_BASE}/${DATASET_IDS[reportType]}.json`);
  url.searchParams.set("$where", `market_and_exchange_names='${marketName.replace(/'/g, "''")}'`);
  url.searchParams.set("$order", "report_date_as_yyyy_mm_dd DESC");
  url.searchParams.set("$limit", String(limit));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as RawRow[];
}

async function verifyMarket(symbol: string, detailed: boolean): Promise<{ symbol: string; ok: boolean; note: string }> {
  const mapping = getSymbolMapping(symbol);
  if (!mapping?.cftc) return { symbol, ok: true, note: "no CFTC coverage expected (skipped)" };
  const { reportType, reportName } = mapping.cftc;

  let rows: RawRow[];
  try {
    rows = await fetchRawRows(reportType, reportName, detailed ? 20 : 3);
  } catch (err) {
    return { symbol, ok: false, note: `request failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (rows.length === 0) {
    return { symbol, ok: false, note: `"${reportName}" returned 0 rows from dataset ${DATASET_IDS[reportType]} — market name is wrong, fix reportName in symbol-map.ts` };
  }

  if (detailed) {
    console.log(`\n  Raw columns present on the latest ${symbol} row (dataset ${DATASET_IDS[reportType]}, "${reportName}"):`);
    console.log(
      "    " +
        Object.keys(rows[0])
          .sort()
          .join(", ")
    );

    // Diagnoses the exact "1648 days old" symptom: if the server's own
    // $order DESC actually worked, rows[0]'s date should be the newest and
    // the age-of-newest-row should be small. If the newest row found here
    // is still ancient, or the batch's date range spans years, the
    // reportName is almost certainly matching a stale/renamed market
    // string rather than the sort clause being broken.
    const dates = rows
      .map((r) => String(r["report_date_as_yyyy_mm_dd"] ?? r["report_date"] ?? ""))
      .filter(Boolean)
      .map((d) => new Date(d));
    if (dates.length > 0) {
      const newest = new Date(Math.max(...dates.map((d) => d.getTime())));
      const oldest = new Date(Math.min(...dates.map((d) => d.getTime())));
      const ageDaysOfNewest = Math.round((Date.now() - newest.getTime()) / 86_400_000);
      console.log(`\n  Date range across the ${rows.length} rows fetched: ${oldest.toISOString().slice(0, 10)} to ${newest.toISOString().slice(0, 10)}`);
      console.log(`  Newest row is ~${ageDaysOfNewest}d old.${ageDaysOfNewest > 10 ? " EXPECTED <= ~10d for a live weekly report — investigate reportName / dataset before trusting this market." : " Looks like a normal weekly-fresh report."}`);
      if (String(rows[0]["report_date_as_yyyy_mm_dd"] ?? rows[0]["report_date"] ?? "") !== newest.toISOString().slice(0, 10) && rows[0] !== undefined) {
        console.log("  NOTE: the server's own $order DESC did NOT return the newest row first — the app's client-side re-sort (see cftc.ts) is compensating for this.");
      }
    }

    console.log(`\n  Running the app's real getInstitutionalPositioning("${symbol}") against this same data:`);
    const parsed = await cftc.getInstitutionalPositioning(symbol);
    if (parsed.value) {
      const v = parsed.value;
      console.log(`    status=${parsed.status} classification=${v.classification} reportDate=${v.reportDate}`);
      console.log(`    long=${v.longContracts} short=${v.shortContracts} net=${v.netPositioning} netWeeklyChange=${v.netWeeklyChange}`);
      console.log(`    pctLong=${v.pctLong.toFixed(1)} pctShort=${v.pctShort.toFixed(1)} openInterest=${v.openInterest}`);
      console.log(`    percentile1y=${v.percentile1y} percentile3y=${v.percentile3y} direction=${v.direction} strength=${v.strength}`);
      console.log("    -> Compare long/short/net above against the raw row's own numbers before trusting this for scoring.");
    } else if (parsed.status === "unavailable" && /too old/i.test(parsed.error ?? "")) {
      console.log(`    getInstitutionalPositioning rejected the matched report as too old: ${parsed.error}`);
      console.log("    -> Fields parsed fine; the freshness gate is doing its job. Fix the reportName/dataset match above so it finds a current report.");
    } else {
      console.log(`    getInstitutionalPositioning FAILED to parse this row: status=${parsed.status} error=${parsed.error ?? "(none)"}`);
      console.log("    -> The dataset/market name resolved, but FIELD_CANDIDATES in cftc.ts could not read the long/short columns.");
      console.log("       Compare the raw column list above against FIELD_CANDIDATES and add the real names.");
    }
  }

  return { symbol, ok: true, note: `"${reportName}" resolved, ${rows.length} row(s) returned` };
}

async function main() {
  console.log("Verifying CFTC market-name mappings for every instrument with COT coverage...\n");

  console.log("=".repeat(100));
  console.log("GBPUSD (live reference market) — detailed check:");
  console.log("=".repeat(100));
  const gbpusd = await verifyMarket("GBPUSD", true);
  console.log(`\n  Result: ${gbpusd.ok ? "OK" : "FAILED"} — ${gbpusd.note}`);

  console.log("\n" + "=".repeat(100));
  console.log("All other markets — name-resolution check only:");
  console.log("=".repeat(100));
  const results = [gbpusd];
  for (const instrument of INSTRUMENTS) {
    if (instrument.symbol === "GBPUSD") continue;
    process.stdout.write(`  ${instrument.symbol}...`);
    const result = await verifyMarket(instrument.symbol, false);
    results.push(result);
    console.log(` ${result.ok ? "OK" : "FAILED"} — ${result.note}`);
  }

  const failed = results.filter((r) => !r.ok);
  const wrongName = failed.filter((r) => r.note.includes("0 rows"));
  const requestFailed = failed.filter((r) => r.note.includes("request failed"));
  console.log("\n" + "=".repeat(100));
  if (failed.length === 0) {
    console.log("Every configured CFTC reportName resolved to real rows.");
  } else {
    if (requestFailed.length > 0) {
      console.log(`${requestFailed.length} market(s) could not be reached at all (network/CFTC-availability issue, not a mapping problem) — re-run this script:\n`);
      for (const f of requestFailed) console.log(`  ${f.symbol}: ${f.note}`);
      console.log("");
    }
    if (wrongName.length > 0) {
      console.log(`${wrongName.length} market(s) have a CFTC reportName that needs fixing in symbol-map.ts (resolved but returned 0 rows):\n`);
      for (const f of wrongName) console.log(`  ${f.symbol}: ${f.note}`);
    }
  }
  console.log("\nDo not let CFTC contribute to any market's score until its FIELD_CANDIDATES parse correctly above (see the");
  console.log("GBPUSD detailed section) — a resolved market name with unparseable columns is still not safe to score from.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
