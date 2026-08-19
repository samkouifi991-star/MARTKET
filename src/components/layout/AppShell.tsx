"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { DISCLAIMER } from "@/lib/config";
import { DataMode } from "@/services/data-mode";

export function AppShell({ children, dataMode }: { children: React.ReactNode; dataMode: DataMode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-dvh">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar onMenu={() => setSidebarOpen(true)} dataMode={dataMode} />
        <main className="flex-1 min-w-0 px-4 sm:px-6 py-6 max-w-[1600px] w-full mx-auto">{children}</main>
        <footer className="border-t border-(--border) px-4 sm:px-6 py-4">
          <p className="text-[11px] leading-relaxed text-(--text-faint) max-w-4xl">
            <strong className="text-(--text-dim)">Disclaimer:</strong> {DISCLAIMER}
          </p>
        </footer>
      </div>
    </div>
  );
}
