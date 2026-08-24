// CFTC Commitments of Traders client — public, no API key required.
// The only place in the app allowed to call publicreporting.cftc.gov.
//
// VERIFY BEFORE LIVE: the CFTC publishes COT data through a Socrata-based
// open-data portal (publicreporting.cftc.gov), where each report type has
// its own dataset resource ID and the columns are auto-generated snake_case
// versions of the original spreadsheet headers (naming quirks — e.g.
// occasional double underscores — are common). The dataset IDs and column
// names below are this project's best-documented understanding but are NOT
// independently confirmed against a live response (this sandbox cannot
// reach cftc.gov — see DATASET_IDS comment). Before enabling CFTC in
// DATA_MODE=live: fetch one row for a known market from each dataset,
// log it, and correct DATASET_IDS / the field-candidate lists below against
// the real column names. Never ship a guessed field name silently — this
// client intentionally tries multiple name candidates and returns
// "unavailable" rather than a wrong number if none match.
import { getSymbolMapping, CftcReportType } from "./symbol-map";
import { errorResult, Provenance, unavailable } from "../types";
import { cached } from "./request-cache";

const CFTC_BASE = "https://publicreporting.cftc.gov/resource";
const SOURCE_LABEL: Record<CftcReportType, string> = {
  financial_futures: "CFTC Traders in Financial Futures",
  disaggregated: "CFTC Disaggregated COT",
  legacy: "CFTC Legacy COT",
};

// Socrata dataset resource IDs, "{id}.json" — VERIFY against
// https://publicreporting.cftc.gov before going live (see file header).
const DATASET_IDS: Record<CftcReportType, string> = {
  financial_futures: "gpe5-46if",
  disaggregated: "72hh-3qpy",
  legacy: "6dca-aqww",
};

type ClassificationFieldSet = {
  classification: string;
  longCandidates: string[];
  shortCandidates: string[];
};

// Per report type, the classifications this app scores (matches section 2 of
// the spec). Multiple field-name candidates per side to tolerate CFTC's
// column-naming quirks without silently reading the wrong (zero-valued) field.
const CLASSIFICATIONS: Record<CftcReportType, ClassificationFieldSet[]> = {
  financial_futures: [
    { classification: "Asset Manager", longCandidates: ["asset_mgr_positions_long", "asset_mgr_positions_long_all"], shortCandidates: ["asset_mgr_positions_short", "asset_mgr_positions_short_all"] },
    { classification: "Leveraged Funds", longCandidates: ["lev_money_positions_long", "lev_money_positions_long_all"], shortCandidates: ["lev_money_positions_short", "lev_money_positions_short_all"] },
    { classification: "Dealer", longCandidates: ["dealer_positions_long", "dealer_positions_long_all"], shortCandidates: ["dealer_positions_short", "dealer_positions_short_all"] },
    { classification: "Other Reportables", longCandidates: ["other_rept_positions_long", "other_rept_positions_long_all"], shortCandidates: ["other_rept_positions_short", "other_rept_positions_short_all"] },
  ],
  disaggregated: [
    { classification: "Managed Money", longCandidates: ["m_money_positions_long", "m_money_positions_long_all"], shortCandidates: ["m_money_positions_short", "m_money_positions_short_all"] },
    { classification: "Producer/Merchant", longCandidates: ["prod_merc_positions_long", "prod_merc_positions_long_all"], shortCandidates: ["prod_merc_positions_short", "prod_merc_positions_short_all"] },
    { classification: "Swap Dealer", longCandidates: ["swap_positions_long_all", "swap__positions_long_all"], shortCandidates: ["swap__positions_short_all", "swap_positions_short_all"] },
    { classification: "Other Reportables", longCandidates: ["other_rept_positions_long", "other_rept_positions_long_all"], shortCandidates: ["other_rept_positions_short", "other_rept_positions_short_all"] },
  ],
  legacy: [
    { classification: "Non-Commercial", longCandidates: ["noncomm_positions_long_all"], shortCandidates: ["noncomm_positions_short_all"] },
    { classification: "Commercial", longCandidates: ["comm_positions_long_all"], shortCandidates: ["comm_positions_short_all"] },
  ],
};

type CftcRow = Record<string, string | number | undefined>;

