import Link from "next/link";
import { getLandingPreview } from "@/lib/pipeline/landing";
import { verifySession } from "@/lib/auth/dal";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { PricingCard } from "@/components/marketing/PricingCard";
import { ScoreGauge } from "@/components/ui/ScoreGauge";
import { ConfidenceBar } from "@/components/ui/ConfidenceBar";
import { FactorSentimentBadge } from "@/components/ui/FactorSentimentBadge";
import { BiasBadge } from "@/components/ui/BiasBadge";
import { factorLabel } from "@/lib/scoring";
import { factorSentiment, formatSigned, scoreColorClass, FactorSentiment } from "@/lib/format";
import { isStrictLiveSymbol } from "@/services/data-mode";
import { SCORE_FACTOR_KEYS, ScoreFactorKey } from "@/lib/types";
import { MarketRow } from "@/lib/market-data";
import {
  Activity,
  BarChart3,
  Bell,
  Building2,
  Calendar,
  CheckCircle2,
  Coins,
  Gauge,
  LineChart,
  ListChecks,
  Newspaper,
  ShieldCheck,
  Star,
  TrendingUp,
  Users,
} from "lucide-react";

export const metadata = {
  title: "Market Intelligence AI — See What's Driving the Markets",
  description:
    "Technical trends, institutional positioning, retail sentiment, macro data, seasonality, and market risk — combined into one transparent score for every supported market.",
};
export const dynamic = "force-dynamic";

type PreviewRow = { key: string; label: string; sentiment: FactorSentiment; contribution: number | null };

function smartMoneySentiment(signal: string): FactorSentiment {
  if (signal === "Bullish Smart Money Divergence") return "Bullish";
  if (signal === "Bearish Smart Money Divergence" || signal === "Crowded Institutional Trade") return "Bearish";
  return "Neutral";
}

// A fixed, clearly-labeled illustrative example — never derived from live
// data, never persisted, never shown as Gold's real score anywhere else in
// the app. Used only when Gold's real current bias isn't a high-conviction
// bullish setup, so the landing page can still demonstrate what the
// product looks like when several factors align, without ever claiming
// this number is the live market score. Per-factor contributions are each
// exactly that factor's DEFAULT_FACTOR_WEIGHTS share of 7.8, so they sum
// to the headline score precisely — the same "Total Score = Σ
// contributions" invariant the real engine guarantees.
const ILLUSTRATIVE_GOLD_TOTAL_SCORE = 7.8;
const ILLUSTRATIVE_GOLD_CONFIDENCE = 92;
const ILLUSTRATIVE_GOLD_FACTORS: { key: ScoreFactorKey; contribution: number }[] = [
  { key: "institutional", contribution: 1.2 },
  { key: "retailSentiment", contribution: 0.6 },
  { key: "technical", contribution: 1.6 },
  { key: "seasonality", contribution: 0.4 },
  { key: "economicGrowth", contribution: 0.9 },
  { key: "inflation", contribution: 0.8 },
  { key: "labor", contribution: 0.6 },
  { key: "interestRates", contribution: 1.0 },
  { key: "news", contribution: 0.7 },
];

