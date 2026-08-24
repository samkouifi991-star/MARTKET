// The single source of truth for which markets are ready to show publicly.
// Deliberately built ON TOP of data-mode.ts's STRICT_LIVE_SYMBOLS (never a
// second, independently-maintained list) — STRICT_LIVE_SYMBOLS already IS
// this project's real, hard-won "never demo, verified real data" bar
// (see the many market-by-market promotion milestones this project's
// history is built from), so LAUNCH_READY is exactly that set, not a new
// invention. This module's only job is to name that bar for the public-
// launch UI and give the handful of not-yet-promoted markets an honest,
// specific reason instead of a silent gap.
//
// Public surfaces (Markets, Top Setups, Dashboard rankings, Search,
// Watchlists, the landing page, Heatmap) must render LAUNCH_READY markets
// only — see publicInstruments()/isPubliclyLaunchable() below. Admin
// diagnostics may still see every market, PARTIAL and BLOCKED included,
// by passing includeAll through to the callers that support it.
import { INSTRUMENTS } from "@/lib/instruments";
import { Instrument } from "@/lib/types";
import { isStrictLiveSymbol } from "./data-mode";

export type CoverageStatus = "LAUNCH_READY" | "PARTIAL" | "BLOCKED";

/** A market with a documented, confirmed dead end for its real price
 * source — not merely "not yet promoted," but actually verified to have
 * no usable live data path on the current provider plan. Distinct from
 * PARTIAL (some real provider plumbing exists — an FMP ticker, a CFTC
 * mapping — but the market hasn't been through this project's full
 * verify-and-promote process yet). Never guessed: only symbols with a
 * real, traceable reason belong here. */
const BLOCKED_REASONS: Partial<Record<string, string>> = {
  NAS100: "FMP returns 402 Payment Required for ^NDX and every substitute (^XNDX, QQQ) on this account's plan — no real price source exists yet (see symbol-map.ts).",
};

export function coverageStatusFor(symbol: string): CoverageStatus {
  if (isStrictLiveSymbol(symbol)) return "LAUNCH_READY";
  if (BLOCKED_REASONS[symbol]) return "BLOCKED";
  return "PARTIAL";
}

/** Human-readable reason for a non-LAUNCH_READY market, for admin
 * diagnostics only — never shown to a public/customer surface. Null for a
 * LAUNCH_READY market (no reason needed) or a PARTIAL one with no single
 * documented blocker yet (real provider plumbing exists but hasn't cleared
 * this project's full verification bar — see market-by-market promotion
 * history in symbol-map.ts). */
export function coverageReasonFor(symbol: string): string | null {
  return BLOCKED_REASONS[symbol] ?? null;
}

export function isPubliclyLaunchable(symbol: string): boolean {
  return coverageStatusFor(symbol) === "LAUNCH_READY";
}

/** Every instrument, in INSTRUMENTS' own order, restricted to LAUNCH_READY
 * — the list every public surface should render. Admin diagnostics use
 * INSTRUMENTS directly (with coverageStatusFor per row) instead of this. */
export function publicInstruments(): Instrument[] {
  return INSTRUMENTS.filter((i) => isPubliclyLaunchable(i.symbol));
}