function pickNumericField(row: CftcRow, candidates: string[]): number | null {
  for (const key of candidates) {
    const v = row[key];
    if (v !== undefined && v !== null && v !== "") {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

// The one field name this client is most confident about (it's a stable,
// widely-documented Socrata column across every CFTC COT dataset) — still
// kept as a candidate list, not a bare string, because the $order clause
// below is not trusted blindly: see fetchReportRows.
const REPORT_DATE_CANDIDATES = ["report_date_as_yyyy_mm_dd", "report_date"];

function pickDateField(row: CftcRow): string | null {
  for (const key of REPORT_DATE_CANDIDATES) {
    const v = row[key];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return null;
}

async function fetchReportRows(reportType: CftcReportType, marketName: string, limit: number): Promise<CftcRow[]> {
  const url = new URL(`${CFTC_BASE}/${DATASET_IDS[reportType]}.json`);
  url.searchParams.set("$where", `market_and_exchange_names='${marketName.replace(/'/g, "''")}'`);
  url.searchParams.set("$order", "report_date_as_yyyy_mm_dd DESC");
  url.searchParams.set("$limit", String(limit));

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`CFTC request failed: ${res.status} ${res.statusText}`);
  const rows = (await res.json()) as CftcRow[];

  // Never trust the server-side $order alone: if the column name is
  // subtly wrong, or Socrata silently ignores an invalid sort clause, the
  // response can come back in an arbitrary (e.g. insertion) order — which
  // is exactly how a multi-year-old row ends up read as "the latest
  // report". Re-sort explicitly on the client by the actual parsed date.
  return [...rows].sort((a, b) => {
    const da = pickDateField(a);
    const db = pickDateField(b);
    if (!da && !db) return 0;
    if (!da) return 1; // rows with no readable date sort last
    if (!db) return -1;
    return new Date(db).getTime() - new Date(da).getTime(); // newest first
  });
}

// ---- Contract discovery ----
// symbol-map.ts's `reportName` used to be the exact, hand-guessed
// `market_and_exchange_names` string used directly in the data query — and
// that's exactly how a 4-year-old report ("2022-02-01" for GBP) got read as
// "current": CFTC occasionally changes the exact market/exchange string for
// a contract (exchange rebrand, product renumbering), which silently
// strands an old hardcoded string pointed at a name that stopped receiving
// new reports years ago. The freshness guard below already rejects reading
// that stale data as live — this section fixes the actual cause: instead of
// querying by the guessed exact string, query CFTC for every row whose name
// contains a much more stable anchor (the base commodity/currency name,
// e.g. "BRITISH POUND STERLING" — derived from the existing reportName by
// stripping its " - EXCHANGE" suffix, not a newly-guessed value), group by
// the exact market_and_exchange_names string, and resolve to whichever
// group's most recent report is actually the newest — i.e. the contract
// CFTC is currently publishing under. GBPUSD -> GBP futures contract ->
// exact CFTC contract identifier -> latest TFF report.
const DISCOVERY_TTL_MS = 24 * 60 * 60_000; // contract identifiers change rarely; re-discover about once/day

// Verified against a live query (see project history): CFTC renamed GBP
// futures' market_and_exchange_names from "BRITISH POUND STERLING -
// CHICAGO MERCANTILE EXCHANGE" (dead since 2022-02-01) to "BRITISH POUND -
// CHICAGO MERCANTILE EXCHANGE" (current, same cftc_contract_market_code
// 096742) at some point after that — the full pre-exchange-suffix name
// ("BRITISH POUND STERLING") is exactly the kind of string CFTC changes,
// while a shorter 1-2 word root ("BRITISH POUND") survived the rename
// unchanged. Anchoring on the first two words is deliberately looser than
// the full name for this reason, not a shortcut — a broader match still
// resolves correctly because discovery always picks the freshest group.
function searchAnchorFor(reportName: string): string {
  const base = reportName.split(" - ")[0].trim();
  return base.split(" ").slice(0, 2).join(" ");
}

export type CftcContractIdentifier = {
  marketAndExchangeName: string;
  cftcContractMarketCode: string | null;
  latestReportDate: string;
};

async function discoverCftcContract(reportType: CftcReportType, searchAnchor: string): Promise<CftcContractIdentifier | null> {
  return cached(`cftc:discover:${reportType}:${searchAnchor}`, DISCOVERY_TTL_MS, async () => {
    const url = new URL(`${CFTC_BASE}/${DATASET_IDS[reportType]}.json`);
    // Socrata SoQL: case-insensitive substring match, not an exact string —
    // the whole point is to find every current/former naming variant. Also
    // checked against commodity_name and contract_market_name, not just
    // market_and_exchange_names: verified live that CFTC's exchange-name
    // string is the one that gets cosmetically renamed, while
    // contract_market_name ("BRITISH POUND") stayed identical across the
    // 2022 rename — matching all three catches a rename in any of them.
    const escaped = searchAnchor.replace(/'/g, "''").replace(/%/g, "");
    const clause = ["market_and_exchange_names", "commodity_name", "contract_market_name"]
      .map((field) => `upper(${field}) like upper('%${escaped}%')`)
      .join(" OR ");
    url.searchParams.set("$where", clause);
    url.searchParams.set("$order", "report_date_as_yyyy_mm_dd DESC");
    url.searchParams.set("$limit", "1000");

    const res = await fetch(url.toString(), { next: { revalidate: 0 } });
    if (!res.ok) throw new Error(`CFTC discovery request failed: ${res.status} ${res.statusText}`);
    const rows = (await res.json()) as CftcRow[];
    if (rows.length === 0) return null;

    // Group by the exact market_and_exchange_names string and track each
    // group's most recent report date — never trust a single row or the
    // server's own ordering as "the" answer.
    const byName = new Map<string, { latestDate: string; contractCode: string | null }>();
    for (const row of rows) {
      const name = row["market_and_exchange_names"];
      if (typeof name !== "string") continue;
      const date = pickDateField(row);
      if (!date) continue;
      const existing = byName.get(name);
      if (!existing || new Date(date).getTime() > new Date(existing.latestDate).getTime()) {
        const codeRaw = row["cftc_contract_market_code"];
        byName.set(name, { latestDate: date, contractCode: codeRaw !== undefined && codeRaw !== null ? String(codeRaw) : null });
      }
    }

    let best: (CftcContractIdentifier & { name: string }) | null = null;
    for (const [name, info] of byName) {
      if (!best || new Date(info.latestDate).getTime() > new Date(best.latestReportDate).getTime()) {
        best = { name, marketAndExchangeName: name, cftcContractMarketCode: info.contractCode, latestReportDate: info.latestDate };
      }
    }
    return best;
  });
}

// CFTC publishes weekly on Friday. A report should never be more than
// ~10 days old under normal conditions; allow slack for holiday delays
// before calling it stale, and treat anything far older as a sign the
// query matched the wrong data entirely (wrong market-name string, wrong
// sort, wrong dataset) rather than a merely-delayed real report.
const FRESH_WINDOW_DAYS = 10;
// Exported so the storage-first fallback (last-known-good.ts) can apply the
// exact same ceiling to a *stored* report — "never use a report beyond the
// existing freshness limits" applies identically whether the report came
// from a live call or from Neon.
export const CFTC_STALE_WINDOW_DAYS = 45;

function classifyCftcFreshness(reportDateIso: string): "live" | "stale" | "invalid" {
  const ageDays = (Date.now() - new Date(reportDateIso).getTime()) / 86_400_000;
  if (ageDays < 0) return "invalid"; // a "future" report date is itself a sign something's wrong
  if (ageDays <= FRESH_WINDOW_DAYS) return "live";
  if (ageDays <= CFTC_STALE_WINDOW_DAYS) return "stale";
  return "invalid";
}

/** Whether a CFTC report of this age is still within the same ceiling the
 * live path itself enforces (`classifyCftcFreshness`'s "invalid" cutoff) —
 * used by the storage-first fallback to refuse a stored report that's aged
 * past usefulness, exactly as the live path would refuse to return one. */
export function isCftcReportWithinFreshnessLimit(reportDateIso: string): boolean {
  const ageDays = (Date.now() - new Date(reportDateIso).getTime()) / 86_400_000;
  return ageDays >= 0 && ageDays <= CFTC_STALE_WINDOW_DAYS;
}

function percentileOf(currentNet: number, history: number[]): number | null {
  if (history.length < 8) return null; // too little history for a meaningful percentile
  const sorted = [...history].sort((a, b) => a - b);
  const rank = sorted.findIndex((v) => v >= currentNet);
  return Math.round(((rank < 0 ? sorted.length - 1 : rank) / (sorted.length - 1)) * 100);
}

export type CftcPositioningResult = {
  classification: string;
  reportDate: string;
  longContracts: number;
  shortContracts: number;
  netPositioning: number;
  pctLong: number;
  pctShort: number;
  openInterest: number;
  netWeeklyChange: number;
  percentile1y: number | null;
  percentile3y: number | null;
  direction: "Bullish" | "Bearish" | "Neutral";
  strength: "Extreme" | "Strong" | "Moderate" | "Light";
  /** Newest-first weekly net-positioning history, for the Smart Money momentum engine. */
  netHistory: { reportDate: string; netPositioning: number }[];
  /** The contract identifier discoverCftcContract() resolved to, not a
   * hardcoded guess — surfaced so provenance/validation views can show
   * exactly which CFTC market/exchange string and contract code produced
   * this result. */
  marketAndExchangeName: string;
  cftcContractMarketCode: string | null;
};

export async function getInstitutionalPositioning(internalSymbol: string): Promise<Provenance<CftcPositioningResult>> {
  const mapping = getSymbolMapping(internalSymbol);
  if (!mapping?.cftc) {
    return unavailable("cftc", "CFTC Commitments of Traders", `${internalSymbol} has no CFTC-reportable futures contract`);
  }
  const { reportType, reportName } = mapping.cftc;
  const source = SOURCE_LABEL[reportType];
  // Primary classification per report type — the one section 2 leads with
  // (Asset Manager for financial futures, Managed Money for disaggregated).
  const primary = CLASSIFICATIONS[reportType][0];

  try {
    const searchAnchor = searchAnchorFor(reportName);
    const contract = await discoverCftcContract(reportType, searchAnchor);
    if (!contract) {
      return unavailable("cftc", source, `Contract discovery found no CFTC rows matching "${searchAnchor}" in dataset ${DATASET_IDS[reportType]} — the anchor or dataset ID likely needs updating`);
    }

    const rows = await fetchReportRows(reportType, contract.marketAndExchangeName, 160); // ~3 years of weekly reports
    if (rows.length === 0) return unavailable("cftc", source, `No CFTC rows found for discovered contract "${contract.marketAndExchangeName}"`);

    const netHistory = rows
      .map((row) => {
        const long = pickNumericField(row, primary.longCandidates);
        const short = pickNumericField(row, primary.shortCandidates);
        const reportDate = pickDateField(row) ?? "";
        return long !== null && short !== null ? { reportDate, netPositioning: long - short } : null;
      })
      .filter((v): v is { reportDate: string; netPositioning: number } => v !== null);
    const netSeries = netHistory.map((h) => h.netPositioning);

    if (netSeries.length === 0) {
      return unavailable("cftc", source, `Could not read ${primary.classification} long/short fields — column names likely need updating (see file header)`);
    }

    const latestRow = rows[0];
    const reportDate = pickDateField(latestRow);
    if (!reportDate) {
      return unavailable("cftc", source, "Could not read a report date from the latest CFTC row — column names likely need updating (see file header)");
    }

    const freshness = classifyCftcFreshness(new Date(reportDate).toISOString());
    if (freshness === "invalid") {
      const ageDays = Math.round((Date.now() - new Date(reportDate).getTime()) / 86_400_000);
      return unavailable(
        "cftc",
        source,
        `Latest matched CFTC report is from ${reportDate} (~${ageDays}d old) — rejected as too old to be the current week's report, even after contract discovery resolved to "${contract.marketAndExchangeName}". This means CFTC has genuinely not published a recent report under any name matching "${searchAnchor}", not a wrong mapping.`
      );
    }

    const longContracts = pickNumericField(latestRow, primary.longCandidates)!;
    const shortContracts = pickNumericField(latestRow, primary.shortCandidates)!;
    const netPositioning = longContracts - shortContracts;
    const openInterest = pickNumericField(latestRow, ["open_interest_all"]) ?? 0;

    const priorNet = netSeries[1] ?? netPositioning;
    const netWeeklyChange = netPositioning - priorNet;

    const totalSided = longContracts + shortContracts;
    const pctLong = totalSided > 0 ? (longContracts / totalSided) * 100 : 50;
    const pctShort = 100 - pctLong;

    const percentile1y = percentileOf(netPositioning, netSeries.slice(0, 52));
    const percentile3y = percentileOf(netPositioning, netSeries);

    const direction: CftcPositioningResult["direction"] = netPositioning > 0 ? "Bullish" : netPositioning < 0 ? "Bearish" : "Neutral";
    const pct = percentile3y ?? percentile1y;
    const strength: CftcPositioningResult["strength"] =
      pct === null ? "Moderate" : pct >= 90 || pct <= 10 ? "Extreme" : pct >= 75 || pct <= 25 ? "Strong" : pct >= 55 || pct <= 45 ? "Moderate" : "Light";

    const now = new Date().toISOString();
    return {
      provider: "cftc",
      source,
      status: freshness, // "live" or "stale" — "invalid" already returned above
      fetchedAt: now,
      sourceUpdatedAt: new Date(reportDate).toISOString(),
      nextExpectedUpdate: nextFridayISO(),
      value: {
        classification: primary.classification,
        reportDate: new Date(reportDate).toISOString(),
        longContracts,
        shortContracts,
        netPositioning,
        pctLong,
        pctShort,
        openInterest,
        netWeeklyChange,
        percentile1y,
        percentile3y,
        direction,
        strength,
        netHistory,
        marketAndExchangeName: contract.marketAndExchangeName,
        cftcContractMarketCode: contract.cftcContractMarketCode,
      },
      raw: latestRow,
    };
  } catch (err) {
    return errorResult("cftc", source, err instanceof Error ? err.message : String(err));
  }
}

// CFTC publishes the COT report weekly on Friday (data as of the prior
// Tuesday), so the next update is always the coming Friday.
function nextFridayISO(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const daysUntilFriday = ((5 - day) % 7) || 7;
  const next = new Date(now);
  next.setUTCDate(now.getUTCDate() + daysUntilFriday);
  next.setUTCHours(20, 30, 0, 0); // CFTC typically publishes ~3:30pm ET
  return next.toISOString();
}
