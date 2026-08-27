// Carry Trade Scanner (Phase 7 of the platform redesign) — ranks the
// tracked FX pairs by policy-rate differential (the "carry"), and checks
// whether that carry is fundamentally supported or fighting the trend
// using Phase 4/5's Economic Strength differential as a secondary signal.
// Built entirely on top of forex-scorecard.ts's already-composed data —
// no new fetching, only ranking + a support classification.
import { buildAllForexScorecards, ForexScorecardData } from "./forex-scorecard";

export type CarryDirection = "Long base" | "Long quote" | "Flat";
export type CarrySupport = "Supported" | "Fighting the trend" | "Mixed" | "Unknown";

export type CarryTradeRow = {
  symbol: string;
  base: string;
  quote: string;
  rateDifferentialPts: number | null;
  carryDirection: CarryDirection | null;
  strengthDifferential: number | null;
  support: CarrySupport;
};

// A differential below this is treated as flat carry — not worth ranking
// as a directional trade either way.
const FLAT_THRESHOLD_PTS = 0.1;
// Strength differential must clear this magnitude to call the carry
// "supported"/"fighting" rather than "mixed" — a small edge either way
// isn't a strong enough fundamental read to override/confirm the carry.
const STRENGTH_CONFIRMATION_THRESHOLD = 5;

function carryDirectionFor(rateDifferentialPts: number | null): CarryDirection | null {
  if (rateDifferentialPts === null) return null;
  if (rateDifferentialPts > FLAT_THRESHOLD_PTS) return "Long base";
  if (rateDifferentialPts < -FLAT_THRESHOLD_PTS) return "Long quote";
  return "Flat";
}

function supportFor(carryDirection: CarryDirection | null, strengthDifferential: number | null): CarrySupport {
  if (carryDirection === null || carryDirection === "Flat" || strengthDifferential === null) return "Unknown";
  // "Long base" carry is fundamentally supported when the base currency is
  // ALSO the stronger economy (positive strengthDifferential) — a carry
  // trade riding both yield and fundamentals, not just yield alone.
  if (carryDirection === "Long base") {
    if (strengthDifferential > STRENGTH_CONFIRMATION_THRESHOLD) return "Supported";
    if (strengthDifferential < -STRENGTH_CONFIRMATION_THRESHOLD) return "Fighting the trend";
    return "Mixed";
  }
  if (strengthDifferential < -STRENGTH_CONFIRMATION_THRESHOLD) return "Supported";
  if (strengthDifferential > STRENGTH_CONFIRMATION_THRESHOLD) return "Fighting the trend";
  return "Mixed";
}

export function rowFromScorecard(sc: ForexScorecardData): CarryTradeRow {
  const carryDirection = carryDirectionFor(sc.rateDifferentialPts);
  return {
    symbol: sc.symbol,
    base: sc.base,
    quote: sc.quote,
    rateDifferentialPts: sc.rateDifferentialPts,
    carryDirection,
    strengthDifferential: sc.strengthDifferential,
    support: supportFor(carryDirection, sc.strengthDifferential),
  };
}

export async function buildCarryTradeScanner(storageOnly = true): Promise<CarryTradeRow[]> {
  const scorecards = await buildAllForexScorecards(storageOnly);
  return scorecards.map(rowFromScorecard).sort((a, b) => Math.abs(b.rateDifferentialPts ?? 0) - Math.abs(a.rateDifferentialPts ?? 0));
}
