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
//
// Session handling: no cross-invocation caching. Myfxbook sessions appear
// to be tied to the calling IP (undocumented), and Vercel serverless
// invocations don't share memory or a stable outbound IP reliably — a
// session cached from one invocation is routinely rejected by the next
// ("Invalid session"), which is exactly the failure mode this was rewritten
// to fix. Every call logs in, then immediately uses that session in the
// same execution; nothing is persisted between calls. A rejected session
// (rare but possible even within one execution, e.g. a race on Myfxbook's
// side) is retried once with a second fresh login before giving up.
import { getSymbolMapping } from "../symbol-map";
import { errorResult, Provenance, unavailable } from "../../types";
import { NormalizedRetailSentiment, RetailSentimentProvider } from "./types";

const MYFXBOOK_BASE = "https://www.myfxbook.com/api";
const SOURCE = "Myfxbook Community Outlook";

function credentialsConfigured(): boolean {
  return Boolean(process.env.MYFXBOOK_EMAIL && process.env.MYFXBOOK_PASSWORD);
}

/** Self-generated per-call ID (not Vercel's internal trace ID, which isn't
 * reliably available inside process.env at the point this runs) purely to
 * let log lines from the same login->outlook call be correlated with each
 * other when reading raw logs — nothing sensitive, never the credentials or
 * session itself. */
function newExecutionId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Safe-only diagnostic line: region + execution id + booleans, never a
 * credential or session value. */
function logDiagnostic(executionId: string, step: string, detail: Record<string, string | boolean | undefined>): void {
  const region = process.env.VERCEL_REGION ?? "unknown";
  const parts = Object.entries(detail)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`[myfxbook exec=${executionId} region=${region}] ${step} ${parts}`);
}

/** Thrown when a freshly-issued session (login succeeded, session
 * returned) is still rejected by Community Outlook within the same
 * execution as its own login — twice, ruling out a one-off transient
 * blip. Not a credentials problem (login succeeded) and not the
 * cross-invocation session-reuse bug this client was already rewritten to
 * avoid — a structural incompatibility between Myfxbook's session model
 * and this deployment architecture. */
class MyfxbookSessionIncompatibleError extends Error {}

// URLSearchParams.set() already percent-encodes the value it's given
// (spaces, @, +, etc. in an email/password all come out correctly encoded
// in the resulting query string) — this is not something to hand-roll.
async function login(): Promise<string> {
  const url = new URL(`${MYFXBOOK_BASE}/login.json`);
  url.searchParams.set("email", process.env.MYFXBOOK_EMAIL!);
  url.searchParams.set("password", process.env.MYFXBOOK_PASSWORD!);

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`Myfxbook login failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { error: boolean; message?: string; session?: string };
  if (data.error || !data.session) throw new Error(`Myfxbook login rejected: ${data.message ?? "no session returned"}`);
  return data.session;
}

function isInvalidSessionError(message: string): boolean {
  return /invalid session|session.*(expired|invalid)|not logged in/i.test(message);
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

function pickString(row: OutlookRow, candidates: string[]): string | undefined {
  for (const key of candidates) {
    const v = row[key];
    if (typeof v === "string") return v;
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

type OutlookResponse = { error: boolean; message?: string; symbols?: OutlookRow[] };

async function fetchOutlookOnce(session: string): Promise<OutlookResponse> {
  const url = new URL(`${MYFXBOOK_BASE}/get-community-outlook.json`);
  url.searchParams.set("session", session);

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`Myfxbook community outlook request failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as OutlookResponse;
}

/** Logs in and immediately fetches the outlook within this same call —
 * login and outlook are never split across separate invocations. If the
 * session Myfxbook just issued is itself rejected, logs in again once
 * (fresh credentials each time, never reusing a session) before giving up.
 * If Community Outlook rejects a brand-new session twice in a row — both
 * within this same execution — that's classified as a structural
 * incompatibility (MyfxbookSessionIncompatibleError), not a transient error
 * to keep retrying. */
