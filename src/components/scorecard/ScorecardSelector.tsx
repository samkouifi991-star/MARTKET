"use client";

// Searchable market selector for /scorecard — the single entry point into
// the canonical per-instrument Scorecard (markets/[symbol]) for every
// asset class. Reads the same MarketRow[] every other list page already
// reads (getCanonicalMarketRows) — no new data logic, just a search-first
// way to get to one market's Scorecard instead of a grouped browse table
// (see /markets for that).
import { useMemo, useState } from "react";
import Link from "next/link";
import { MarketRow } from "@/lib/market-data";
import { AssetClass } from "@/lib/types";
import { ASSET_CLASSES } from "@/lib/instruments";
import { BiasBadge } from "@/components/ui/BiasBadge";
import { formatPrice, formatSigned, scoreColorClass } from "@/lib/format";
import { Search } from "lucide-react";

export function ScorecardSelector({ rows }: { rows: MarketRow[] }) {
  const [search, setSearch] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass | "All">("All");

  const filtered = useMemo(() => {
    let out = rows;
    if (assetClass !== "All") out = out.filter((r) => r.instrument.assetClass === assetClass);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r) => r.instrument.symbol.toLowerCase().includes(q) || r.instrument.name.toLowerCase().includes(q));
    }
    return [...out].sort((a, b) => a.instrument.symbol.localeCompare(b.instrument.symbol));
  }, [rows, assetClass, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--text-faint)" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search any market…"
            autoFocus
            className="h-9 w-56 rounded-lg border border-(--border) bg-(--bg-card) pl-8 pr-3 text-sm outline-none placeholder:text-(--text-faint)"
          />
        </div>
        <button
          type="button"
          onClick={() => setAssetClass("All")}
          className={`h-9 rounded-lg border px-3 text-xs transition-colors ${assetClass === "All" ? "border-(--accent) text-(--accent) bg-(--accent-soft)" : "border-(--border) text-(--text-faint) hover:text-(--text-dim)"}`}
        >
          All
        </button>
        {ASSET_CLASSES.map((cls) => (
          <button
            key={cls}
            type="button"
            onClick={() => setAssetClass(cls)}
            className={`h-9 rounded-lg border px-3 text-xs transition-colors ${assetClass === cls ? "border-(--accent) text-(--accent) bg-(--accent-soft)" : "border-(--border) text-(--text-faint) hover:text-(--text-dim)"}`}
          >
            {cls}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => (
            <Link
              key={r.instrument.symbol}
              href={`/markets/${r.instrument.symbol}`}
              className="flex items-center justify-between gap-3 px-4 py-3 border-b border-(--border) hover:bg-white/[.03] transition-colors"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm">{r.instrument.symbol}</div>
                <div className="text-xs text-(--text-faint) truncate">{r.instrument.name}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs tabular-nums text-(--text-faint)">{formatPrice(r.price.current, r.instrument.decimals)}</div>
                <div className="flex items-center gap-1.5 justify-end mt-0.5">
                  <span className={`text-xs font-semibold tabular-nums ${scoreColorClass(r.score.totalScore)}`}>{formatSigned(r.score.totalScore)}</span>
                  <BiasBadge bias={r.score.bias} size="sm" />
                </div>
              </div>
            </Link>
          ))}
        </div>
        {filtered.length === 0 && <p className="py-10 text-center text-sm text-(--text-faint)">No markets match &quot;{search}&quot;.</p>}
      </div>
    </div>
  );
}
