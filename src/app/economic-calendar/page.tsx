import { CALENDAR_EVENTS, upcomingHighImpact } from "@/lib/demo/calendar";
import { CalendarClient } from "./CalendarClient";
import { AlertTriangle } from "lucide-react";
import { formatDateTime } from "@/lib/time";
import { requireEntitlement } from "@/lib/auth/dal";

export const metadata = { title: "Economic Calendar — Market Intelligence AI" };

export default async function EconomicCalendarPage() {
  await requireEntitlement();
  const soon = upcomingHighImpact(24);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Economic Calendar</h1>
        <p className="text-sm text-(--text-faint) mt-1">Every tracked release and central-bank decision, with forecast, previous, actual, and historical market reaction.</p>
      </div>

      {soon.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-200">
            <span className="font-medium">{soon.length} high-impact release{soon.length > 1 ? "s" : ""} in the next 24 hours:</span>{" "}
            {soon.map((e, i) => (
              <span key={e.id}>
                {i > 0 && ", "}
                {e.event} ({e.country}, {formatDateTime(e.dateTime)})
              </span>
            ))}
          </div>
        </div>
      )}

      <CalendarClient events={CALENDAR_EVENTS} />
    </div>
  );
}