export default async function LandingPage() {
  const sessionUser = await verifySession();
  const user = sessionUser ? { email: sessionUser.email } : null;
  const { rows, featured, smartMoney } = await getLandingPreview();

  // Same canonical current scores Top Setups ranks by — 3 strongest
  // bullish and 3 strongest bearish, visually separated, capped at 6 rows
  // total so the marketing preview stays compact. The full ranked list
  // still lives on /top-setups, unaffected by this landing-page-only cut.
  const rankedByScore = [...rows].sort((a, b) => b.score.totalScore - a.score.totalScore);
  const topBullish = rankedByScore.slice(0, 3);
  const topBearish = rankedByScore.slice(-3).reverse(); // most negative first

  // Gold's real current score is "strong" (worth featuring live) once its
  // bias itself is Bullish/Very Bullish — the same bias vocabulary the
  // rest of the app uses, not an arbitrary landing-page-only cutoff.
  const isGoldStrong = featured.score.bias === "Bullish" || featured.score.bias === "Very Bullish";

  const previewRows: PreviewRow[] = isGoldStrong
    ? [
        ...SCORE_FACTOR_KEYS.map((key) => {
          const f = featured.score.factors.find((x) => x.key === key)!;
          return { key, label: factorLabel(key), sentiment: factorSentiment(f.contribution), contribution: f.contribution };
        }),
        { key: "smartMoney", label: "Smart Money", sentiment: smartMoneySentiment(smartMoney.signal), contribution: null },
      ]
    : [
        ...ILLUSTRATIVE_GOLD_FACTORS.map((f) => ({
          key: f.key,
          label: factorLabel(f.key),
          sentiment: factorSentiment(f.contribution),
          contribution: f.contribution,
        })),
        { key: "smartMoney", label: "Smart Money", sentiment: "Bullish" as FactorSentiment, contribution: null },
      ];

  const goldGauge = isGoldStrong
    ? { totalScore: featured.score.totalScore, bias: featured.score.bias, confidence: featured.score.confidence }
    : { totalScore: ILLUSTRATIVE_GOLD_TOTAL_SCORE, bias: "Bullish" as const, confidence: ILLUSTRATIVE_GOLD_CONFIDENCE };

  const strictLiveCount = rows.filter((r) => isStrictLiveSymbol(r.instrument.symbol)).length;
  const byAssetClass = {
    Forex: rows.filter((r) => r.instrument.assetClass === "Forex" && isStrictLiveSymbol(r.instrument.symbol)).length,
    Indices: rows.filter((r) => r.instrument.assetClass === "Indices" && isStrictLiveSymbol(r.instrument.symbol)).length,
    Commodities: rows.filter((r) => r.instrument.assetClass === "Commodities" && isStrictLiveSymbol(r.instrument.symbol)).length,
    Crypto: rows.filter((r) => r.instrument.assetClass === "Crypto" && isStrictLiveSymbol(r.instrument.symbol)).length,
  };

  return (
    <div className="min-h-dvh flex flex-col">
      <MarketingNav user={user} />

      <main className="flex-1">
        {/* Hero */}
        <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-16 pb-12 text-center">
          <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-tight">
            See What&apos;s Driving the Markets<br className="hidden sm:block" /> Before You Trade
          </h1>
          <p className="mt-5 text-(--text-dim) text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            Market Intelligence AI combines technical trends, institutional positioning, retail sentiment, macro data, seasonality,
            and market risk into one transparent score for every supported market.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup" className="h-11 px-6 rounded-lg bg-(--accent) text-white text-sm font-semibold inline-flex items-center">
              Start Your 3-Day Free Trial
            </Link>
            <Link
              href="/#how-it-works"
              className="h-11 px-6 rounded-lg border border-(--border) text-sm font-medium inline-flex items-center text-(--text-dim) hover:text-(--text) hover:border-(--border-strong)"
            >
              See How It Works
            </Link>
          </div>
          <p className="mt-4 text-xs text-(--text-faint)">3 days free · then $39/month · cancel anytime</p>
        </section>

        {/* Product preview */}
        <section id="product" className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-semibold">See exactly what drives every score</h2>
            <p className="mt-2 text-(--text-dim) max-w-2xl mx-auto text-sm sm:text-base">
              Every market score is transparent — technicals, positioning, sentiment, macro, seasonality, rates, labor, inflation and more.
            </p>
          </div>
          <div className="grid lg:grid-cols-3 gap-4 items-start">
            <div className="lg:col-span-2 card p-4 sm:p-5 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Top Market Setups</h3>
                <span className="text-[11px] text-(--text-faint)">Live product preview — real data, not a mockup</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wide text-emerald-400 mb-1">Strongest Bullish</h4>
                  <div className="divide-y divide-(--border)">
                    {topBullish.map((row) => (
                      <MarketRowItem key={row.instrument.symbol} row={row} />
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wide text-rose-400 mb-1">Strongest Bearish</h4>
                  <div className="divide-y divide-(--border)">
                    {topBearish.map((row) => (
                      <MarketRowItem key={row.instrument.symbol} row={row} />
                    ))}
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-(--text-faint) mt-3">
                Showing the 3 strongest bullish and 3 strongest bearish of {rows.length} ranked markets.
              </p>
            </div>

            <div className="card p-4 sm:p-5 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">{isGoldStrong ? "Gold — Total Score" : "Example Gold Setup"}</h3>
                {!isGoldStrong && <span className="text-[10px] uppercase tracking-wide text-amber-400 font-semibold">Illustrative</span>}
              </div>
              {!isGoldStrong && (
                <p className="text-[11px] text-(--text-faint) -mt-1 mb-1">
                  Illustrative high-conviction example — not Gold&apos;s live market score.
                </p>
              )}
              <div className="flex justify-center py-2">
                <ScoreGauge score={goldGauge.totalScore} bias={goldGauge.bias} size={140} />
              </div>
              <ConfidenceBar value={goldGauge.confidence} />

              <div className="mt-4 space-y-2.5">
                {previewRows.map((row) => (
                  <div key={row.key} className="text-xs flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium min-w-0">
                      <span className="truncate">{row.label}</span>
                      <FactorSentimentBadge sentiment={row.sentiment} />
                    </span>
                    <span className="tabular-nums font-semibold shrink-0">
                      {row.contribution === null ? "—" : formatSigned(row.contribution)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Key benefits */}
        <section className="border-t border-(--border) bg-(--bg-elevated)">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
            <h2 className="text-2xl font-semibold text-center">One score. Every major market factor.</h2>
            <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              <Benefit icon={<TrendingUp size={18} />} text="See the strongest bullish and bearish setups" />
              <Benefit icon={<ListChecks size={18} />} text="Understand exactly why a market received its score" />
              <Benefit icon={<Building2 size={18} />} text="Track institutional positioning" />
              <Benefit icon={<Users size={18} />} text="See real retail positioning" />
              <Benefit icon={<LineChart size={18} />} text="Analyze technical trends" />
              <Benefit icon={<BarChart3 size={18} />} text="Compare macro conditions" />
              <Benefit icon={<Calendar size={18} />} text="Review seasonality" />
              <Benefit icon={<Gauge size={18} />} text="Monitor confidence and freshness" />
            </div>
            <p className="mt-8 text-center text-sm text-(--text-faint)">Track FX, indices, metals, and crypto — all in one place.</p>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
          <h2 className="text-2xl font-semibold text-center mb-10">How it works</h2>
          <div className="grid sm:grid-cols-3 gap-6">
            <Step
              n={1}
              title="Market data is collected"
              text="OANDA, CFTC, FRED, and other verified sources feed the platform."
              icon={<Activity size={18} />}
            />
            <Step
              n={2}
              title="Factors are scored"
              text="Technical, positioning, sentiment, macro, seasonality, and risk factors are weighted transparently."
              icon={<Gauge size={18} />}
            />
            <Step
              n={3}
              title="Markets are ranked"
              text="See the strongest setups and open any market to understand the complete score."
              icon={<Star size={18} />}
            />
          </div>
        </section>

        {/* Transparency */}
        <section className="border-t border-(--border) bg-(--bg-elevated)">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16">
            <div className="flex items-center gap-2 justify-center mb-3">
              <ShieldCheck size={20} className="text-(--accent)" />
              <h2 className="text-2xl font-semibold">Know why the score changed</h2>
            </div>
            <p className="text-center text-(--text-dim) max-w-2xl mx-auto">
              This is not a black-box signal service. Every factor behind every score is shown in full — never a number with no
              explanation attached.
            </p>
            <div className="mt-8 grid sm:grid-cols-3 gap-4 max-w-2xl mx-auto text-sm text-(--text-dim)">
              {["Factor direction", "Raw score", "Weight", "Contribution", "Freshness", "Data source"].map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Markets */}
        <section id="markets" className="max-w-5xl mx-auto px-4 sm:px-6 py-16">
          <h2 className="text-2xl font-semibold text-center">Currently supported live markets</h2>
          <p className="text-center text-(--text-dim) mt-2 max-w-xl mx-auto">
            {strictLiveCount} markets are live today, sourced from real providers — never a fabricated score.
          </p>
          <div className="mt-10 grid sm:grid-cols-4 gap-4">
            <MarketClassTile icon={<Coins size={18} />} label="Forex" count={byAssetClass.Forex} />
            <MarketClassTile icon={<BarChart3 size={18} />} label="Stock indices" count={byAssetClass.Indices} />
            <MarketClassTile icon={<Gauge size={18} />} label="Precious metals" count={byAssetClass.Commodities} />
            <MarketClassTile icon={<TrendingUp size={18} />} label="Crypto" count={byAssetClass.Crypto} />
          </div>
          <p className="mt-6 text-center text-xs text-(--text-faint)">
            A small number of additional instruments are tracked but not yet fully live pending confirmed data coverage — those
            markets are clearly labeled as unavailable rather than shown with a generated score.
          </p>
        </section>

        {/* Pricing */}
        <section className="border-t border-(--border) bg-(--bg-elevated)">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
            <h2 className="text-2xl font-semibold">Simple pricing</h2>
            <p className="mt-2 text-(--text-dim)">3-Day Free Trial · Then $39/month · Cancel anytime</p>
            <div className="mt-8">
              <PricingCard
                cta={
                  <Link href="/signup" className="block w-full h-10 rounded-lg bg-(--accent) text-white text-sm font-semibold leading-10">
                    Start 3-Day Free Trial
                  </Link>
                }
              />
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
          <h2 className="text-2xl font-semibold text-center mb-10">Frequently asked questions</h2>
          <dl className="space-y-6">
            <Faq q="How long is the free trial?" a="3 days." />
            <Faq q="How much is it after the trial?" a="$39/month." />
            <Faq q="Can I cancel?" a="Yes, anytime." />
            <Faq
              q="Will I be charged today?"
              a="No, not when the trial starts. Billing begins after the 3-day trial according to the Stripe subscription terms."
            />
            <Faq q="Is this investment advice?" a="No. The platform provides informational and educational market intelligence." />
          </dl>
        </section>

        <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-16 text-center">
          <div className="flex items-center justify-center gap-2 mb-3 text-(--text-faint)">
            <Bell size={16} />
            <Newspaper size={16} />
          </div>
          <Link href="/signup" className="h-11 px-8 rounded-lg bg-(--accent) text-white text-sm font-semibold inline-flex items-center">
            Start Your 3-Day Free Trial
          </Link>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}

function MarketRowItem({ row }: { row: MarketRow }) {
  return (
    <Link
      href={`/markets/${row.instrument.symbol}`}
      className="flex items-center justify-between gap-2 py-2.5 hover:bg-white/[.02] -mx-2 px-2 rounded-lg"
    >
      <div className="min-w-0">
        <div className="font-medium text-sm">{row.instrument.symbol}</div>
        <div className="text-[11px] text-(--text-faint) truncate">{row.instrument.name}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <BiasBadge bias={row.score.bias} size="sm" />
        <span className={`tabular-nums font-semibold text-sm w-12 text-right ${scoreColorClass(row.score.totalScore)}`}>
          {formatSigned(row.score.totalScore)}
        </span>
      </div>
    </Link>
  );
}

function Benefit({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid place-items-center w-8 h-8 rounded-lg bg-(--accent-soft) text-(--accent) shrink-0">{icon}</span>
      <p className="text-sm text-(--text-dim) leading-snug pt-1">{text}</p>
    </div>
  );
}

function Step({ n, title, text, icon }: { n: number; title: string; text: string; icon: React.ReactNode }) {
  return (
    <div className="text-center">
      <div className="mx-auto grid place-items-center w-12 h-12 rounded-full bg-(--accent-soft) text-(--accent) mb-3">{icon}</div>
      <div className="text-xs text-(--text-faint) mb-1">Step {n}</div>
      <h3 className="font-semibold text-sm">{title}</h3>
      <p className="text-sm text-(--text-dim) mt-1.5 leading-relaxed">{text}</p>
    </div>
  );
}

function MarketClassTile({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <div className="card p-4 text-center">
      <div className="mx-auto grid place-items-center w-9 h-9 rounded-lg bg-(--accent-soft) text-(--accent) mb-2">{icon}</div>
      <div className="text-lg font-semibold tabular-nums">{count}</div>
      <div className="text-xs text-(--text-faint)">{label}</div>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <dt className="font-medium text-sm">{q}</dt>
      <dd className="text-sm text-(--text-dim) mt-1">{a}</dd>
    </div>
  );
}
