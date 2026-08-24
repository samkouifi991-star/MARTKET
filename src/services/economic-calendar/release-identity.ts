// A stable, order-independent identity for one real economic release
// (requirement #2). Deliberately NOT the calendar provider's own raw
// per-event id: services/market-data/fmp.ts builds that id as
// `fmp-${country}-${event}-${date}-${i}`, where `i` is the array index of
// that particular API response — if FMP's response order or count shifts
// between calls (a new event appears earlier in the window, one drops
// off), the SAME real release gets a different raw id on the next poll.
// At once-a-day polling that was a latent, low-consequence bug; at
// 5-minute polling it would eventually produce duplicate surprise rows for
// one release. This module fixes that by keying identity off the
// classified, semantic shape of the release instead of response position.
//
// Deliberately does NOT change fmp.ts's own NormalizedEconomicEvent.id —
// that remains V1's join key for economicEvents.externalId, untouched.
import { EconomicIndicatorKey } from "./indicator-taxonomy";

export function releaseKeyFor(provider: string, country: string, indicatorKey: EconomicIndicatorKey, releaseDateTimeISO: string): string {
  return `${provider}:${country}:${indicatorKey}:${releaseDateTimeISO}`;
}
