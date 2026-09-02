import Link from "next/link";
import { getDashboardMarketRows, DashboardMarketRow } from "@/lib/pipeline/dashboard";
import { StatTile } from "@/components/ui/StatTile";
import { Card } from "@/components/ui/Card";
import { AutoRefresh } from "@/components/ui/AutoRefresh";
import { ConfidenceBar } from "@/components/ui/ConfidenceBar";
import { BiasBadge } from "@/components/ui/BiasBadge";
import { buildCatalyst } from "@/lib/catalyst";
import { formatSigned, scoreColorClass } from "@/lib/format";
import { generateRiskGauge } from "@/lib/demo/riskGauge";
import { getLiveRiskGauge } from "@/lib/pipeline/risk-gauge";
import { NEWS_ARTICLES } from "@/lib/demo/news";
import { getLiveNewsFeed } from "@/lib/pipeline/news-feed";
import { upcomingHighImpact } from "@/lib/demo/calendar";
import { getUpcomingHighImpactEvents } from "@/db/queries/market-data";
import { formatDateTime, formatRelative } from "@/lib/time";
import { publicInstruments } from "@/services/market-coverage";
import { generateSmartMoney } from "@/lib/demo/smartMoney";
import { resolveSmartMoney } from "@/lib/pipeline/positioning";
import { requireEntitlement } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { ArrowRight, Gauge } from "lucide-react";

export const metadata = { title: "Dashboard — Market Intelligence AI" };