async function loginAndFetchOutlook(): Promise<OutlookRow[]> {
  const executionId = newExecutionId();

  const session = await login();
  logDiagnostic(executionId, "login", { loginSuccessful: true, sessionReceived: Boolean(session) });

  let data = await fetchOutlookOnce(session);
  logDiagnostic(executionId, "community_outlook_attempt_1", { accepted: !data.error, rejectedReason: data.error ? data.message ?? "unknown" : undefined });

  if (data.error && isInvalidSessionError(data.message ?? "")) {
    const retrySession = await login();
    logDiagnostic(executionId, "login_retry", { loginSuccessful: true, sessionReceived: Boolean(retrySession) });

    data = await fetchOutlookOnce(retrySession);
    logDiagnostic(executionId, "community_outlook_attempt_2", { accepted: !data.error, rejectedReason: data.error ? data.message ?? "unknown" : undefined });

    if (data.error && isInvalidSessionError(data.message ?? "")) {
      logDiagnostic(executionId, "classified", { result: "incompatible" });
      throw new MyfxbookSessionIncompatibleError(data.message ?? "session rejected immediately after issuance, twice, in the same execution");
    }
  }

  if (data.error) throw new Error(`Myfxbook community outlook rejected: ${data.message ?? "unknown error"}`);
  logDiagnostic(executionId, "classified", { result: "success" });
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
    const symbols = await loginAndFetchOutlook();
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
    if (err instanceof MyfxbookSessionIncompatibleError) {
      return unavailable(
        "myfxbook",
        SOURCE,
        `Myfxbook rejected a freshly-issued session within the same execution as its own login (${err.message}) — not a credentials problem, a structural incompatibility between Myfxbook's session model and this serverless architecture. Treating Myfxbook as unavailable rather than retrying further; IG is already wired as a secondary retail-sentiment provider.`
      );
    }
    return errorResult("myfxbook", SOURCE, err instanceof Error ? err.message : String(err));
  }
}

export type MyfxbookDiagnostic = {
  loginSuccessful: boolean;
  sessionReceived: boolean;
  communityOutlookSuccessful: boolean;
  symbolFound: boolean;
  error?: string; // never the password or the session value itself
};

/** Step-by-step connection diagnostic for the admin validation page — tells
 * you exactly which stage fails (login vs. session vs. outlook vs. symbol
 * lookup) instead of a single opaque "unavailable". Never returns the
 * password or session token, even inside `error`. */
export async function diagnoseMyfxbookConnection(symbol: string): Promise<MyfxbookDiagnostic> {
  const executionId = newExecutionId();

  if (!credentialsConfigured()) {
    logDiagnostic(executionId, "precheck", { credentialsConfigured: false });
    return { loginSuccessful: false, sessionReceived: false, communityOutlookSuccessful: false, symbolFound: false, error: "MYFXBOOK_EMAIL / MYFXBOOK_PASSWORD not configured" };
  }

  let session: string;
  try {
    session = await login();
  } catch (err) {
    logDiagnostic(executionId, "login", { loginSuccessful: false });
    return { loginSuccessful: false, sessionReceived: false, communityOutlookSuccessful: false, symbolFound: false, error: err instanceof Error ? err.message : String(err) };
  }
  const sessionReceived = Boolean(session);
  logDiagnostic(executionId, "login", { loginSuccessful: true, sessionReceived });

  // Community Outlook is called immediately, in this same execution, using
  // the session that was just issued above — never a session persisted
  // from, or reused across, a separate invocation.
  try {
    const outlook = await fetchOutlookOnce(session);
    logDiagnostic(executionId, "community_outlook", { accepted: !outlook.error, rejectedReason: outlook.error ? outlook.message ?? "unknown" : undefined });

    if (outlook.error) {
      return { loginSuccessful: true, sessionReceived, communityOutlookSuccessful: false, symbolFound: false, error: outlook.message ?? "community outlook rejected" };
    }
    const mapping = getSymbolMapping(symbol);
    const targetName = mapping?.myfxbookSymbol ?? symbol;
    const row = (outlook.symbols ?? []).find((s) => pickString(s, FIELD_CANDIDATES.name)?.toUpperCase() === targetName.toUpperCase());
    logDiagnostic(executionId, "symbol_lookup", { symbolFound: Boolean(row) });
    return { loginSuccessful: true, sessionReceived, communityOutlookSuccessful: true, symbolFound: Boolean(row) };
  } catch (err) {
    logDiagnostic(executionId, "community_outlook", { accepted: false, rejectedReason: err instanceof Error ? err.message : String(err) });
    return { loginSuccessful: true, sessionReceived, communityOutlookSuccessful: false, symbolFound: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const myfxbookProvider: RetailSentimentProvider = {
  name: "myfxbook",
  sourceLabel: SOURCE,
  getRetailSentiment,
};
