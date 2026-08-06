"use client";

import { Menu, Bell } from "lucide-react";
import { SearchBar } from "./SearchBar";
import { ThemeToggle } from "./ThemeToggle";
import Link from "next/link";

export function Topbar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 h-16 px-4 border-b border-(--border) bg-(--bg)/80 backdrop-blur">
      <button onClick={onMenu} className="lg:hidden text-(--text-dim)" aria-label="Open menu">
        <Menu size={20} />
      </button>
      <SearchBar />
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden sm:inline-flex items-center rounded-full border border-(--border) px-2.5 py-1 text-[11px] font-medium text-(--text-dim)">
          Demo Data Mode
        </span>
        <Link
          href="/alerts"
          className="grid place-items-center w-9 h-9 rounded-lg border border-(--border) text-(--text-dim) hover:text-(--text) hover:border-(--border-strong) transition-colors"
          aria-label="Alerts"
        >
          <Bell size={16} />
        </Link>
        <ThemeToggle />
        <Link
          href="/settings"
          className="grid place-items-center w-9 h-9 rounded-full bg-gradient-to-br from-(--accent) to-cyan-400 text-white text-xs font-semibold"
        >
          JT
        </Link>
      </div>
    </header>
  );
}
