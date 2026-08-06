"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { INSTRUMENTS } from "@/lib/instruments";

export function SearchBar() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return INSTRUMENTS.filter((i) => i.symbol.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query]);

  function go(symbol: string) {
    setOpen(false);
    setQuery("");
    router.push(`/markets/${symbol}`);
  }

  return (
    <div className="relative w-full max-w-md" ref={containerRef}>
      <div className="flex items-center gap-2 rounded-lg border border-(--border) bg-(--bg-card) px-3 h-9">
        <Search size={15} className="text-(--text-faint) shrink-0" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) go(results[0].symbol);
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search markets… (e.g. EURUSD, Gold)"
          className="w-full bg-transparent text-sm outline-none placeholder:text-(--text-faint)"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute mt-1 w-full rounded-lg border border-(--border-strong) bg-(--bg-elevated) shadow-xl overflow-hidden z-50">
          {results.map((r) => (
            <button
              key={r.symbol}
              onMouseDown={() => go(r.symbol)}
              className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-white/[.05] text-left"
            >
              <span className="font-medium">{r.symbol}</span>
              <span className="text-(--text-faint) text-xs">{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
