"use client";

import { useMemo, useState } from "react";
import { ClientCalendarEvent } from "@/lib/types";
import { formatDateTime, formatRelative, NOW } from "@/lib/time";

const IMPACT_CLASSES: Record<ClientCalendarEvent["impact"], string> = {
  High: "text-rose-400 bg-rose-500/10",
  Medium: "text-amber-400 bg-amber-500/10",
  Low: "text-(--text-faint) bg-slate-500/10",
  Unclassified: "text-(--text-faint) bg-slate-500/10",
};

export function CalendarClient({ events }: { events: ClientCalendarEvent[] }) {
  const [country, setCountry] = useState("All");
  const [impact, setImpact] = useState<"All" | ClientCalendarEvent["impact"]>("All");
  const [when, setWhen] = useState<"Upcoming" | "Past" | "All">("Upcoming");

  const countries = useMemo(() => ["All", ...Array.from(new Set(events.map((e) => e.country)))], [events]);

  const filtered = useMemo(() => {
    const now = NOW.getTime();
    return events.filter((e) => {
      if (country !== "All" && e.country !== country) return false;
      if (impact !== "All" && e.impact !== impact) return false;
      const t = new Date(e.dateTime).getTime();
      if (when === "Upcoming" && t < now) return false;
      if (when === "Past" && t >= now) return false;
      return true;
    });
  }, [events, country, impact, when]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select value={country} onChange={(e) => setCountry(e.target.value)} className="h-8 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-xs">
          {countries.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={impact} onChange={(e) => setImpact(e.target.value as typeof impact)} className="h-8 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-xs">
          {["All", "High", "Medium", "Low", ...(events.some((e) => e.impact === "Unclassified") ? ["Unclassified"] : [])].map((i) => (
            <option key={i} value={i}>{i} impact</option>
          ))}
        </select>
        <div className="flex rounded-lg border border-(--border) overflow-hidden">
          {(["Upcoming", "Past", "All"] as const).map((w) => (
            <button key={w} onClick={() => setWhen(w)} className={`h-8 px-3 text-xs ${when === w ? "bg-(--accent-soft) text-(--accent)" : "text-(--text-faint)"}`}>
              {w}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[1000px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
              <th className="py-2 pr-3">When</th>
              <th className="py-2 px-3">Country</th>
              <th className="py-2 px-3">Event</th>
              <th className="py-2 px-3">Impact</th>
              <th className="py-2 px-3 text-right">Previous</th>
              <th className="py-2 px-3 text-right">Forecast</th>
              <th className="py-2 px-3 text-right">Actual</th>
              {events.some((e) => e.surprise !== undefined) && <th className="py-2 px-3 text-right">Surprise</th>}
              {events.some((e) => e.status !== undefined) && <th className="py-2 px-3">Status</th>}
              {events.some((e) => e.historicalReaction) && <th className="py-2 pl-3">Historical reaction</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 120).map((e) => (
              <tr key={e.id} className="border-b border-(--border) last:border-0 hover:bg-white/[.02]">
                <td className="py-2 pr-3 text-xs text-(--text-dim) whitespace-nowrap">
                  {formatDateTime(e.dateTime)}
                  <div className="text-(--text-faint)">{formatRelative(e.dateTime)}</div>
                </td>
                <td className="py-2 px-3">{e.country}</td>
                <td className="py-2 px-3 font-medium">{e.event}</td>
                <td className="py-2 px-3">
                  <span className={`text-[11px] rounded-full px-2 py-0.5 font-medium ${IMPACT_CLASSES[e.impact]}`}>{e.impact}</span>
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-(--text-faint)">{e.previous ?? "—"}</td>
                <td className="py-2 px-3 text-right tabular-nums text-(--text-faint)">{e.forecast ?? "—"}</td>
                <td className="py-2 px-3 text-right tabular-nums font-medium">{e.actual ?? "—"}</td>
                {events.some((ev) => ev.surprise !== undefined) && (
                  <td className={`py-2 px-3 text-right tabular-nums ${e.surprise != null && e.surprise > 0 ? "text-emerald-400" : e.surprise != null && e.surprise < 0 ? "text-rose-400" : "text-(--text-faint)"}`}>
                    {e.surprise != null ? (e.surprise > 0 ? `+${e.surprise.toFixed(2)}` : e.surprise.toFixed(2)) : "—"}
                  </td>
                )}
                {events.some((ev) => ev.status !== undefined) && (
                  <td className="py-2 px-3 text-xs text-(--text-faint) capitalize">{e.status ?? "—"}</td>
                )}
                {events.some((ev) => ev.historicalReaction) && <td className="py-2 pl-3 text-xs text-(--text-faint) max-w-xs">{e.historicalReaction}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="py-12 text-center text-sm text-(--text-faint)">No events match these filters.</div>}
      </div>
    </div>
  );
}
