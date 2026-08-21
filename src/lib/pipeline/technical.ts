import { getInstrument } from "@/lib/instruments";
import { technicalFactor as demoTechnicalFactor } from "@/lib/scoring";
import { computeTechnicalTrend, TechnicalTrendResult } from "@/lib/engines/technical-trend";
import { getDailyCandlesWithFallback, getIntradayCandlesWithFallback } from "@/services/market-data/last-known-good";
import { Provenance, NormalizedCandle } from "@/services/types";
import { DataFreshness } from "@/lib/types";
import { demoFallbackFactor, errorFactor, ResolvedFactor, unavailableFactor } from "./types";
import { allowsDemoFallback, DataMode } from "@/services/data-mode";

const PROVIDER_DISPLAY: Record<string, string> = { fmp: "FMP", oanda: "OANDA" };

export type TechnicalTrendFetch = {
  daily: Provenance<NormalizedCandle[]>;
  h4: Provenance<NormalizedCandle[]>;
  h1: Provenance<NormalizedCandle[]>;
  result: TechnicalTrendResult | null;
};

/** Real data the caller can compute from: live, or last-known-good stored
 * data — never a synthetic/demo value. Distinct from "unavailable"/"error",
 * which mean there is genuinely nothing usable (including no stored
 * fallback), the only case that should render as unavailable. */
function hasUsableValue<T>(p: Provenance<T>): boolean {
  return (p.status === "live" || p.status === "delayed" || p.status === "stale") && p.value !== null;
}

/** Fetches real candles (routed OANDA-primary for FX / FMP for everything
 * else — see market-data-router.ts — falling back to the last stored Neon
 * rows if the live call fails, see last-known-good.ts) and computes the
 * multi-timeframe technical result. Shared by resolveTechnicalFactor (the
 * scoring factor) and the market-detail price chart card, so both read the
 * exact same real indicators rather than each computing its own. */
export async function fetchTechnicalTrend(symbol: string): Promise<TechnicalTrendFetch> {
  const daily = await getDailyCandlesWithFallback(symbol);
  if (!hasUsableValue(daily)) {
    return { daily, h4: daily as Provenance<NormalizedCandle[]>, h1: daily as Provenance<NormalizedCandle[]>, result: null };
  }

  // Intraday candles now have their own storage fallback too (the candles
  // cron writes 4h/1h to Neon — see cron/candles/route.ts) — a live 4H/1H
  // failure degrades to the last stored value instead of dropping straight
  // to daily-only, same principle daily candles already followed.
  const [h4, h1] = await Promise.all([getIntradayCandlesWithFallback(symbol, "4hour"), getIntradayCandlesWithFallback(symbol, "1hour")]);
  const result = computeTechnicalTrend({
    daily: daily.value!,
    h4: hasUsableValue(h4) ? h4.value! : undefined,
    h1: hasUsableValue(h1) ? h1.value! : undefined,
  });

  return { daily, h4, h1, result };
}

function isFallbackSource(p: Provenance<unknown>): boolean {
  return p.source.includes("last known good");
}

/** Names exactly which provider served each timeframe actually used in the
 * result — e.g. "OANDA D + H4 + H1 candles" when all three came from
 * OANDA, or "OANDA D + H4 candles, FMP H1 candles" if they came from
 * different providers (e.g. a partial fallback) — never a hardcoded
 * provider name regardless of which one actually served the data. */
function buildSourceLabel(entries: { label: string; p: Provenance<unknown>; usable: boolean }[]): string {
  const used = entries.filter((e) => e.usable);
  const missing = entries.filter((e) => !e.usable);
  if (used.length === 0) return "Price & indicator engine";

  const byProvider = new Map<string, string[]>();
  for (const e of used) {
    const list = byProvider.get(e.p.provider) ?? [];
    list.push(e.label);
    byProvider.set(e.p.provider, list);
  }
  const groups = [...byProvider.entries()].map(([provider, labels]) => `${PROVIDER_DISPLAY[provider] ?? provider} ${labels.join(" + ")} candles`);
  const missingNote = missing.length > 0 ? ` (${missing.map((m) => m.label).join(", ")} unavailable)` : "";
  return `Price & indicator engine — ${groups.join(", ")}${missingNote}`;
}

