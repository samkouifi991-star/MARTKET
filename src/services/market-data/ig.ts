// IG Client Sentiment — retail positioning. The only place in the app
// allowed to call IG's trading API (api.ig.com or demo-api.ig.com).
//
// IG does not expose client sentiment as a plain public REST API — it's
// part of IG's authenticated Trading API (labs.ig.com), which requires a
// live or demo IG brokerage account plus an API key issued from that
// account, and only covers markets IG itself lists (identified by IG's own
// "epic" codes, e.g. "CS.D.EURUSD.CFD.IP"). Every `igEpic` in symbol-map.ts
// is intentionally `null` until confirmed against a real IG session's
// `/markets?searchTerm=` response — guessing an epic risks silently
// attaching the wrong market's sentiment. Until an instrument has a
// confirmed epic AND IG credentials are configured, getRetailSentiment
// returns "unavailable" for it, per this project's spec: never estimate or
// substitute a percentage when the real source doesn't cover a market.
import { getSymbolMapping } from "./symbol-map";
import { Provenance, unavailable } from "../types";

const IG_BASE = process.env.IG_ENVIRONMENT === "live" ? "https://api.ig.com/gateway/deal" : "https://demo-api.ig.com/gateway/deal";
const SOURCE = "IG Client Sentiment";

export type IgClientSentiment = {
  epic: string;
  pctLong: number;
  pctShort: number;
};

type IgSession = { cst: string; securityToken: string; expiresAt: number };
let cachedSession: IgSession | null = null;

function credentialsConfigured(): boolean {
  return Boolean(process.env.IG_API_KEY && process.env.IG_USERNAME && process.env.IG_PASSWORD);
}

async function login(): Promise<IgSession> {
  if (cachedSession && cachedSession.expiresAt > Date.now()) return cachedSession;

  const res = await fetch(`${IG_BASE}/session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      Accept: "application/json; charset=UTF-8",
      "X-IG-API-KEY": process.env.IG_API_KEY!,
      Version: "2",
    },
    body: JSON.stringify({ identifier: process.env.IG_USERNAME, password: process.env.IG_PASSWORD }),
  });
  if (!res.ok) throw new Error(`IG login failed: ${res.status} ${res.statusText}`);

  const cst = res.headers.get("CST");
  const securityToken = res.headers.get("X-SECURITY-TOKEN");
  if (!cst || !securityToken) throw new Error("IG login response missing session tokens");

  cachedSession = { cst, securityToken, expiresAt: Date.now() + 55 * 60_000 }; // IG sessions last ~1h
  return cachedSession;
}

export async function getRetailSentiment(internalSymbol: string): Promise<Provenance<IgClientSentiment>> {
  const mapping = getSymbolMapping(internalSymbol);
  if (!mapping?.igEpic) {
    return unavailable("ig", SOURCE, `No confirmed IG epic for ${internalSymbol} — retail sentiment unavailable for this market`);
  }
  if (!credentialsConfigured()) {
    return unavailable("ig", SOURCE, "IG_API_KEY / IG_USERNAME / IG_PASSWORD not configured");
  }

  try {
    const session = await login();
    const res = await fetch(`${IG_BASE}/clientsentiment/${encodeURIComponent(mapping.igEpic)}`, {
      headers: {
        Accept: "application/json; charset=UTF-8",
        "X-IG-API-KEY": process.env.IG_API_KEY!,
        CST: session.cst,
        "X-SECURITY-TOKEN": session.securityToken,
        Version: "1",
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) throw new Error(`IG client sentiment request failed: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as { marketId: string; longPositionPercentage: number; shortPositionPercentage: number };
    const now = new Date().toISOString();
    return {
      provider: "ig",
      source: SOURCE,
      status: "live",
      fetchedAt: now,
      sourceUpdatedAt: now, // IG does not return a per-market timestamp; sentiment is a live snapshot
      nextExpectedUpdate: null,
      value: { epic: mapping.igEpic, pctLong: data.longPositionPercentage, pctShort: data.shortPositionPercentage },
      raw: data,
    };
  } catch (err) {
    return unavailable("ig", SOURCE, err instanceof Error ? err.message : String(err));
  }
}
