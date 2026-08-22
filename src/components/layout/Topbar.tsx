"use client";

import { Menu, Bell } from "lucide-react";
import { SearchBar } from "./SearchBar";
import { ThemeToggle } from "./ThemeToggle";
import Link from "next/link";
import { DataMode } from "@/services/data-mode";
import type { SessionUser } from "./AppShell";

const MODE_LABEL: Record<DataMode, string> = {
  demo: "Demo Data Mode",
  hybrid: "Hybrid Data Mode",
  live: "Live Data Mode",
};

const MODE_CLASSES: Record<DataMode, string> = {
  demo: "border-(--border) text-(--text-dim)",
  hybrid: "border-amber-500/40 text-amber-400 bg-amber-500/10",
  live: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10",
};

function initials(user: SessionUser | null): string {
  if (!user) return "?";
  if (user.name) {
    const parts = user.name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return user.email.slice(0, 2).toUpperCase();
}

export function Topbar({ onMenu, dataMode, user }: { onMenu: () => void; dataMode: DataMode; user: SessionUser | null }) {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 h-16 px-4 border-b border-(--border) bg-(--bg)/80 backdrop-blur">
      <button onClick={onMenu} className="lg:hidden text-(--text-dim)" aria-label="Open menu">
        <Menu size={20} />
      </button>
      <SearchBar />
      <div className="ml-auto flex items-center gap-2">
        <span className={`hidden sm:inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${MODE_CLASSES[dataMode]}`}>
          {MODE_LABEL[dataMode]}
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
          title={user?.email}
        >
          {initials(user)}
        </Link>
      </div>
    </header>
  );
}
