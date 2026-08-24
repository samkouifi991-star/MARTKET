// FX's V2 asset-specific interpretation (requirement #5's FX section):
// macro surprises are ALWAYS relative, never absolute. Strong US payrolls
// can be bearish GBPUSD (USD strengthens against everything) while strong
// UK payrolls can be bullish GBPUSD (GBP strengthens against USD) — the
// exact example from the spec. This applies to every FX pair generically:
// base country's surprise minus quote country's surprise.
function clamp(v: number, min = -10, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

const RELATIVE_SURPRISE_SCALE = 1.5;

/** baseCountrySurpriseZ/quoteCountrySurpriseZ are the SAME indicator's
 * surprise Z-score for each side of the pair (e.g. both countries' NFP-
 * equivalent labor surprise) — a positive result is bullish for the base
 * currency (bearish for the quote), matching FX quoting convention
 * (base/quote, e.g. GBP/USD: positive = GBP strength). */
export function computeFxRelativeSurpriseShock(baseCountrySurpriseZ: number, quoteCountrySurpriseZ: number, scale = RELATIVE_SURPRISE_SCALE): number {
  return clamp((baseCountrySurpriseZ - quoteCountrySurpriseZ) * scale);
}

/** When only one side of the pair has a fresh surprise this cycle (the
 * far more common case — countries rarely release the same indicator on
 * the same day), the other side's surprise is implicitly 0 (no news = no
 * relative shock from that side), not excluded — a real US payrolls
 * surprise still moves GBPUSD even with no corresponding UK release today. */
export function computeFxRelativeSurpriseShockOneSided(surpriseZ: number, isBaseCountry: boolean, scale = RELATIVE_SURPRISE_SCALE): number {
  const signedZ = isBaseCountry ? surpriseZ : -surpriseZ;
  return clamp(signedZ * scale);
}
