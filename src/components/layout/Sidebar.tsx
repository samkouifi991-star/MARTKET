"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DataMode } from "@/services/data-mode";
import {
  LayoutDashboard,
  ListOrdered,
  LineChart,
  Star,
  Building2,
  Users,
  GitCompareArrows,
  TrendingUp,
  CalendarClock,
  BarChart3,
  Percent,
  Briefcase,
  Landmark,
  Coins,
  ArrowLeftRight,
  Repeat,
  ShieldAlert,
  SlidersHorizontal,
  Newspaper,
  CalendarDays,
  Grid3x3,
  Gauge,
  Bell,
  History,
  Bot,
  Settings,
  ShieldCheck,
  PenSquare,
  Inbox,
  Activity,
  X,
} from "lucide-react";

type NavItem = { label: string; href: string; icon: React.ComponentType<{ size?: number; className?: string }>; demoOnly?: boolean };
type NavGroup = { title: string; items: NavItem[]; adminOnly?: boolean };

// Reorganized per the platform-redesign IA (Phase 10): Intelligence /
// Positioning / Economics / Risk & Events / Markets group every feature
// page around how a user actually thinks about it, rather than the flat
// build-order grouping this used to have. Admin is its own gated group —
// see isAdmin filtering below.
const NAV_GROUPS: NavGroup[] = [
  {
    title: "Intelligence",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Top Setups", href: "/top-setups", icon: ListOrdered },
      { label: "Forex Scorecard", href: "/forex-scorecard", icon: ArrowLeftRight },
    ],
  },
  {
    title: "Positioning",
    items: [
      { label: "Institutional Positioning", href: "/institutional", icon: Building2 },
      { label: "Retail Sentiment", href: "/retail-sentiment", icon: Users },
      { label: "Smart Money", href: "/smart-money", icon: GitCompareArrows },
    ],
  },
  {
    title: "Economics",
    items: [
      { label: "Economic Strength", href: "/economic-strength", icon: Coins },
      { label: "Economic Heatmap", href: "/economic-heatmap", icon: Grid3x3 },
      { label: "Growth", href: "/economic-growth", icon: BarChart3 },
      { label: "Inflation", href: "/inflation", icon: Percent },
      { label: "Labor", href: "/labor-market", icon: Briefcase },
      { label: "Interest Rates", href: "/interest-rates", icon: Landmark },
      { label: "Carry Trade Scanner", href: "/carry-trade", icon: Repeat },
    ],
  },
  {
    title: "Risk & Events",
    items: [
      { label: "News Intelligence", href: "/news", icon: Newspaper },
      { label: "Geopolitical Risk", href: "/geopolitical-risk", icon: ShieldAlert },
      { label: "Economic Calendar", href: "/economic-calendar", icon: CalendarDays },
      { label: "Risk Gauge", href: "/risk-gauge", icon: Gauge },
    ],
  },
  {
    title: "Markets",
    items: [
      { label: "Markets", href: "/markets", icon: LineChart },
      { label: "Market Heatmap", href: "/heatmap", icon: Grid3x3 },
      { label: "Watchlists", href: "/watchlists", icon: Star },
      { label: "Technical Trends", href: "/technical-trends", icon: TrendingUp },
      { label: "Seasonality", href: "/seasonality", icon: CalendarClock },
    ],
  },
  {
    title: "Tools",
    items: [
      { label: "Alerts", href: "/alerts", icon: Bell },
      // Phase 18 (public-launch demo sweep): every statistic on this page
      // (win rates, average returns, sample sizes) is RNG-generated, not
      // computed from real historical scores. Demo-only until a real
      // backtest can be computed from accumulated real score history.
      { label: "Backtesting", href: "/backtesting", icon: History, demoOnly: true },
      { label: "AI Analyst", href: "/ai-analyst", icon: Bot },
      // Phase 18 (public-launch demo sweep): put/call ratios, the VIX proxy,
      // Fear & Greed, and credit-spread readings have no real data source
      // anywhere in this codebase — demo-only, hidden from nav outside
      // demo mode rather than shown with fabricated numbers. See page.tsx.
      { label: "Options Sentiment", href: "/options-sentiment", icon: SlidersHorizontal, demoOnly: true },
    ],
  },
  {
    // Hidden from every non-admin user (see isAdmin filtering below) — was
    // previously rendered unconditionally for any logged-in user, a real
    // gap fixed in Phase 10 even though every /admin/* page already
    // independently re-checks via requireAdmin() server-side.
    title: "Admin",
    adminOnly: true,
    items: [
      { label: "Admin Home", href: "/admin", icon: ShieldCheck },
      { label: "Data Entry", href: "/admin/data-entry", icon: PenSquare },
      { label: "Incoming Data", href: "/admin/incoming-data", icon: Inbox },
      { label: "Pipeline Health", href: "/admin/pipeline-health", icon: Activity },
      { label: "Scoring Configuration", href: "/admin/scoring-configuration", icon: SlidersHorizontal },
    ],
  },
  {
    title: "Account",
    items: [{ label: "Settings", href: "/settings", icon: Settings }],
  },
];

export function Sidebar({ open, onClose, dataMode, isAdmin }: { open: boolean; onClose: () => void; dataMode: DataMode; isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-dvh w-64 shrink-0 overflow-y-auto border-r border-(--border) bg-(--bg-elevated) transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 h-16 border-b border-(--border)">
          <Link href="/" className="flex items-center gap-2" onClick={onClose}>
            <span className="grid place-items-center w-8 h-8 rounded-lg bg-gradient-to-br from-(--accent) to-cyan-400 text-white font-bold text-sm">
              MI
            </span>
            <span className="font-semibold tracking-tight text-(--text)">Market Intelligence AI</span>
          </Link>
          <button onClick={onClose} className="lg:hidden text-(--text-dim)">
            <X size={20} />
          </button>
        </div>

        <nav className="px-3 py-4 space-y-5">
          {NAV_GROUPS.filter((group) => !group.adminOnly || isAdmin).map((group) => (
            <div key={group.title}>
              <div className="px-2 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-(--text-faint)">
                {group.title}
              </div>
              <div className="space-y-0.5">
                {group.items.filter((item) => !item.demoOnly || dataMode === "demo").map((item) => {
                  const active = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                        active
                          ? "bg-(--accent-soft) text-(--accent) font-medium"
                          : "text-(--text-dim) hover:text-(--text) hover:bg-white/[.04]"
                      }`}
                    >
                      <Icon size={16} className="shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
