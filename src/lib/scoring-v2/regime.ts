// Shared macro regime classifier — Gold/Indices/Crypto's asset-specific
// interpreters (asset-interpretation/*) all read from this ONE regime
// classification instead of each independently guessing at "is this a
// hawkish or dovish environment right now" from their own inputs. Built
// from real-yield trend, USD trend, and VIX — the same three drivers
// pipeline/gold-macro.ts already fetches (DFII10, DTWEXBGS, VIXCLS), so
// callers with those numbers already in hand don't need a second fetch.
export type MacroRegime = "HawkishTightening" | "DovishEasing" | "RiskOff" | "RiskOn" | "Neutral";

export type RegimeInputs = {
  realYieldTrend: number; // change in DFII10 over the lookback window, percentage points
  usdTrend: number; // change in DTWEXBGS over the lookback window, index points
  vixLevel: number; // current VIXCLS level
  vixTrend: number; // change in VIXCLS over the lookback window, points
};

const HAWKISH_REAL_YIELD_THRESHOLD = 0.15;
const DOVISH_REAL_YIELD_THRESHOLD = -0.15;
const USD_TREND_THRESHOLD = 0.5;
const VIX_ELEVATED_LEVEL = 25;
const VIX_SHARP_RISE = 5;
const VIX_CALM_LEVEL = 15;

/** Risk-off (an elevated or sharply rising VIX) takes priority over the
 * rates-driven reads below — a genuine risk-off episode dominates the
 * macro backdrop regardless of where real yields happen to sit that day. */
export function classifyRegime(inputs: RegimeInputs): MacroRegime {
  if (inputs.vixLevel >= VIX_ELEVATED_LEVEL || inputs.vixTrend > VIX_SHARP_RISE) return "RiskOff";
  if (inputs.realYieldTrend > HAWKISH_REAL_YIELD_THRESHOLD && inputs.usdTrend > USD_TREND_THRESHOLD) return "HawkishTightening";
  if (inputs.realYieldTrend < DOVISH_REAL_YIELD_THRESHOLD && inputs.usdTrend < -USD_TREND_THRESHOLD) return "DovishEasing";
  if (inputs.vixLevel <= VIX_CALM_LEVEL && inputs.vixTrend < 0) return "RiskOn";
  return "Neutral";
}

/** How unambiguous this regime read is, 0..1 — feeds confidence-v2.ts's
 * "regime clarity" input (requirement #13). Neutral (no driver crossed a
 * threshold clearly) is low clarity; a regime backed by drivers well past
 * their thresholds is high clarity. */
export function regimeClarity(regime: MacroRegime, inputs: RegimeInputs): number {
  if (regime === "Neutral") return 0.3;
  if (regime === "RiskOff") return Math.min(1, 0.5 + Math.abs(inputs.vixTrend) / 20 + Math.max(0, inputs.vixLevel - VIX_ELEVATED_LEVEL) / 20);
  if (regime === "RiskOn") return Math.min(1, 0.5 + (VIX_CALM_LEVEL - inputs.vixLevel) / 20);
  // Hawkish/dovish: clarity scales with how far past both thresholds the drivers sit.
  const yieldMargin = Math.abs(inputs.realYieldTrend) - HAWKISH_REAL_YIELD_THRESHOLD;
  const usdMargin = Math.abs(inputs.usdTrend) - USD_TREND_THRESHOLD;
  return Math.max(0.4, Math.min(1, 0.5 + (yieldMargin + usdMargin) / 4));
}
