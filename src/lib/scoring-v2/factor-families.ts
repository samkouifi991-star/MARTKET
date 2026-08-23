// Factor families — groups the 9 existing ScoreFactorKeys (plus V2's own
// "event" pseudo-factor) so a single macro story can't be counted 5 times
// just because CPI, PPI, rates, and USD all point the same way
// (requirement #11). applyFamilyCaps clamps each family's SUMMED
// contribution to a configured maximum, applied AFTER each individual
// factor's own weight/freshness/etc. adjustments — it never changes an
// individual factor's own rawScore or explanation, only how much of its
// contribution survives into the total.
import { ScoreFactorKey } from "@/lib/types";

export type FactorFamily = "Macro" | "Positioning" | "Technical" | "Event";

export type FamilyCap = { family: FactorFamily; maxContribution: number };

// "event" isn't a real ScoreFactorKey (V1 has no such factor) — it's V2's
// own pseudo-key for event-shock contributions, included here so the same
// family-cap machinery covers it without a separate code path.
export type FamilyKey = ScoreFactorKey | "event";

export const FACTOR_FAMILY: Record<FamilyKey, FactorFamily> = {
  economicGrowth: "Macro",
  inflation: "Macro",
  labor: "Macro",
  interestRates: "Macro",
  institutional: "Positioning",
  retailSentiment: "Positioning",
  technical: "Technical",
  seasonality: "Technical",
  news: "Macro", // news is macro/geopolitical commentary, not its own family
  event: "Event",
};

export type FamilyContribution = { key: FamilyKey; contribution: number };

/** Sums each family's contributions, clamps the family total to its
 * configured cap (preserving sign — a family capped at 6 can contribute at
 * most +6 or -6, never flipped), then rescales each member's contribution
 * within that family proportionally so the visible per-factor contributions
 * still sum exactly to the (now-capped) family total — required so "Total
 * Score = sum of visible factor contributions" (requirement #1) still holds
 * after capping, not just before it. */
export function applyFamilyCaps(contributions: FamilyContribution[], caps: FamilyCap[]): FamilyContribution[] {
  const capByFamily = new Map(caps.map((c) => [c.family, c.maxContribution]));

  const byFamily = new Map<FactorFamily, FamilyContribution[]>();
  for (const c of contributions) {
    const family = FACTOR_FAMILY[c.key];
    const list = byFamily.get(family);
    if (list) list.push(c);
    else byFamily.set(family, [c]);
  }

  const result: FamilyContribution[] = [];
  for (const [family, members] of byFamily) {
    const cap = capByFamily.get(family);
    const total = members.reduce((s, m) => s + m.contribution, 0);
    if (cap === undefined || Math.abs(total) <= cap || total === 0) {
      result.push(...members);
      continue;
    }
    // Scale every member down (or up, for a negative total exceeding a
    // negative cap) by the same factor so their sum lands exactly on the
    // cap's boundary, sign preserved.
    const scale = cap / Math.abs(total);
    result.push(...members.map((m) => ({ key: m.key, contribution: Number((m.contribution * scale).toFixed(4)) })));
  }
  return result;
}
