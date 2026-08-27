// Live-aware general economic calendar — Phase 18 (public-launch demo
// sweep): the Dashboard's "Upcoming high-impact events" card and the
// /economic-calendar page called the hand-seeded CALENDAR_EVENTS demo array
// unconditionally, regardless of DATA_MODE. This reads the SAME
// economicEvents rows the FMP calendar cron already writes (see
// db/queries/market-data.ts's upsertEconomicEvent/
// updateEconomicEventClassification), storage-first, no live provider call
// at render time.
//
// Deliberately a leaner shape than the demo CalendarEvent type:
// previous/forecast/actual are plain numbers (no per-indicator unit string
// is stored, so no honest "%"/"K" suffix can be attached), and
// historicalReaction (an inherently fabricated narrative prediction in the
// demo data) has no honest real-data equivalent, so it's omitted.
import { getEconomicEventsInRange } from "@/db/queries/market-data";
import { ClientCalendarEvent } from "@/lib/types";

export async function getLiveCalendarFeed(pastDays: number, futureDays: number, limit = 300): Promise<ClientCalendarEvent[]> {
  const now = Date.now();
  const from = new Date(now - pastDays * 86_400_000);
  const to = new Date(now + futureDays * 86_400_000);
  const rows = await getEconomicEventsInRange(from, to, limit);
  return rows.map((r) => ({
    id: String(r.id),
    dateTime: r.dateTime,
    country: r.country,
    event: r.event,
    impact: (r.impact as ClientCalendarEvent["impact"]) ?? "Unclassified",
    previous: r.previous,
    forecast: r.forecast,
    actual: r.actual,
    affectedMarkets: r.affectedMarkets,
    // Raw actual-minus-forecast — not the V2 shadow engine's historically-
    // standardized surpriseZ, just the plain difference this table can
    // honestly show without joining a V2 table from a V1 page.
    surprise: r.actual !== null && r.forecast !== null ? r.actual - r.forecast : null,
    status: r.processingStatus,
  }));
}
