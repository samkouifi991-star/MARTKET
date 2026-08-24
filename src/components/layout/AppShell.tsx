"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { DISCLAIMER } from "@/lib/config";
import { DataMode } from "@/services/data-mode";

export type SessionUser = { id: number; email: string; name: string | null };

// Public marketing/auth pages render their own full-bleed header/footer
// (see app/(marketing)) — they must never show the authenticated app's
// Sidebar/Topbar. Kept as simple prefix matches (not a route group) so the
// existing app pages didn't need to move on disk for this — see proxy.ts
// for the equivalent public/protected split used for redirects.
const MARKETING_PREFIXES = ["/signup", "/signin", "/pricing", "/legal", "/paywall"];

function isMarketingPath(pathname: string): boolean {
  return pathname === "/" || MARKETING_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function AppShell({ children, dataMode, user }: { children: React.ReactNode; dataMode: DataMode; user: SessionUser | null }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  if (isMarketingPath(pathname)) return <>{children}</>;

  return (
    <div className="flex min-h-dvh">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} dataMode={dataMode} />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar onMenu={() => setSidebarOpen(true)} dataMode={dataMode} user={user} />
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
