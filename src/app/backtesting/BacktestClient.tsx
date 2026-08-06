"use client";

import { useState } from "react";
import { BacktestBucket } from "@/lib/types";

type Dimension = "By score range" | "By asset class" | "By volatility regime" | "By risk regime";

export function BacktestClient({
  scoreRange,
  byAssetClass,
  byVolRegime,
  byRiskRegime,
}: {
  scoreRange: BacktestBucket[];
  byAssetClass: Record<string, BacktestBucket[]>;
  byVolRegime: Record<string, BacktestBucket[]>;
  byRiskRegime: Record<string, BacktestBucket[]>;
}) {
  const [dimension, setDimension] = useState<Dimension>("By score range");

  const groups: { label: string; buckets: BacktestBucket[] }[] =
    dimension === "By score range"
      ? [{ label: "All markets", buckets: scoreRange }]
      : dimension === "By asset class"
        ? Object.entries(byAssetClass).map(([label, buckets]) => ({ label, buckets }))
        : dimension === "By volatility regime"
          ? Object.entries(byVolRegime).map(([label, buckets]) => ({ label, buckets }))
          : Object.entries(byRiskRegime).map(([label, buckets]) => ({ label, buckets }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-lg border border-(--border) p-1 w-fit">
        {(["By score range", "By asset class", "By volatility regime", "By risk regime"] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDimension(d)}
            className={`h-8 px-3 rounded-md text-xs transition-colors ${dimension === d ? "bg-(--accent-soft) text-(--accent)" : "text-(--text-faint) hover:text-(--text-dim)"}`}
          >
            {d}
          </button>
        ))}
      </div>

      {groups.map((g) => (
        <div key={g.label} className="card p-4">
          <h3 className="text-sm font-semibold mb-3">{g.label}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[880px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
                  <th className="py-2 pr-3">Score range</th>
                  <th className="py-2 px-3 text-right">Sample</th>
                  <th className="py-2 px-3 text-right">Win rate 1d</th>
                  <th className="py-2 px-3 text-right">Win rate 5d</th>
                  <th className="py-2 px-3 text-right">Win rate 20d</th>
                  <th className="py-2 px-3 text-right">Avg return 1d</th>
                  <th className="py-2 px-3 text-right">Avg return 5d</th>
                  <th className="py-2 px-3 text-right">Avg return 20d</th>
                  <th className="py-2 px-3 text-right">Avg MFE</th>
                  <th className="py-2 pl-3 text-right">Avg MAE</th>
                </tr>
              </thead>
              <tbody>
                {g.buckets.map((b) => (
                  <tr key={b.scoreRange} className="border-b border-(--border) last:border-0">
                    <td className="py-2 pr-3 font-medium">{b.scoreRange}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-(--text-faint)">{b.sampleSize.toLocaleString()}</td>
                    <td className={`py-2 px-3 text-right tabular-nums ${b.winRate1d >= 50 ? "text-emerald-400" : "text-rose-400"}`}>{b.winRate1d}%</td>
                    <td className={`py-2 px-3 text-right tabular-nums ${b.winRate5d >= 50 ? "text-emerald-400" : "text-rose-400"}`}>{b.winRate5d}%</td>
                    <td className={`py-2 px-3 text-right tabular-nums ${b.winRate20d >= 50 ? "text-emerald-400" : "text-rose-400"}`}>{b.winRate20d}%</td>
                    <td className="py-2 px-3 text-right tabular-nums">{b.avgReturn1d > 0 ? "+" : ""}{b.avgReturn1d}%</td>
                    <td className="py-2 px-3 text-right tabular-nums">{b.avgReturn5d > 0 ? "+" : ""}{b.avgReturn5d}%</td>
                    <td className="py-2 px-3 text-right tabular-nums">{b.avgReturn20d > 0 ? "+" : ""}{b.avgReturn20d}%</td>
                    <td className="py-2 px-3 text-right tabular-nums text-emerald-400">+{b.avgMFE}%</td>
                    <td className="py-2 pl-3 text-right tabular-nums text-rose-400">{b.avgMAE}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
