"use client";

import { useMemo, useState } from "react";
import { Instrument, SeasonalityStat } from "@/lib/types";
import { formatSignedPct } from "@/lib/format";

export function SeasonalityClient({
  instruments,
  monthlyBySymbol,
  weekdayBySymbol,
  unavailable = {},
}: {
  instruments: Instrument[];
  monthlyBySymbol: Record<string, SeasonalityStat[]>;
  weekdayBySymbol: Record<string, SeasonalityStat[]>;
  unavailable?: Record<string, string>;
}) {
  const firstWithData = instruments.find((i) => monthlyBySymbol[i.symbol])?.symbol ?? instruments[0].symbol;
  const [symbol, setSymbol] = useState(firstWithData);
  const [view, setView] = useState<"Monthly" | "Day of Week">("Monthly");

  const stats = useMemo(() => (view === "Monthly" ? monthlyBySymbol[symbol] : weekdayBySymbol[symbol]) ?? [], [symbol, view, monthlyBySymbol, weekdayBySymbol]);
  const currentMonthName = new Date().toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const currentIndex = view === "Monthly" ? stats.findIndex((s) => s.period === currentMonthName) : null;

  if (unavailable[symbol]) {
    return (
      <div className="space-y-4">
        <SymbolPicker symbol={symbol} setSymbol={setSymbol} instruments={instruments} />
        <div className="card p-6 text-sm text-(--text-faint)">{unavailable[symbol]}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SymbolPicker symbol={symbol} setSymbol={setSymbol} instruments={instruments} />
        <div className="flex rounded-lg border border-(--border) overflow-hidden">
          {(["Monthly", "Day of Week"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`h-8 px-3 text-xs ${view === v ? "bg-(--accent-soft) text-(--accent)" : "text-(--text-faint)"}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
              <th className="py-2 pr-3">Period</th>
              <th className="py-2 px-3 text-right">Avg return</th>
              <th className="py-2 px-3 text-right">Median</th>
              <th className="py-2 px-3 text-right">% positive</th>
              <th className="py-2 px-3 text-right">Best</th>
              <th className="py-2 px-3 text-right">Worst</th>
              <th className="py-2 px-3 text-right">10y avg</th>
              <th className="py-2 px-3 text-right">20y avg</th>
              <th className="py-2 px-3 text-right">Max drawdown</th>
              <th className="py-2 pl-3 text-right">Years</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s, i) => (
              <tr key={s.period} className={`border-b border-(--border) last:border-0 ${i === currentIndex ? "bg-(--accent-soft)" : ""}`}>
                <td className="py-2 pr-3 font-medium">
                  {s.period}
                  {i === currentIndex && <span className="ml-1.5 text-[10px] text-(--accent)">current</span>}
                </td>
                <td className={`py-2 px-3 text-right tabular-nums ${s.avgReturn >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{formatSignedPct(s.avgReturn)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{formatSignedPct(s.medianReturn)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{s.pctPositive}%</td>
                <td className="py-2 px-3 text-right tabular-nums text-emerald-400">{formatSignedPct(s.bestReturn)}</td>
                <td className="py-2 px-3 text-right tabular-nums text-rose-400">{formatSignedPct(s.worstReturn)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{formatSignedPct(s.avg10y)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{s.avg20y !== null ? formatSignedPct(s.avg20y) : "—"}</td>
                <td className="py-2 px-3 text-right tabular-nums text-rose-400">{formatSignedPct(s.maxDrawdown)}</td>
                <td className="py-2 pl-3 text-right tabular-nums text-(--text-faint)">{s.years}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-(--text-faint)">
        Averages alone can be distorted by outliers — compare against the median, win rate, and range before treating any single period as a signal. Seasonality contributes to the total score as one factor among nine, never as a standalone trade trigger.
      </p>
    </div>
  );
}

function SymbolPicker({ symbol, setSymbol, instruments }: { symbol: string; setSymbol: (s: string) => void; instruments: Instrument[] }) {
  return (
    <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="h-8 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-xs">
      {instruments.map((i) => (
        <option key={i.symbol} value={i.symbol}>
          {i.symbol} — {i.name}
        </option>
      ))}
    </select>
  );
}
