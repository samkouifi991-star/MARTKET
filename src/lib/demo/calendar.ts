import { CalendarEvent, CalendarImpact, EconomicRelease } from "../types";
import { allEconomies } from "./economies";
import { CENTRAL_BANKS } from "./centralBanks";
import { NOW } from "../time";

const HIGH_IMPACT_INDICATORS = new Set([
  "GDP Growth QoQ",
  "CPI YoY",
  "Core CPI YoY",
  "Employment Change",
  "Unemployment Rate",
]);
const MEDIUM_IMPACT_INDICATORS = new Set([
  "Manufacturing PMI",
  "Services PMI",
  "PPI YoY",
  "Initial Jobless Claims",
  "Retail Sales MoM",
]);

function impactFor(indicator: string): CalendarImpact {
  if (HIGH_IMPACT_INDICATORS.has(indicator)) return "High";
  if (MEDIUM_IMPACT_INDICATORS.has(indicator)) return "Medium";
  return "Low";
}

function fmt(value: number, unit: string): string {
  return `${value}${unit}`;
}

function reactionFor(release: EconomicRelease): string {
  const beat = release.surprise > 0;
  return beat
    ? `Prior comparable beats produced an average 0.3-0.6% move in ${release.impactedMarkets[0]} within the following session.`
    : `Prior comparable misses produced an average 0.2-0.5% adverse move in ${release.impactedMarkets[0]} within the following session.`;
}

function eventsFromReleases(): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const economy of allEconomies()) {
    for (const release of [...economy.growth, ...economy.inflation, ...economy.labor]) {
      // Past instance (already released, has an actual)
      events.push({
        id: `${release.id}-past`,
        dateTime: release.releaseDate,
        country: economy.country.name,
        event: release.indicator,
        impact: impactFor(release.indicator),
        forecast: fmt(release.forecast, release.unit),
        previous: fmt(release.previous, release.unit),
        actual: fmt(release.actual, release.unit),
        revision: release.revision !== null ? fmt(release.revision, release.unit) : null,
        affectedMarkets: release.impactedMarkets,
        historicalReaction: reactionFor(release),
      });
      // Next scheduled instance (no actual yet)
      events.push({
        id: `${release.id}-next`,
        dateTime: release.nextRelease,
        country: economy.country.name,
        event: release.indicator,
        impact: impactFor(release.indicator),
        forecast: fmt(release.forecast, release.unit),
        previous: fmt(release.actual, release.unit),
        actual: null,
        revision: null,
        affectedMarkets: release.impactedMarkets,
        historicalReaction: reactionFor(release),
      });
    }
  }
  for (const bank of CENTRAL_BANKS) {
    events.push({
      id: `${bank.code}-meeting`,
      dateTime: bank.nextMeeting,
      country: bank.currency,
      event: `${bank.name} Policy Decision`,
      impact: "High",
      forecast: `Hold at ${bank.currentRate}%`,
      previous: `${bank.previousRate}%`,
      actual: null,
      revision: null,
      affectedMarkets: [bank.currency],
      historicalReaction: `${bank.stance} tone in recent communication; markets price ${bank.probHike}% hike / ${bank.probHold}% hold / ${bank.probCut}% cut.`,
    });
  }
  return events.sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());
}

export const CALENDAR_EVENTS: CalendarEvent[] = eventsFromReleases();

export function upcomingHighImpact(withinHours = 48): CalendarEvent[] {
  const now = NOW.getTime();
  return CALENDAR_EVENTS.filter((e) => {
    const t = new Date(e.dateTime).getTime();
    return e.impact === "High" && t > now && t - now <= withinHours * 3600_000;
  });
}
