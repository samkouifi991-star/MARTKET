"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown } from "lucide-react";
import { MarketRow } from "@/lib/market-data";
import { AssetClass, ScoreFactorKey } from "@/lib/types";
import { ASSET_CLASSES } from "@/lib/instruments";
import { BiasBadge } from "@/components/ui/BiasBadge";
import { ConfidenceBar } from "@/components/ui/ConfidenceBar";
import { formatPrice, formatSigned, formatSignedPct, scoreColorClass } from "@/lib/format";
import { formatRelative } from "@/lib/time";
import { factorLabel } from "@/lib/scoring";
import { Sparkline } from "@/components/ui/Sparkline";

const FACTOR_COLUMNS: { key: ScoreFactorKey; label: string }[] = [
  { key: "institutional", label: "Inst." },
  { key: "retailSentiment", label: "Retail" },
  { key: "technical", label: "Tech." },
  { key: "seasonality", label: "Season." },
  { key: "economicGrowth", label: "Growth" },
  { key: "inflation", label: "Inflation" },
  { key: "labor", label: "Labor" },
  { key: "interestRates", label: "Rates" },
  { key: "news", label: "News" },
];

type SortKey = "bullish" | "bearish" | "confidence" | "change" | "recent";

export function TopSetupsTable({ rows, watchlistSymbols }: { rows: MarketRow[]; watchlistSymbols?: string[] }) {
  const [assetClass, setAssetClass] = useState<AssetClass | "All">("All");
  const [biasFilter, setBiasFilter] = useState<"All" | "Bullish only" | "Bearish only">("All");
  const [minConfidence, setMinConfidence] = useState(0);
  const [minAbsScore, setMinAbsScore] = useState(0);
  const [recentOnly, setRecentOnly] = useState(false);
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("bullish");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let out = rows.slice();
    if (assetClass !== "All") out = out.filter((r) => r.instrument.assetClass === assetClass);
    if (biasFilter === "Bullish only") out = out.filter((r) => r.score.totalScore > 0);
    if (biasFilter === "Bearish only") out = out.filter((r) => r.score.totalScore < 0);
    if (minConfidence > 0) out = out.filter((r) => r.score.confidence >= minConfidence);
    if (minAbsScore > 0) out = out.filter((r) => Math.abs(r.score.totalScore) >= minAbsScore);
    if (recentOnly) out = out.filter((r) => Math.abs(r.score.change24h) >= 1.5);
    if (watchlistOnly && watchlistSymbols) out = out.filter((r) => watchlistSymbols.includes(r.instrument.symbol));
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((r) => r.instrument.symbol.toLowerCase().includes(q) || r.instrument.name.toLowerCase().includes(q));
    }

    switch (sortKey) {
      case "bullish":
        out.sort((a, b) => b.score.totalScore - a.score.totalScore);
        break;
      case "bearish":
        out.sort((a, b) => a.score.totalScore - b.score.totalScore);
        break;
      case "confidence":
        out.sort((a, b) => b.score.confidence - a.score.confidence);
        break;
      case "change":
        out.sort((a, b) => Math.abs(b.score.change24h) - Math.abs(a.score.change24h));
        break;
      case "recent":
        out.sort((a, b) => new Date(b.score.lastUpdated).getTime() - new Date(a.score.lastUpdated).getTime());
        break;
    }
    return out;
  }, [rows, assetClass, biasFilter, minConfidence, minAbsScore, recentOnly, watchlistOnly, watchlistSymbols, search, sortKey]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter markets…"
          className="h-8 rounded-lg border border-(--border) bg-(--bg-card) px-3 text-xs outline-none placeholder:text-(--text-faint) w-40"
        />
        <Select
          value={assetClass}
          onChange={(v) => setAssetClass(v as AssetClass | "All")}
          options={["All", ...ASSET_CLASSES]}
        />
        <Select value={biasFilter} onChange={(v) => setBiasFilter(v as typeof biasFilter)} options={["All", "Bullish only", "Bearish only"]} />
        <NumberFilter label="Min confidence" value={minConfidence} onChange={setMinConfidence} max={100} step={10} />
        <NumberFilter label="Min |score|" value={minAbsScore} onChange={setMinAbsScore} max={10} step={1} />
        <Toggle label="Recently changed" active={recentOnly} onClick={() => setRecentOnly((v) => !v)} />
        {watchlistSymbols && <Toggle label="Watchlist only" active={watchlistOnly} onClick={() => setWatchlistOnly((v) => !v)} />}
        <div className="ml-auto flex items-center gap-1 text-xs text-(--text-faint)">
          <ChevronsUpDown size={13} />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="bg-transparent outline-none text-(--text-dim)"
          >
            <option value="bullish">Strongest bullish</option>
            <option value="bearish">Strongest bearish</option>
            <option value="confidence">Highest confidence</option>
            <option value="change">Largest daily change</option>
            <option value="recent">Most recent update</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto card">
        <table className="w-full text-sm min-w-[1400px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-(--text-faint) border-b border-(--border)">
              <th className="px-3 py-2.5 sticky left-0 bg-(--bg-card) z-10">Market</th>
              <th className="px-3 py-2.5 text-right">Price</th>
              <th className="px-3 py-2.5 text-right">Total Score</th>
              <th className="px-3 py-2.5">Bias</th>
              <th className="px-3 py-2.5">Confidence</th>
              <th className="px-3 py-2.5 text-right">24h Δ</th>
              {FACTOR_COLUMNS.map((f) => (
                <th key={f.key} className="px-3 py-2.5 text-right">{f.label}</th>
              ))}
              <th className="px-3 py-2.5 text-right">Updated</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const isOpen = expanded === row.instrument.symbol;
              const topFactors = [...row.score.factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 3);
              return (
                <Fragment key={row.instrument.symbol}>
                  <tr
                    className="border-b border-(--border) last:border-0 hover:bg-white/[.02] cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : row.instrument.symbol)}
                  >
                    <td className="px-3 py-2.5 sticky left-0 bg-(--bg-card)">
                      <div className="flex items-center gap-1.5">
                        {isOpen ? <ChevronDown size={13} className="text-(--text-faint)" /> : <ChevronRight size={13} className="text-(--text-faint)" />}
                        <div>
                          <Link
                            href={`/markets/${row.instrument.symbol}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-medium hover:text-(--accent)"
                          >
                            {row.instrument.symbol}
                          </Link>
                          <div className="text-[11px] text-(--text-faint)">{row.instrument.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatPrice(row.price.current, row.instrument.decimals)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${scoreColorClass(row.score.totalScore)}`}>
                      {formatSigned(row.score.totalScore)}
                    </td>
                    <td className="px-3 py-2.5"><BiasBadge bias={row.score.bias} size="sm" /></td>
                    <td className="px-3 py-2.5"><ConfidenceBar value={row.score.confidence} compact /></td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${scoreColorClass(row.score.change24h)}`}>
                      <div className="flex items-center justify-end gap-1">
                        {row.score.change24h >= 0 ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        {formatSigned(row.score.change24h)}
                      </div>
                    </td>
                    {FACTOR_COLUMNS.map((f) => {
                      const factor = row.score.factors.find((x) => x.key === f.key)!;
                      return (
                        <td key={f.key} className={`px-3 py-2.5 text-right tabular-nums ${scoreColorClass(factor.contribution)}`}>
                          {formatSigned(factor.contribution)}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-right text-(--text-faint) text-xs">{formatRelative(row.score.lastUpdated)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-(--border) bg-white/[.015]">
                      <td colSpan={7 + FACTOR_COLUMNS.length} className="px-6 py-4">
                        <div className="grid sm:grid-cols-3 gap-4">
                          {topFactors.map((f) => (
                            <div key={f.key} className="text-xs">
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-medium text-(--text)">{factorLabel(f.key)}</span>
                                <span className={scoreColorClass(f.contribution)}>{formatSigned(f.contribution)}</span>
                              </div>
                              <p className="text-(--text-faint) leading-relaxed">{f.explanation}</p>
                            </div>
                          ))}
                          <div className="sm:col-span-3 flex items-center justify-between pt-1 border-t border-(--border)">
                            <div className="flex items-center gap-3">
                              <span className="text-[11px] text-(--text-faint)">30-day score trend</span>
                              <Sparkline data={row.score.history.map((h) => h.score)} />
                            </div>
                            <Link href={`/markets/${row.instrument.symbol}`} className="text-xs text-(--accent) hover:underline">
                              View full breakdown →
                            </Link>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-sm text-(--text-faint)">No markets match the current filters.</div>
        )}
      </div>
      <p className="text-xs text-(--text-faint) mt-2">
        Showing {filtered.length} of {rows.length} markets. 24h Δ shown for reference — {formatSignedPct(0)} baseline.
      </p>
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-xs outline-none text-(--text-dim)"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function NumberFilter({ label, value, onChange, max, step }: { label: string; value: number; onChange: (v: number) => void; max: number; step: number }) {
  return (
    <label className="flex items-center gap-1.5 h-8 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-xs text-(--text-faint)">
      {label}
      <input
        type="number"
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-10 bg-transparent outline-none text-(--text-dim)"
      />
    </label>
  );
}

function Toggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`h-8 rounded-lg border px-2.5 text-xs transition-colors ${
        active ? "border-(--accent) text-(--accent) bg-(--accent-soft)" : "border-(--border) text-(--text-faint) hover:text-(--text-dim)"
      }`}
    >
      {label}
    </button>
  );
}