export async function resolveTechnicalFactor(symbol: string, mode: DataMode): Promise<ResolvedFactor> {
  const instrument = getInstrument(symbol);
  if (!instrument) return unavailableFactor("technical", "Price & indicator engine", `Unknown instrument ${symbol}`);

  const { daily, h4, h1, result } = await fetchTechnicalTrend(symbol);

  if (!hasUsableValue(daily)) {
    if (allowsDemoFallback(mode, symbol)) {
      const fallback = demoTechnicalFactor(instrument);
      return demoFallbackFactor({ key: "technical", rawScore: fallback.raw, explanation: fallback.explanation, source: fallback.source, lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() });
    }
    // hasUsableValue() already ruled out live/delayed/stale above — this is
    // the genuine "nothing usable, including no stored fallback" case, so
    // the error/unavailable distinction from the live call still matters.
    return daily.status === "error"
      ? errorFactor("technical", daily.source, daily.error ?? "request failed")
      : unavailableFactor("technical", daily.source, daily.error ?? "Daily candles unavailable, and no stored candles exist yet to fall back to");
  }

  if (!result) {
    if (allowsDemoFallback(mode, symbol)) {
      const fallback = demoTechnicalFactor(instrument);
      return demoFallbackFactor({ key: "technical", rawScore: fallback.raw, explanation: fallback.explanation, source: fallback.source, lastUpdated: new Date().toISOString(), nextUpdate: new Date().toISOString() });
    }
    return unavailableFactor("technical", daily.source, "Insufficient candle history to compute indicators");
  }

  // Provenance reflects only the datasets that actually contributed to this
  // result — never claim 4H/1H confirmation was used when neither a live
  // request nor its stored fallback produced anything usable.
  const h4Usable = hasUsableValue(h4);
  const h1Usable = hasUsableValue(h1);
  // Strictly-live (not delayed/stale-from-storage) is what gates whether
  // the whole factor can report freshness "live" — see below.
  const h4Live = h4.status === "live" && Boolean(h4.value);
  const h1Live = h1.status === "live" && Boolean(h1.value);
  const now = new Date().toISOString();
  const fromStorage = isFallbackSource(daily);

  // The daily candles' own freshness (live, or delayed/stale from
  // last-known-good storage) sets the floor — full live intraday
  // confirmation can only reach "live" when daily itself is genuinely live;
  // a fallback-sourced daily series can never be reported as fully live
  // even with confirming intraday data.
  const freshness: DataFreshness = daily.status !== "live" ? daily.status : h4Live && h1Live ? "live" : "delayed";

  const source = buildSourceLabel([
    { label: "D", p: daily, usable: true },
    { label: "H4", p: h4, usable: h4Usable },
    { label: "H1", p: h1, usable: h1Usable },
  ]) + (fromStorage ? " — last known good" : "");

  if (freshness === "live") {
    return {
      key: "technical",
      rawScore: result.rawScore,
      explanation: result.explanation,
      source,
      provider: daily.provider,
      freshness: "live",
      lastUpdated: daily.sourceUpdatedAt ?? now,
      nextUpdate: now,
    };
  }

  const missing: string[] = [];
  if (!h4Usable) missing.push(h4.status === "unavailable" ? `H4 (${h4.error ?? "unavailable"})` : "H4");
  if (!h1Usable) missing.push(h1.status === "unavailable" ? `H1 (${h1.error ?? "unavailable"})` : "H1");

  const storageNote = fromStorage
    ? ` Live refresh failed (${daily.error ?? "rate-limited"}); calculated from the last successfully stored daily candles instead (as of ${daily.fetchedAt}), not a live re-fetch.`
    : "";

  return {
    key: "technical",
    rawScore: result.rawScore,
    explanation: `Technical trend calculated from daily candles${missing.length ? `. Missing intraday confirmation: ${missing.join(", ")}` : ""}. ${result.explanation}${storageNote}`,
    source,
    provider: daily.provider,
    freshness,
    lastUpdated: daily.sourceUpdatedAt ?? now,
    nextUpdate: now,
  };
}
