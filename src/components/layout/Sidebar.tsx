"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  X,
} from "lucide-react";

type NavItem = { label: string; href: string; icon: React.ComponentType<{ size?: number; className?: string }> };
type NavGroup = { title: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Top Setups", href: "/top-setups", icon: ListOrdered },
      { label: "Markets", href: "/markets", icon: LineChart },
      { label: "Watchlists", href: "/watchlists", icon: Star },
    ],
  },
  {
    title: "Positioning & Flow",
    items: [
      { label: "Institutional Positioning", href: "/institutional", icon: Building2 },
      { label: "Retail Sentiment", href: "/retail-sentiment", icon: Users },
      { label: "Smart Money", href: "/smart-money", icon: GitCompareArrows },
    ],
  },
  {
    title: "Analysis",
    items: [
      { label: "Technical Trends", href: "/technical-trends", icon: TrendingUp },
      { label: "Seasonality", href: "/seasonality", icon: CalendarClock },
    ],
  },
  {
    title: "Macro",
    items: [
      { label: "Economic Growth", href: "/economic-growth", icon: BarChart3 },
      { label: "Inflation", href: "/inflation", icon: Percent },
      { label: "Labor Market", href: "/labor-market", icon: Briefcase },
      { label: "Interest Rates", href: "/interest-rates", icon: Landmark },
      { label: "Options Sentiment", href: "/options-sentiment", icon: SlidersHorizontal },
    ],
  },
  {
    title: "Intelligence",
    items: [
      { label: "News Intelligence", href: "/news", icon: Newspaper },
      { label: "Economic Calendar", href: "/economic-calendar", icon: CalendarDays },
      { label: "Market Heatmap", href: "/heatmap", icon: Grid3x3 },
      { label: "Risk Gauge", href: "/risk-gauge", icon: Gauge },
    ],
  },
  {
    title: "Tools",
    items: [
      { label: "Alerts", href: "/alerts", icon: Bell },
      { label: "Backtesting", href: "/backtesting", icon: History },
      { label: "AI Analyst", href: "/ai-analyst", icon: Bot },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "Settings", href: "/settings", icon: Settings },
      { label: "Admin", href: "/admin", icon: ShieldCheck },
    ],
  },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
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
          {NAV_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="px-2 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-(--text-faint)">
                {group.title}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
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
