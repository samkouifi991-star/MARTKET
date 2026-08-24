// Capital.com Client Sentiment — candidate secondary retail-sentiment
// source. The only place in the app allowed to call Capital.com's trading
// API (api-capital.backend-capital.com / demo-api-capital.backend-capital.com).
//
// NOT YET WIRED INTO PRODUCTION SCORING. getRetailSentiment() below is a
// complete client, but every SymbolMapping.capitalComMarketId in
// symbol-map.ts is still null — the same "never guess a provider
// identifier" discipline this project already applies to IG's epic (see
// ig.ts) and OANDA's instrument names. Until a real session's
// GET /api/v1/markets?searchTerm= response confirms the right marketId for
// a symbol (see scripts/capital-com-retail-sentiment-verify.ts), this
// always returns "unavailable", which is correct — never estimate or
// substitute a percentage when the mapping hasn't been confirmed.
//
// VERIFY BEFORE LIVE: this sandbox's outbound network policy blocks
// api-capital.backend-capital.com, so the request/response shapes below are
// this project's best-documented understanding of Capital.com's public REST
// API (open-api.capital.com), not an independently confirmed live response —
// the same caveat this project already applied to oanda.ts/myfxbook.ts
// before their own live verification. In particular, confirm the
// clientsentiment response really uses `longPositionPercentage` /
// `shortPositionPercentage` (matching Capital.com's documented example) —
// correct them if a live response's field names differ.
import { getSymbolMapping } from "./symbol-map";
import { errorResult, Provenance, unavailable } from "../types";

const SOURCE = "Capital.com Client Sentiment";

function baseUrl(): string {
  return process.env.CAPITAL_COM_ENVIRONMENT === "live" ? "https://api-capital.backend-capital.com" : "https://demo-api-capital.backend-capital.com";
}

function credentialsConfigured(): boolean {
  return Boolean(process.env.CAPITAL_COM_API_KEY && process.env.CAPITAL_COM_IDENTIFIER && process.env.CAPITAL_COM_PASSWORD);
}

type CapitalSession = { cst: string; securityToken: string; expiresAt: number };
let cachedSession: CapitalSession | null = null;

// Capital.com's documented session behavior is "expires after 10 minutes of
// inactivity" — cached conservatively at 9 minutes (mirrors ig.ts's same
// margin-below-documented-lifetime pattern) so a call never rides the edge
// of expiry.
async function login(): Promise<CapitalSession> {
  if (cachedSession && cachedSession.expiresAt > Date.now()) return cachedSession;

  const res = await fetch(`${baseUrl()}/api/v1/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-CAP-API-KEY": process.env.CAPITAL_COM_API_KEY!,
    },
    body: JSON.stringify({ identifier: process.env.CAPITAL_COM_IDENTIFIER, password: process.env.CAPITAL_COM_PASSWORD }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Capital.com login failed: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ""}`);
  }

  const cst = res.headers.get("CST");
  const securityToken = res.headers.get("X-SECURITY-TOKEN");
  if (!cst || !securityToken) throw new Error("Capital.com login response missing CST/X-SECURITY-TOKEN session headers");

  cachedSession = { cst, securityToken, expiresAt: Date.now() + 9 * 60_000 };
  return cachedSession;
}

function authHeaders(session: CapitalSession): Record<string, string> {
  return {
    Accept: "application/json",
    "X-CAP-API-KEY": process.env.CAPITAL_COM_API_KEY!,
    CST: session.cst,
    "X-SECURITY-TOKEN": session.securityToken,
  };
}

async function parseJsonBody(res: Response): Promise<unknown> {
  const bodyText = await res.text().catch(() => "");
  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}

export type CapitalMarketSearchResult = { ok: boolean; status: number; markets: Array<Record<string, unknown>>; raw: unknown };

/** GET /api/v1/markets?searchTerm= — used only by the verification script
 * (scripts/capital-com-retail-sentiment-verify.ts) to discover the real
 * marketId for a symbol before it is ever hand-entered into symbol-map.ts.
 * Not called by getRetailSentiment below. */
export async function searchMarkets(searchTerm: string): Promise<CapitalMarketSearchResult> {
  const session = await login();
  const url = new URL(`${baseUrl()}/api/v1/markets`);
  url.searchParams.set("searchTerm", searchTerm);
  const res = await fetch(url.toString(), { headers: authHeaders(session) });
  const raw = await parseJsonBody(res);
  const markets = res.ok && raw && typeof raw === "object" && Array.isArray((raw as { markets?: unknown }).markets) ? (raw as { markets: Array<Record<string, unknown>> }).markets : [];
  return { ok: res.ok, status: res.status, markets, raw };
}

export type CapitalClientSentimentResult = { ok: boolean; status: number; raw: unknown };

/** GET /api/v1/clientsentiment/{marketId} — the single call both
 * getRetailSentiment() below and the verification script use. Returns the
 * raw response untouched (status + body) so the verification script can
 * report exactly what Capital.com sent back, without this function's own
 * normalization guesses hiding a shape mismatch. */
export async function fetchClientSentiment(marketId: string): Promise<CapitalClientSentimentResult> {
  const session = await login();
  const res = await fetch(`${baseUrl()}/api/v1/clientsentiment/${encodeURIComponent(marketId)}`, {
    headers: authHeaders(session),
    next: { revalidate: 0 },
  });
  const raw = await parseJsonBody(res);
  return { ok: res.ok, status: res.status, raw };
}

export type CapitalClientSentiment = {
  marketId: string;
  pctLong: number;
  pctShort: number;
};

type CapitalSentimentPayload = { marketId?: string; longPositionPercentage?: number; shortPositionPercentage?: number };

export async function getRetailSentiment(internalSymbol: string): Promise<Provenance<CapitalClientSentiment>> {
  const mapping = getSymbolMapping(internalSymbol);
  if (!mapping?.capitalComMarketId) {
    return unavailable("capital-com", SOURCE, `No confirmed Capital.com marketId for ${internalSymbol} — see scripts/capital-com-retail-sentiment-verify.ts`);
  }
  if (!credentialsConfigured()) {
    return unavailable("capital-com", SOURCE, "CAPITAL_COM_API_KEY / CAPITAL_COM_IDENTIFIER / CAPITAL_COM_PASSWORD not configured");
  }

  try {
    const { ok, status, raw } = await fetchClientSentiment(mapping.capitalComMarketId);
    if (!ok) {
      throw new Error(`Capital.com client sentiment request failed: ${status}${typeof raw === "string" ? ` — ${raw.slice(0, 300)}` : ""}`);
    }

    const data = raw as CapitalSentimentPayload;
    if (typeof data.longPositionPercentage !== "number" || typeof data.shortPositionPercentage !== "number") {
      return unavailable("capital-com", SOURCE, `Capital.com returned no usable longPositionPercentage/shortPositionPercentage for ${mapping.capitalComMarketId} — response shape may not match what this client expects (see file header)`);
    }

    const now = new Date().toISOString();
    return {
      provider: "capital-com",
      source: SOURCE,
      status: "live",
      fetchedAt: now,
      sourceUpdatedAt: now, // Capital.com's clientsentiment endpoint does not return a per-market timestamp
      nextExpectedUpdate: null,
      value: { marketId: mapping.capitalComMarketId, pctLong: data.longPositionPercentage, pctShort: data.shortPositionPercentage },
      raw: data,
    };
  } catch (err) {
    return errorResult("capital-com", SOURCE, err instanceof Error ? err.message : String(err));
  }
}
