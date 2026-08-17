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

async function fetchReportRows(reportType: CftcReportType, marketName: string, limit: number): Promise<CftcRow[]> {
  const url = new URL(`${CFTC_BASE}/${DATASET_IDS[reportType]}.json`);
  url.searchParams.set("$where", `market_and_exchange_names='${marketName.replace(/'/g, "''")}'`);
  url.searchParams.set("$order", "report_date_as_yyyy_mm_dd DESC");
  url.searchParams.set("$limit", String(limit));

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`CFTC request failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as CftcRow[];
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
    const rows = await fetchReportRows(reportType, reportName, 160); // ~3 years of weekly reports
    if (rows.length === 0) return unavailable("cftc", source, `No CFTC rows found for "${reportName}" — confirm exact market name / dataset ID`);

    const netHistory = rows
      .map((row) => {
        const long = pickNumericField(row, primary.longCandidates);
        const short = pickNumericField(row, primary.shortCandidates);
        const reportDate = String(row["report_date_as_yyyy_mm_dd"] ?? row["report_date"] ?? "");
        return long !== null && short !== null ? { reportDate, netPositioning: long - short } : null;
      })
      .filter((v): v is { reportDate: string; netPositioning: number } => v !== null);
    const netSeries = netHistory.map((h) => h.netPositioning);

    if (netSeries.length === 0) {
      return unavailable("cftc", source, `Could not read ${primary.classification} long/short fields — column names likely need updating (see file header)`);
    }

    const latestRow = rows[0];
    const longContracts = pickNumericField(latestRow, primary.longCandidates)!;
    const shortContracts = pickNumericField(latestRow, primary.shortCandidates)!;
    const netPositioning = longContracts - shortContracts;
    const openInterest = pickNumericField(latestRow, ["open_interest_all"]) ?? 0;
    const reportDate = String(latestRow["report_date_as_yyyy_mm_dd"] ?? latestRow["report_date"] ?? "");

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
      status: "live",
      fetchedAt: now,
      sourceUpdatedAt: reportDate ? new Date(reportDate).toISOString() : now,
      nextExpectedUpdate: nextFridayISO(),
      value: {
        classification: primary.classification,
        reportDate: reportDate ? new Date(reportDate).toISOString() : now,
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
