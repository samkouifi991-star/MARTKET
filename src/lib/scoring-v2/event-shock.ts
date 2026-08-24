// Event shock decay (requirements #7, #8). A shock's initial contribution
// is stored once (see schema.ts's eventShocks table) and never mutated —
// this pure function recomputes how much of it survives at ANY later point
// in time, since Vercel functions are stateless between invocations and
// decay must be derivable from a stored occurredAt timestamp alone, never
// an in-memory timer.
import { ImportanceTier } from "@/services/economic-calendar/indicator-taxonomy";

// Below this magnitude, a shock is treated as fully decayed (0) rather than
// carrying an ever-shrinking-but-never-quite-zero tail forever.
const NEGLIGIBLE_THRESHOLD = 0.02;

/** Exponential half-life decay: after `halfLifeHours`, exactly half the
 * initial contribution remains; after two half-lives, a quarter; and so on.
 * HIGH-tier events (FOMC/CPI/NFP/GDP) get a longer half-life via the
 * caller's decayHalfLifeHoursByTier config, so they persist longer than a
 * LOW-impact release, matching the spec's explicit example numbers
 * (+1.5 initial -> ~+1.0 after a few hours -> ~+0.5 the next day -> ~0
 * eventually, for a multi-day half-life). */
export function decayedContribution(initialContribution: number, hoursElapsed: number, halfLifeHours: number): number {
  if (hoursElapsed <= 0) return initialContribution;
  if (halfLifeHours <= 0) return 0;
  const decayed = initialContribution * Math.pow(0.5, hoursElapsed / halfLifeHours);
  return Math.abs(decayed) < NEGLIGIBLE_THRESHOLD ? 0 : Number(decayed.toFixed(4));
}

export type StoredEventShock = { symbol: string; factorKey: string | null; initialContribution: number; importanceTier: ImportanceTier; occurredAt: string };

/** Sums every still-live shock's current (decayed) contribution for a
 * symbol, split by whether it applies to the total score directly
 * (factorKey null) or to a specific factor — engine.ts adds the total-score
 * shocks into the "event" pseudo-factor and per-factor shocks into that
 * factor's own contribution before family caps are applied. */
export function sumActiveShocks(shocks: StoredEventShock[], halfLifeHoursByTier: Record<ImportanceTier, number>, now: Date = new Date()): { total: number; byFactorKey: Map<string, number> } {
  let total = 0;
  const byFactorKey = new Map<string, number>();
  for (const shock of shocks) {
    const hoursElapsed = (now.getTime() - new Date(shock.occurredAt).getTime()) / 3_600_000;
    const current = decayedContribution(shock.initialContribution, hoursElapsed, halfLifeHoursByTier[shock.importanceTier]);
    if (current === 0) continue;
    if (shock.factorKey === null) {
      total += current;
    } else {
      byFactorKey.set(shock.factorKey, (byFactorKey.get(shock.factorKey) ?? 0) + current);
    }
  }
  return { total: Number(total.toFixed(4)), byFactorKey };
}
