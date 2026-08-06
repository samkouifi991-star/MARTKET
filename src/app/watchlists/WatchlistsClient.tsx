"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Watchlist } from "@/lib/types";
import { INSTRUMENTS } from "@/lib/instruments";
import { MarketRow } from "@/lib/market-data";
import { Card } from "@/components/ui/Card";
import { BiasBadge } from "@/components/ui/BiasBadge";
import { formatPrice, formatSigned, scoreColorClass } from "@/lib/format";
import { GripVertical, Plus, Trash2, X } from "lucide-react";

const STORAGE_KEY = "mi-watchlists";

export function WatchlistsClient({ defaults, rows }: { defaults: Watchlist[]; rows: MarketRow[] }) {
  const [lists, setLists] = useState<Watchlist[]>(defaults);
  const [activeId, setActiveId] = useState(defaults[0]?.id ?? "");
  const [newName, setNewName] = useState("");
  const [addSymbol, setAddSymbol] = useState(INSTRUMENTS[0].symbol);
  const [hydrated, setHydrated] = useState(false);

  // One-time hydration from localStorage after mount: SSR has no access to
  // localStorage, so the server-rendered defaults must be used for the first
  // paint and swapped in here to avoid a hydration mismatch.
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed: Watchlist[] = JSON.parse(stored);
        if (parsed.length > 0) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setLists(parsed);
          setActiveId(parsed[0].id);
        }
      } catch {
        // ignore corrupt local storage
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
  }, [lists, hydrated]);

  const active = lists.find((l) => l.id === activeId) ?? lists[0];
  const activeRows = rows.filter((r) => active?.symbols.includes(r.instrument.symbol));

  function createList() {
    if (!newName.trim()) return;
    const wl: Watchlist = { id: `wl-${Date.now()}`, name: newName.trim(), symbols: [] };
    setLists((prev) => [...prev, wl]);
    setActiveId(wl.id);
    setNewName("");
  }

  function renameList(id: string, name: string) {
    setLists((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)));
  }

  function deleteList(id: string) {
    setLists((prev) => prev.filter((l) => l.id !== id));
    if (activeId === id && lists.length > 1) setActiveId(lists.find((l) => l.id !== id)!.id);
  }

  function addSymbolToActive() {
    if (!active) return;
    setLists((prev) => prev.map((l) => (l.id === active.id && !l.symbols.includes(addSymbol) ? { ...l, symbols: [...l.symbols, addSymbol] } : l)));
  }

  function removeSymbol(symbol: string) {
    if (!active) return;
    setLists((prev) => prev.map((l) => (l.id === active.id ? { ...l, symbols: l.symbols.filter((s) => s !== symbol) } : l)));
  }

  function move(symbol: string, dir: -1 | 1) {
    if (!active) return;
    setLists((prev) =>
      prev.map((l) => {
        if (l.id !== active.id) return l;
        const idx = l.symbols.indexOf(symbol);
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= l.symbols.length) return l;
        const symbols = [...l.symbols];
        [symbols[idx], symbols[newIdx]] = [symbols[newIdx], symbols[idx]];
        return { ...l, symbols };
      })
    );
  }

  return (
    <div className="grid lg:grid-cols-[240px_1fr] gap-5">
      <div className="space-y-3">
        <Card title="Watchlists">
          <div className="space-y-1">
            {lists.map((l) => (
              <button
                key={l.id}
                onClick={() => setActiveId(l.id)}
                className={`w-full text-left rounded-lg px-2.5 py-2 text-sm flex items-center justify-between ${
                  l.id === activeId ? "bg-(--accent-soft) text-(--accent)" : "text-(--text-dim) hover:bg-white/[.04]"
                }`}
              >
                <span className="truncate">{l.name}</span>
                <span className="text-[10px] text-(--text-faint)">{l.symbols.length}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-(--border)">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New watchlist…"
              className="h-8 flex-1 min-w-0 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-xs outline-none"
            />
            <button onClick={createList} className="h-8 w-8 grid place-items-center rounded-lg bg-(--accent) text-white shrink-0">
              <Plus size={14} />
            </button>
          </div>
        </Card>
      </div>

      <div className="space-y-4 min-w-0">
        {active ? (
          <>
            <Card>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={active.name}
                  onChange={(e) => renameList(active.id, e.target.value)}
                  className="h-8 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-sm font-medium outline-none"
                />
                <select value={addSymbol} onChange={(e) => setAddSymbol(e.target.value)} className="h-8 rounded-lg border border-(--border) bg-(--bg-card) px-2 text-xs">
                  {INSTRUMENTS.map((i) => (
                    <option key={i.symbol} value={i.symbol}>{i.symbol}</option>
                  ))}
                </select>
                <button onClick={addSymbolToActive} className="h-8 flex items-center gap-1 rounded-lg border border-(--border) px-2.5 text-xs hover:border-(--border-strong)">
                  <Plus size={13} /> Add
                </button>
                <button onClick={() => deleteList(active.id)} className="h-8 flex items-center gap-1 rounded-lg border border-(--border) px-2.5 text-xs text-rose-400 hover:border-rose-400/40 ml-auto">
                  <Trash2 size={13} /> Delete watchlist
                </button>
              </div>
            </Card>

            <Card title={`${active.name} — instruments`}>
              {activeRows.length === 0 ? (
                <p className="text-sm text-(--text-faint)">No instruments yet. Add one above.</p>
              ) : (
                <div className="space-y-1.5">
                  {active.symbols.map((symbol) => {
                    const row = rows.find((r) => r.instrument.symbol === symbol);
                    if (!row) return null;
                    return (
                      <div key={symbol} className="flex items-center gap-2 py-1.5 border-b border-(--border) last:border-0">
                        <GripVertical size={13} className="text-(--text-faint) shrink-0" />
                        <Link href={`/markets/${symbol}`} className="font-medium text-sm hover:text-(--accent) w-24 shrink-0">{symbol}</Link>
                        <span className="text-xs text-(--text-faint) flex-1 min-w-0 truncate hidden sm:block">{row.instrument.name}</span>
                        <span className="tabular-nums text-sm w-20 text-right">{formatPrice(row.price.current, row.instrument.decimals)}</span>
                        <span className={`tabular-nums text-sm font-semibold w-16 text-right ${scoreColorClass(row.score.totalScore)}`}>{formatSigned(row.score.totalScore)}</span>
                        <div className="w-28 shrink-0"><BiasBadge bias={row.score.bias} size="sm" /></div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => move(symbol, -1)} className="text-(--text-faint) hover:text-(--text-dim) text-xs px-1">↑</button>
                          <button onClick={() => move(symbol, 1)} className="text-(--text-faint) hover:text-(--text-dim) text-xs px-1">↓</button>
                          <button onClick={() => removeSymbol(symbol)} className="text-(--text-faint) hover:text-rose-400 px-1"><X size={13} /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </>
        ) : (
          <Card>
            <p className="text-sm text-(--text-faint)">Create a watchlist to get started.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
