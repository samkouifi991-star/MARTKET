"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { HeatmapGrid, HeatCell } from "@/components/charts/HeatmapGrid";
import { MarketRow } from "@/lib/market-data";
import { formatSigned, formatSignedPct } from "@/lib/format";

type Mode = "Performance" | "Fundamental score" | "Sentiment" | "Volatility" | "Score change";

function volatility(prices: number[]): number {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  const recent = returns.slice(-20);
  const mean = recent.reduce((s, v) => s + v, 0) / recent.length;
  const variance = recent.reduce((s, v) => s + (v - mean) ** 2, 0) / recent.length;
  return Math.sqrt(variance) * 100;
}

export function HeatmapClient({ rows }: { rows: MarketRow[] }) {
  const [mode, setMode] = useState<Mode>("Performance");
  const router = useRouter();

  const { cells, maxAbs } = useMemo(() => {
    const built: HeatCell[] = rows.map((r) => {
      switch (mode) {
        case "Performance":
          return { symbol: r.instrument.symbol, name: r.instrument.name, value: r.price.changePct24h, displayValue: formatSignedPct(r.price.changePct24h) };
        case "Fundamental score":
          return { symbol: r.instrument.symbol, name: r.instrument.name, value: r.score.totalScore, displayValue: formatSigned(r.score.totalScore) };
        case "Sentiment": {
          const inst = r.score.factors.find((f) => f.key === "institutional")!.contribution;
          const retail = r.score.factors.find((f) => f.key === "retailSentiment")!.contribution;
          const value = inst + retail;
          return { symbol: r.instrument.symbol, name: r.instrument.name, value, displayValue: formatSigned(value) };
        }
        case "Volatility": {
          const vol = volatility(r.price.series.map((p) => p.price));
          return { symbol: r.instrument.symbol, name: r.instrument.name, value: vol, displayValue: `${vol.toFixed(2)}%` };
        }
        case "Score change":
          return { symbol: r.instrument.symbol, name: r.instrument.name, value: r.score.change24h, displayValue: formatSigned(r.score.change24h) };
      }
    });
    const maxAbs = Math.max(...built.map((c) => Math.abs(c.value)), 1);
    return { cells: built, maxAbs };
  }, [rows, mode]);

  const modes: Mode[] = ["Performance", "Fundamental score", "Sentiment", "Volatility", "Score change"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-lg border border-(--border) p-1 w-fit">
        {modes.map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`h-8 px-3 rounded-md text-xs transition-colors ${mode === m ? "bg-(--accent-soft) text-(--accent)" : "text-(--text-faint) hover:text-(--text-dim)"}`}
          >
            {m}
          </button>
        ))}
      </div>
      <HeatmapGrid cells={cells} maxAbs={mode === "Volatility" ? maxAbs : maxAbs} onSelect={(symbol) => router.push(`/markets/${symbol}`)} />
    </div>
  );
}
