// EconomicCalendarProvider abstraction (requirement #22): the scoring
// engine never talks to a specific calendar vendor directly — only to this
// interface. Today's only implementation (fmp-provider.ts) wraps the
// existing FMP economics-calendar integration; swapping in a dedicated
// vendor later (Trading Economics or similar) means writing one new file
// that implements this same interface, never touching economic-surprise.ts,
// event-shock.ts, or the cron route that consumes it.
import { Provenance } from "../types";
import { EconomicIndicatorKey, ImportanceTier } from "./indicator-taxonomy";

export type EconomicRelease = {
  id: string; // provider's own external id — NOT the dedup key, see release-identity.ts
  country: string; // provider's raw country label
  event: string; // raw free-text event name, kept for display/debugging
  indicatorKey: EconomicIndicatorKey | null; // null when the taxonomy couldn't classify `event` — never guessed
  importanceTier: ImportanceTier | null; // null exactly when indicatorKey is null
  // The real, order-independent identity (release-identity.ts's
  // releaseKeyFor) — null exactly when indicatorKey is null, since the key
  // is only meaningful once a release is classified.
  releaseKey: string | null;
  dateTime: string; // ISO
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  // Honestly null unless the provider actually supplies a revised prior
  // value — FMP's adapter never fabricates one (see fmp-provider.ts).
  revisedPrevious: number | null;
};

export interface EconomicCalendarProvider {
  getReleases(fromISO: string, toISO: string): Promise<Provenance<EconomicRelease[]>>;
}