// Without this, the Dashboard would be prerendered once at build time and
// serve that frozen HTML forever — defeating the canonical current-score
// read below, which must reflect Neon's latest state on every visit. See
// /top-setups and /markets/[symbol] for the same rule already applied.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireEntitlement();
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

  // "What changed since yesterday?" — reuses current_market_scores.change24h,
  // already loaded on every row above (see pipeline/dashboard.ts). No new
  // provider call, no new DB read: this is a re-sort of the exact same
  // `eligible` rows the bullish/bearish cards below already use.
  const byChange = [...eligible].filter((r) => r.score!.change24h !== 0).sort((a, b) => b.score!.change24h - a.score!.change24h);
  const improving = byChange.slice(0, 3);
  const weakening = byChange.slice(-3).reverse();
  const veryBullish = eligible.filter((r) => r.score!.bias === "Very Bullish").length;
  const veryBearish = eligible.filter((r) => r.score!.bias === "Very Bearish").length;

  const demoMode = isDemoOnly();
  // Phase 18 (public-launch demo sweep): 6 of the gauge's 9 components are
  // fed real 24h % changes from the same canonical, storage-first quote
  // resolver every other public surface uses; the 3 components with no live
  // source anywhere in this codebase (VIX, yield-curve slope, credit
  // spread) are left honestly unavailable rather than estimated — see
  // pipeline/risk-gauge.ts.
  const liveRisk = demoMode ? null : await getLiveRiskGauge();
  const risk = demoMode ? generateRiskGauge() : liveRisk!.result;
  // Phase 18 (public-launch demo sweep): both cards below now read real
  // stored data outside demo mode — the same newsArticles/economicEvents
  // rows the cron jobs already populate — instead of the hand-seeded demo
  // arrays regardless of DATA_MODE.
  const topNews = demoMode
    ? [...NEWS_ARTICLES].sort((a, b) => b.importance - a.importance).slice(0, 4)
    : (await getLiveNewsFeed(30)).sort((a, b) => b.importance - a.importance).slice(0, 4);
  const events = demoMode ? upcomingHighImpact(72).slice(0, 4) : await getUpcomingHighImpactEvents(72, 4);
  // Phase 18 (public-launch demo sweep): this card now calls the real
  // CFTC-positioning-momentum resolver (the same one the Scorecard's Smart
  // Money section and /smart-money page use) outside demo mode, instead of
  // the pure demo generator regardless of DATA_MODE.
  const divergences = demoMode
    ? publicInstruments()
        .map((i) => {
          const d = generateSmartMoney(i);
          return { symbol: i.symbol, signal: d.signal, confidence: d.confidence };
        })
        .filter((d) => d.signal !== "None")
        .slice(0, 3)
    : (
        await Promise.all(publicInstruments().map(async (i) => ({ symbol: i.symbol, ...(await resolveSmartMoney(i.symbol)) })))
      )
        .filter((d) => d.signal !== "None")
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3);

  return (
    <div className="space-y-6">
      <AutoRefresh intervalSeconds={45} />
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          What changed since yesterday, which markets have the strongest conditions right now, and what&apos;s driving them.{" "}
          {rows.length} markets tracked{blockedCount > 0 ? ` (${eligible.length} live, ${blockedCount} pending coverage)` : ""}.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Very Bullish" value={String(veryBullish)} valueClassName="text-emerald-400" sub="Score ≥ +8" />
        <StatTile label="Very Bearish" value={String(veryBearish)} valueClassName="text-rose-400" sub="Score ≤ -8" />
        <StatTile label="Avg. confidence" value={`${avgConfidence}%`} sub="Across all markets" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Improving" subtitle="Biggest 24h score gains" action={<Link href="/top-setups" className="text-xs text-(--accent) hover:underline">View all →</Link>} className="p-3 sm:p-4">
          <MoverList rows={improving} />
        </Card>
        <Card title="Weakening" subtitle="Biggest 24h score drops" action={<Link href="/top-setups" className="text-xs text-(--accent) hover:underline">View all →</Link>} className="p-3 sm:p-4">
          <MoverList rows={weakening} />
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Strongest bullish conditions" action={<Link href="/top-setups" className="text-xs text-(--accent) hover:underline">View all →</Link>} className="lg:col-span-1 p-3 sm:p-4">
          <ul className="space-y-2">
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

        <Card title="Strongest bearish conditions" action={<Link href="/top-setups" className="text-xs text-(--accent) hover:underline">View all →</Link>} className="p-3 sm:p-4">
          <ul className="space-y-2">
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

        <Card title="Risk-On / Risk-Off Gauge" action={<Link href="/risk-gauge" className="text-xs text-(--accent) hover:underline">Details →</Link>} className="p-3 sm:p-4">
          {risk ? (
            <>
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
            </>
          ) : (
            <p className="text-xs text-(--text-faint)">{liveRisk?.unavailableReason ?? "Data temporarily unavailable."}</p>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="High-importance news" action={<Link href="/news" className="text-xs text-(--accent) hover:underline">View all →</Link>} className="p-3 sm:p-4">
          <ul className="space-y-2">
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

        <Card title="Upcoming high-impact events" action={<Link href="/economic-calendar" className="text-xs text-(--accent) hover:underline">Calendar →</Link>} className="p-3 sm:p-4">
          <ul className="space-y-2">
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
        <Card title="Smart money signals" action={<Link href="/smart-money" className="text-xs text-(--accent) hover:underline">View all →</Link>} className="p-3 sm:p-4">
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

// Shared by both the "Improving" and "Weakening" cards above — score,
// 24h change, bias, confidence, and (when a factor clearly stands out)
// catalyst, all already present on every row's canonical score. Falls back
// to "No markets changed since yesterday yet" rather than an empty card
// when change24h is uniformly 0 (e.g. immediately after the scores cron's
// very first run, before any day-over-day delta exists).
function MoverList({ rows }: { rows: DashboardMarketRow[] }) {
  if (rows.length === 0) {
    return <p className="text-xs text-(--text-faint)">No markets changed since yesterday yet.</p>;
  }
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const score = r.score!;
        const catalyst = buildCatalyst(score.factors);
        return (
          <li key={r.instrument.symbol}>
            <Link href={`/markets/${r.instrument.symbol}`} className="block hover:text-(--accent)">
              <div className="flex items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium">{r.instrument.symbol}</span>
                  <BiasBadge bias={score.bias} size="sm" />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`tabular-nums text-xs ${scoreColorClass(score.change24h)}`}>{formatSigned(score.change24h)} 24h</span>
                  <span className={`tabular-nums font-semibold ${scoreColorClass(score.totalScore)}`}>{formatSigned(score.totalScore)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-16 shrink-0">
                  <ConfidenceBar value={score.confidence} compact />
                </div>
                {catalyst && <span className="text-[11px] text-(--text-faint) truncate">{catalyst}</span>}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
