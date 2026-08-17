// Myfxbook Community Outlook — primary MVP retail-sentiment source. Public
// API, but still requires a Myfxbook account (MYFXBOOK_EMAIL / MYFXBOOK_PASSWORD)
// to obtain a session token; there is no anonymous access.
//
// VERIFY BEFORE LIVE: this sandbox cannot reach myfxbook.com, so the
// request/response shapes below are this project's best-documented
// understanding of Myfxbook's public API (myfxbook.com/api), not an
// independently confirmed live response. Before trusting this for GBPUSD:
// call login.json once, log the raw get-community-outlook.json response for
// GBPUSD, and confirm the field names in FIELD_CANDIDATES below match —
// correct them if Myfxbook's actual field names differ. This client
// deliberately tries multiple field-name candidates and returns
// "unavailable"/"error" rather than a silently-wrong percentage if none match.
import { getSymbolMapping } from "../symbol-map";
import { errorResult, Provenance, unavailable } from "../../types";
import { NormalizedRetailSentiment, RetailSentimentProvider } from "./types";

const MYFXBOOK_BASE = "https://www.myfxbook.com/api";
const SOURCE = "Myfxbook Community Outlook";

type MyfxbookSession = { session: string; expiresAt: number };
let cachedSession: MyfxbookSession | null = null;

function credentialsConfigured(): boolean {
  return Boolean(process.env.MYFXBOOK_EMAIL && process.env.MYFXBOOK_PASSWORD);
}

async function login(): Promise<string> {
  if (cachedSession && cachedSession.expiresAt > Date.now()) return cachedSession.session;

  const url = new URL(`${MYFXBOOK_BASE}/login.json`);
  url.searchParams.set("email", process.env.MYFXBOOK_EMAIL!);
  url.searchParams.set("password", process.env.MYFXBOOK_PASSWORD!);

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`Myfxbook login failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { error: boolean; message?: string; session?: string };
  if (data.error || !data.session) throw new Error(`Myfxbook login rejected: ${data.message ?? "no session returned"}`);

  // Myfxbook doesn't document an explicit session TTL; re-login every 30
  // minutes rather than assume a lifetime that hasn't been confirmed.
  cachedSession = { session: data.session, expiresAt: Date.now() + 30 * 60_000 };
  return cachedSession.session;
}

type OutlookRow = Record<string, number | string | undefined>;

function pickNumber(row: OutlookRow, candidates: string[]): number | undefined {
  for (const key of candidates) {
    const v = row[key];
    if (v !== undefined && v !== null && v !== "") {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return undefined;
}

const FIELD_CANDIDATES = {
  name: ["name", "symbol"],
  longPct: ["longPercentage", "buyPercentage", "long_percentage"],
  shortPct: ["shortPercentage", "sellPercentage", "short_percentage"],
  longPositions: ["longPositions", "long_positions"],
  shortPositions: ["shortPositions", "short_positions"],
  longVolume: ["longVolume", "long_volume"],
  shortVolume: ["shortVolume", "short_volume"],
  avgLongPrice: ["averageOpenPriceOfLongs", "avgLongPrice", "average_open_price_of_longs"],
  avgShortPrice: ["averageOpenPriceOfShorts", "avgShortPrice", "average_open_price_of_shorts"],
};

async function fetchOutlook(): Promise<OutlookRow[]> {
  const session = await login();
  const url = new URL(`${MYFXBOOK_BASE}/get-community-outlook.json`);
  url.searchParams.set("session", session);

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`Myfxbook community outlook request failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { error: boolean; message?: string; symbols?: OutlookRow[] };
  if (data.error) throw new Error(`Myfxbook community outlook rejected: ${data.message ?? "unknown error"}`);
  return data.symbols ?? [];
}

async function getRetailSentiment(internalSymbol: string): Promise<Provenance<NormalizedRetailSentiment>> {
  const mapping = getSymbolMapping(internalSymbol);
  if (!mapping?.myfxbookSymbol) {
    return unavailable("myfxbook", SOURCE, `Myfxbook does not cover ${internalSymbol}`);
  }
  if (!credentialsConfigured()) {
    return unavailable("myfxbook", SOURCE, "MYFXBOOK_EMAIL / MYFXBOOK_PASSWORD not configured");
  }

  try {
    const symbols = await fetchOutlook();
    const row = symbols.find((s) => {
      const name = pickString(s, FIELD_CANDIDATES.name);
      return name?.toUpperCase() === mapping.myfxbookSymbol!.toUpperCase();
    });
    if (!row) return unavailable("myfxbook", SOURCE, `${mapping.myfxbookSymbol} not present in Myfxbook's community outlook response`);

    const longPct = pickNumber(row, FIELD_CANDIDATES.longPct);
    const shortPct = pickNumber(row, FIELD_CANDIDATES.shortPct);
    if (longPct === undefined || shortPct === undefined) {
      return unavailable("myfxbook", SOURCE, "Could not read long/short percentage fields — column names likely need updating (see file header)");
    }

    const now = new Date().toISOString();
    return {
      provider: "myfxbook",
      source: SOURCE,
      status: "live",
      fetchedAt: now,
      sourceUpdatedAt: now, // Myfxbook's outlook endpoint does not return a per-symbol timestamp
      nextExpectedUpdate: null,
      value: {
        symbol: internalSymbol,
        pctLong: longPct,
        pctShort: shortPct,
        longPositions: pickNumber(row, FIELD_CANDIDATES.longPositions),
        shortPositions: pickNumber(row, FIELD_CANDIDATES.shortPositions),
        longVolume: pickNumber(row, FIELD_CANDIDATES.longVolume),
        shortVolume: pickNumber(row, FIELD_CANDIDATES.shortVolume),
        avgLongPrice: pickNumber(row, FIELD_CANDIDATES.avgLongPrice),
        avgShortPrice: pickNumber(row, FIELD_CANDIDATES.avgShortPrice),
      },
      raw: row,
    };
  } catch (err) {
    return errorResult("myfxbook", SOURCE, err instanceof Error ? err.message : String(err));
  }
}

function pickString(row: OutlookRow, candidates: string[]): string | undefined {
  for (const key of candidates) {
    const v = row[key];
    if (typeof v === "string") return v;
  }
  return undefined;
}

export const myfxbookProvider: RetailSentimentProvider = {
  name: "myfxbook",
  sourceLabel: SOURCE,
  getRetailSentiment,
};
