// Explore Market Intelligence Features — Phase 12 of the platform
// redesign. A public feature catalog, one card per real live feature,
// each linking to its actual page. Original copy throughout — no
// third-party product naming or wording reused.
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { verifySession } from "@/lib/auth/dal";
import {
  ListOrdered,
  ArrowLeftRight,
  Building2,
  Users,
  TrendingUp,
  Coins,
  Grid3x3,
  Briefcase,
  BarChart3,
  Percent,
  Landmark,
  Repeat,
  ShieldAlert,
  Newspaper,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

export const metadata = { title: "Explore Market Intelligence Features — Market Intelligence AI" };
export const dynamic = "force-dynamic";

type Feature = { icon: LucideIcon; title: string; description: string; href: string };

const FEATURES: Feature[] = [
  {
    icon: ArrowLeftRight,
    title: "Scorecard",
    description: "The main deep-dive for any market — Forex, Gold/Silver, Indices, or Crypto. One transparent -10..+10 score, why it exists, which factors agree or conflict, and what changed recently, with FX pairs additionally showing base-vs-quote Economic Strength, rate, and economic-surprise differentials.",
    href: "/scorecard",
  },
  {
    icon: ListOrdered,
    title: "Top Setups",
    description: "Every supported market ranked by total score in one filterable, sortable table — the fastest way to see where conditions are strongest right now.",
    href: "/top-setups",
  },
  {
    icon: Building2,
    title: "Institutional Positioning",
    description: "CFTC Commitment-of-Traders-style large-speculator positioning, with weekly change and historical percentile — crowded positioning is flagged, not assumed automatically bullish.",
    href: "/institutional",
  },
  {
    icon: Users,
    title: "Retail Sentiment",
    description: "Live long/short positioning from broker sentiment feeds, read contrarian at sustained extremes rather than taken at face value.",
    href: "/retail-sentiment",
  },
  {
    icon: TrendingUp,
    title: "Economic Surprise Index",
    description: "Actual-vs-forecast releases scored against their own historical distribution, adjusted for prior-period revisions, importance, and each asset's real transmission direction — deterministic math, never a guessed sign.",
    href: "/economic-calendar",
  },
  {
    icon: Coins,
    title: "Economic Strength Index",
    description: "A composite score per currency combining growth, labor market health, relative policy-rate positioning, and recent economic-surprise momentum — real FRED data, ranked across all 8 tracked currencies.",
    href: "/economic-strength",
  },
  {
    icon: Grid3x3,
    title: "Economic Heatmap",
    description: "Currency × factor grid — growth, inflation, labor, rates, and surprise — banded from Strong Bullish to Strong Bearish for a fast cross-market scan.",
    href: "/economic-heatmap",
  },
  {
    icon: Briefcase,
    title: "Labor Market Tracker",
    description: "Unemployment, payrolls, initial claims, wage growth, and labor participation for every tracked currency, from the same real FRED data feeding the scoring engine.",
    href: "/labor-market",
  },
  {
    icon: BarChart3,
    title: "Growth Tracker",
    description: "Real GDP, industrial production, and retail sales per currency — the same growth score used across the Economic Heatmap and Economic Strength Index.",
    href: "/economic-growth",
  },
  {
    icon: Percent,
    title: "Inflation Tracker",
    description: "CPI, core CPI, PCE, core PCE, and PPI per currency, scored with the understanding that inflation cuts differently for currencies, equities, and metals.",
    href: "/inflation",
  },
  {
    icon: Landmark,
    title: "Interest Rates",
    description: "Real policy rates and recent trend direction per currency, feeding every rate-differential read across the Forex Scorecard and Carry Trade Scanner.",
    href: "/interest-rates",
  },
  {
    icon: Repeat,
    title: "Carry Trade Scanner",
    description: "FX pairs ranked by policy-rate differential, checked against the Economic Strength differential to see whether the carry is fundamentally supported or fighting the trend.",
    href: "/carry-trade",
  },
  {
    icon: ShieldAlert,
    title: "Geopolitical Risk Tracker",
    description: "A live global risk level with safe-haven, energy, trade-tariff, and monetary-policy sub-scores, built entirely from classified real news — time-decayed so old headlines fade, never a permanent re-rating from one story.",
    href: "/geopolitical-risk",
  },
  {
    icon: Grid3x3,
    title: "Market Heatmap",
    description: "Every tracked instrument's current score at a glance, color-banded for an instant read on where strength and weakness sit across the board.",
    href: "/heatmap",
  },
  {
    icon: Newspaper,
    title: "News Intelligence",
    description: "Headlines classified for market impact, affected instruments, and risk sentiment from the actual text supplied — the classifier never invents a story that wasn't given to it.",
    href: "/news",
  },
  {
    icon: HelpCircle,
    title: "“Why This Score?”",
    description: "Every score traces back to its exact contributing factors — open any market to see the full attribution, in plain language, down to the individual data point.",
    href: "/markets",
  },
];

export default async function FeaturesPage() {
  const sessionUser = await verifySession();
  const user = sessionUser ? { email: sessionUser.email } : null;

  return (
    <div className="min-h-dvh flex flex-col">
      <MarketingNav user={user} />

      <main className="flex-1">
        <section className="max-w-3xl mx-auto px-4 sm:px-6 pt-16 pb-10 text-center">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Explore Market Intelligence Features</h1>
          <p className="mt-3 text-(--text-dim)">One transparent scoring system, broken into the tools that make it useful day to day — every card below links to the real, live page.</p>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <Link key={f.title} href={f.href} className="card p-4 hover:border-(--border-strong) transition-colors flex flex-col">
                  <div className="grid place-items-center w-9 h-9 rounded-lg bg-(--accent-soft) text-(--accent) mb-3">
                    <Icon size={18} />
                  </div>
                  <h3 className="font-medium text-sm">{f.title}</h3>
                  <p className="text-xs text-(--text-faint) leading-relaxed mt-1.5 flex-1">{f.description}</p>
                  <span className="text-xs text-(--accent) mt-3 inline-block">Explore →</span>
                </Link>
              );
            })}
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
