import Link from "next/link";
import { getDashboardMarketRows } from "@/lib/pipeline/dashboard";
import { StatTile } from "@/components/ui/StatTile";
import { Card } from "@/components/ui/Card";
import { AutoRefresh } from "@/components/ui/AutoRefresh";
import { formatSigned, scoreColorClass } from "@/lib/format";
import { generateRiskGauge } from "@/lib/demo/riskGauge";
import { NEWS_ARTICLES } from "@/lib/demo/news";
import { upcomingHighImpact } from "@/lib/demo/calendar";
import { formatDateTime, formatRelative } from "@/lib/time";
import { INSTRUMENTS } from "@/lib/instruments";
import { generateSmartMoney } from "@/lib/demo/smartMoney";
import { ArrowRight, Gauge } from "lucide-react";

// Without this, the Dashboard would be prerendered once at build time and
// serve that frozen HTML forever — defeating the canonical current-score
// read below, which must reflect Neon's latest state on every visit. See
// /top-setups and /markets/[symbol] for the same rule already applied.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const rows = await getDashboardMarketRows();
  // Only markets with a genuine canonical score AND no demo-fallback
  // exposure (strict-live symbols) feed the rankings/counts below — see
  // pipeline/dashboard.ts's DashboardMarketRow.eligible for why a
  // non-strict-live symbol's current score can't be trusted for this.
  const eligible = rows.filter((r) => r.eligible && r.score);
  const blockedCount = rows.length - eligible.length;
  const sorted = [...eligible].sort((a, b) => b.score!.totalScore - a.score!.totalScore);
  const topBullish = sorted.slice(0, 5);
  const topBearish = sorted.slice(-5).reverse();
  const avgConfidence = eligible.length > 0 ? Math.round(eligible.reduce((s, r) => s + r.score!.confidence, 0) / eligible.length) : 0;
  const veryBullish = eligible.filter((r) => r.score!.bias === "Very Bullish").length;
  const veryBearish = eligible.filter((r) => r.score!.bias === "Very Bearish").length;

  const risk = generateRiskGauge();
  const topNews = [...NEWS_ARTICLES].sort((a, b) => b.importance - a.importance).slice(0, 4);
  const events = upcomingHighImpact(72).slice(0, 4);
  const divergences = INSTRUMENTS.map((i) => generateSmartMoney(i)).filter((d) => d.signal !== "None").slice(0, 3);

  return (
    <div className="space-y-6">
      <AutoRefresh intervalSeconds={45} />
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Which markets have the strongest conditions right now, what&apos;s driving them, and what changed recently.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile
          label="Markets tracked"
          value={String(rows.length)}
          sub={blockedCount > 0 ? `${eligible.length} live · ${blockedCount} pending coverage` : "Across 4 asset classes"}
        />
        <StatTile label="Very Bullish" value={String(veryBullish)} valueClassName="text-emerald-400" sub="Score ≥ +8" />
        <StatTile label="Very Bearish" value={String(veryBearish)} valueClassName="text-rose-400" sub="Score ≤ -8" />
        <StatTile label="Avg. confidence" value={`${avgConfidence}%`} sub="Across all markets" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Strongest bullish conditions" action={<Link href="/top-setups" className="text-xs text-(--accent) hover:underline">View all →</Link>} className="lg:col-span-1">
          <ul className="space-y-2.5">
            {topBullish.map((r) => (
              <li key={r.instrument.symbol}>
                <Link href={`/markets/${r.instrument.symbol}`} className="flex items-center justify-between text-sm hover:text-(--accent)">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium">{r.instrument.symbol}</span>
                    <span className="text-(--text-faint) text-xs truncate hidden sm:inline">{r.instrument.name}</span>
                  </div>
                  <span className={`tabular-nums font-semibold ${scoreColorClass(r.score!.totalScore)}`}>{formatSigned(r.score!.totalScore)}</span>
                </Link>
              </li>
            ))}
            {topBullish.length === 0 && <p className="text-xs text-(--text-faint)">No live-scored markets available yet.</p>}
          </ul>
        </Card>

        <Card title="Strongest bearish conditions" action={<Link href="/top-setups" className="text-xs text-(--accent) hover:underline">View all →</Link>}>
          <ul className="space-y-2.5">
            {topBearish.map((r) => (
              <li key={r.instrument.symbol}>
                <Link href={`/markets/${r.instrument.symbol}`} className="flex items-center justify-between text-sm hover:text-(--accent)">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium">{r.instrument.symbol}</span>
                    <span className="text-(--text-faint) text-xs truncate hidden sm:inline">{r.instrument.name}</span>
                  </div>
                  <span className={`tabular-nums font-semibold ${scoreColorClass(r.score!.totalScore)}`}>{formatSigned(r.score!.totalScore)}</span>
                </Link>
              </li>
            ))}
            {topBearish.length === 0 && <p className="text-xs text-(--text-faint)">No live-scored markets available yet.</p>}
          </ul>
        </Card>

        <Card title="Risk-On / Risk-Off Gauge" action={<Link href="/risk-gauge" className="text-xs text-(--accent) hover:underline">Details →</Link>}>
          <div className="flex items-center gap-4">
            <div className="grid place-items-center w-14 h-14 rounded-full bg-(--accent-soft) text-(--accent)">
              <Gauge size={24} />
            </div>
            <div>
              <div className="text-2xl font-semibold tabular-nums">{risk.value}</div>
              <div className="text-sm text-(--text-dim)">{risk.label}</div>
            </div>
          </div>
          <div className="h-1.5 w-full rounded-full bg-(--border) mt-4">
            <div
              className="h-1.5 rounded-full bg-gradient-to-r from-rose-400 via-slate-400 to-emerald-400"
              style={{ width: `${risk.value}%` }}
            />
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="High-importance news" action={<Link href="/news" className="text-xs text-(--accent) hover:underline">View all →</Link>}>
          <ul className="space-y-3">
            {topNews.map((n) => (
              <li key={n.id} className="text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium leading-snug">{n.headline}</span>
                  <span
                    className={`shrink-0 text-[10px] rounded-full px-1.5 py-0.5 font-medium ${
                      n.interpretation === "Bullish"
                        ? "text-emerald-400 bg-emerald-500/10"
                        : n.interpretation === "Bearish"
                          ? "text-rose-400 bg-rose-500/10"
                          : "text-slate-300 bg-slate-500/10"
                    }`}
                  >
                    {n.interpretation}
                  </span>
                </div>
                <div className="text-xs text-(--text-faint) mt-0.5">
                  {n.source} · {formatRelative(n.publishedAt)} · {n.affectedMarkets.slice(0, 3).join(", ")}
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Upcoming high-impact events" action={<Link href="/economic-calendar" className="text-xs text-(--accent) hover:underline">Calendar →</Link>}>
          <ul className="space-y-3">
            {events.map((e) => (
              <li key={e.id} className="text-sm flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{e.event}</div>
                  <div className="text-xs text-(--text-faint) mt-0.5">{e.country} · {formatDateTime(e.dateTime)}</div>
                </div>
                <span className="shrink-0 text-[10px] rounded-full px-1.5 py-0.5 font-medium text-amber-400 bg-amber-500/10">High</span>
              </li>
            ))}
            {events.length === 0 && <p className="text-xs text-(--text-faint)">No high-impact releases in the next 72 hours.</p>}
          </ul>
        </Card>
      </div>

      {divergences.length > 0 && (
        <Card title="Smart money signals" action={<Link href="/smart-money" className="text-xs text-(--accent) hover:underline">View all →</Link>}>
          <div className="grid sm:grid-cols-3 gap-3">
            {divergences.map((d) => (
              <Link
                key={d.symbol}
                href={`/markets/${d.symbol}`}
                className="rounded-lg border border-(--border) p-3 hover:border-(--border-strong) transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{d.symbol}</span>
                  <ArrowRight size={13} className="text-(--text-faint)" />
                </div>
                <div className="text-xs text-(--accent) mt-1">{d.signal}</div>
                <div className="text-[11px] text-(--text-faint) mt-1">Confidence {d.confidence}%</div>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
