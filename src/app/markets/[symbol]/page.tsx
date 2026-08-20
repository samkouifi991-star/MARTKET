import { notFound } from "next/navigation";
import Link from "next/link";
import { INSTRUMENTS, getInstrument } from "@/lib/instruments";
import { generatePriceData } from "@/lib/demo/price";
import { generatePositioning } from "@/lib/demo/positioning";
import { generateRetailSentiment } from "@/lib/demo/retail";
import { generateSmartMoney } from "@/lib/demo/smartMoney";
import { currentMonthStat } from "@/lib/demo/seasonality";
import { computeMarketScore, factorLabel } from "@/lib/scoring";
import { computeLiveMarketScore } from "@/lib/pipeline/scoring-engine";
import { buildLiveInvalidationPoints, getLiveMarketDetail, LiveMarketDetail } from "@/lib/pipeline/market-detail";
import { DATA_MODE, isDemoOnly } from "@/services/data-mode";
import { NEWS_ARTICLES } from "@/lib/demo/news";
import { CALENDAR_EVENTS } from "@/lib/demo/calendar";
import { allMarketRows } from "@/lib/market-data";
import { pearsonCorrelation } from "@/lib/correlation";
import { invalidationFactors } from "@/lib/invalidation";
import { ScoreGauge } from "@/components/ui/ScoreGauge";
import { ConfidenceBar } from "@/components/ui/ConfidenceBar";
import { Card } from "@/components/ui/Card";
import { DataFreshnessTag } from "@/components/ui/DataFreshnessTag";
import { FactorSentimentBadge } from "@/components/ui/FactorSentimentBadge";
import { PriceChart } from "@/components/charts/PriceChart";
import { ScoreHistoryChart } from "@/components/charts/ScoreHistoryChart";
import { factorContributionColorClass, factorSentiment, formatPrice, formatSigned, formatSignedPct, scoreColorClass } from "@/lib/format";
import { formatDateTime, formatRelative } from "@/lib/time";
import { DataFreshness, MarketScore, PriceData } from "@/lib/types";
import { AlertTriangle, ArrowLeft } from "lucide-react";

export function generateStaticParams() {
  return INSTRUMENTS.map((i) => ({ symbol: i.symbol }));
}

// Without this, Next prerenders every /markets/[symbol] page exactly once at
// build time (confirmed via .next/prerender-manifest.json: compute:'static',
// initialRevalidateSeconds:false) and serves that same frozen HTML to every
// visitor until the next deploy — defeating the entire storage-first
// last-known-good architecture, which assumes each visit reads Neon's
// current state. force-dynamic makes this route render per-request instead.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const instrument = getInstrument(symbol);
  return { title: instrument ? `${instrument.symbol} — Market Intelligence AI` : "Market not found" };
}

export default async function MarketDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const instrument = getInstrument(symbol);
  if (!instrument) notFound();

  const demoMode = isDemoOnly();

  const score: MarketScore = demoMode ? computeMarketScore(instrument) : await computeLiveMarketScore(instrument.symbol, DATA_MODE);
  const live: LiveMarketDetail | null = demoMode ? null : await getLiveMarketDetail(instrument.symbol, DATA_MODE);

  const price: PriceData | null = demoMode ? generatePriceData(instrument) : live!.price.data;
  const priceFreshness: DataFreshness = demoMode ? "estimated" : live!.price.freshness;
  const priceSource = demoMode ? "Simulated price engine (demo)" : live!.price.source;

  const related = NEWS_ARTICLES.filter((n) => n.affectedMarkets.includes(instrument.symbol));
  const relatedTickers = instrument.currencies ?? [instrument.symbol];
  const upcomingEvents = CALENDAR_EVENTS.filter(
    (e) => !e.actual && e.affectedMarkets.some((m) => relatedTickers.includes(m))
  ).slice(0, 5);

  const invalidations = demoMode
    ? invalidationFactors(instrument, score, generatePriceData(instrument), generatePositioning(instrument), generateRetailSentiment(instrument))
    : buildLiveInvalidationPoints(instrument, score, live!);

  const others = price ? allMarketRows().filter((r) => r.instrument.symbol !== instrument.symbol) : [];
  const correlations = price
    ? others
        .map((r) => ({ symbol: r.instrument.symbol, name: r.instrument.name, corr: pearsonCorrelation(price.series, r.price.series) }))
        .sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr))
        .slice(0, 6)
    : [];

  return (
    <div className="space-y-6">
      <Link href="/markets" className="inline-flex items-center gap-1 text-xs text-(--text-faint) hover:text-(--text-dim)">
        <ArrowLeft size={13} /> Back to Markets
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{instrument.symbol}</h1>
            <span className="text-xs rounded-full border border-(--border) px-2 py-0.5 text-(--text-faint)">{instrument.assetClass}</span>
            {!demoMode && <DataFreshnessTag freshness={priceFreshness} />}
          </div>
          <p className="text-sm text-(--text-faint) mt-0.5">{instrument.name}</p>
          {price ? (
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">{formatPrice(price.current, instrument.decimals)}</span>
              <span className={`text-sm tabular-nums font-medium ${scoreColorClass(price.changePct24h)}`}>{formatSignedPct(price.changePct24h)}</span>
            </div>
          ) : (
            <p className="mt-2 text-sm text-(--text-faint)">Data temporarily unavailable{live?.price.reason ? ` — ${live.price.reason}` : ""}.</p>
          )}
        </div>
        <div className="text-xs text-(--text-faint) text-right">
          {/* The actual data timestamp, not the moment this page happened to
              render — score.lastUpdated is set fresh on every computation
              regardless of whether any underlying provider call actually
              succeeded, which is exactly what made this always read "just
              now" even during an FMP outage. */}
          Last updated {formatRelative(demoMode ? score.lastUpdated : (live!.price.lastUpdated ?? score.lastUpdated))}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Total Score" className="lg:col-span-1 flex flex-col items-center">
          <ScoreGauge score={score.totalScore} bias={score.bias} />
          <div className="w-full mt-3">
            <ConfidenceBar value={score.confidence} />
          </div>
        </Card>

        <Card title="Score breakdown" subtitle="Every contributing factor, transparently weighted." className="lg:col-span-2">
          <div className="space-y-3">
            {score.factors.map((f) => (
              <div key={f.key} className="border-b border-(--border) last:border-0 pb-3 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{factorLabel(f.key)}</span>
                    <FactorSentimentBadge sentiment={factorSentiment(f.contribution)} />
                    <DataFreshnessTag freshness={f.freshness} lastUpdated={f.lastUpdated} />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-(--text-faint) tabular-nums">
                    <span>raw {formatSigned(f.rawScore)}</span>
                    <span>weight {(f.weight * 100).toFixed(0)}%</span>
                    <span className={`font-semibold ${factorContributionColorClass(f.contribution)}`}>{formatSigned(f.contribution)}</span>
                  </div>
                </div>
                <p className="text-xs text-(--text-dim) mt-1 leading-relaxed">{f.explanation}</p>
                <p className="text-[10px] text-(--text-faint) mt-1">
                  Source: {f.source} · Next update {formatRelative(f.nextUpdate)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-(--border) flex items-center justify-between text-xs">
            <span className="text-(--text-faint)">Total weighted score = sum of contributions above</span>
            <span className={`font-semibold tabular-nums ${factorContributionColorClass(score.totalScore)}`}>
              {score.factors.map((f) => formatSigned(f.contribution)).join(" ")} = {formatSigned(score.totalScore)}
            </span>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card
          title="Price chart"
          subtitle={price ? `20 EMA ${formatPrice(price.ema20, instrument.decimals)} · 50 SMA ${formatPrice(price.sma50, instrument.decimals)} · 200 SMA ${formatPrice(price.sma200, instrument.decimals)}` : undefined}
          action={!demoMode ? <DataFreshnessTag freshness={priceFreshness} /> : undefined}
        >
          {price ? (
            <>
              <PriceChart series={price.series} decimals={instrument.decimals} />
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <MiniStat label="RSI(14)" value={price.rsi14.toFixed(0)} />
                <MiniStat label="ADX(14)" value={price.adx14.toFixed(0)} />
                <MiniStat label="10d ROC" value={formatSignedPct(price.roc10)} />
              </div>
              <p className="text-xs text-(--text-faint) mt-2">Structure: {price.structure}</p>
              {!demoMode && <p className="text-[10px] text-(--text-faint) mt-1">Source: {priceSource}</p>}
            </>
          ) : (
            <UnavailableNote reason={live?.price.reason} />
          )}
        </Card>

        <Card title="Score history (30 days)" subtitle={`24h change ${formatSigned(score.change24h)}`}>
          <ScoreHistoryChart history={score.history} />
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card
          title="Institutional positioning"
          action={<Link href="/institutional" className="text-xs text-(--accent) hover:underline">Module →</Link>}
        >
          {demoMode ? (
            <InstitutionalDemoRows instrument={symbol} />
          ) : live!.institutional.data ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <DataFreshnessTag freshness={live!.institutional.freshness} lastUpdated={live!.institutional.lastUpdated ?? undefined} />
              </div>
              <dl className="space-y-1.5 text-sm">
                <Row label="Classification" value={live!.institutional.data.classification} />
                <Row label="Net positioning" value={live!.institutional.data.netPositioning.toLocaleString()} />
                <Row label="Weekly net change" value={formatSigned(live!.institutional.data.netWeeklyChange, 0)} />
                <Row label="% long / short" value={`${live!.institutional.data.pctLong.toFixed(0)}% / ${live!.institutional.data.pctShort.toFixed(0)}%`} />
                <Row label="Percentile (3yr)" value={live!.institutional.data.percentile !== null ? `${live!.institutional.data.percentile}th` : "n/a"} />
                <Row label="Open interest" value={live!.institutional.data.openInterest.toLocaleString()} />
              </dl>
              <p className="text-[10px] text-(--text-faint) mt-2">Source: {live!.institutional.source}</p>
            </>
          ) : (
            <>
              <DataFreshnessTag freshness={live!.institutional.freshness} />
              <UnavailableNote reason={live!.institutional.reason} />
            </>
          )}
        </Card>

        <Card
          title="Retail sentiment"
          action={<Link href="/retail-sentiment" className="text-xs text-(--accent) hover:underline">Module →</Link>}
        >
          {demoMode ? (
            <RetailDemoRows instrument={symbol} />
          ) : live!.retail.data ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <DataFreshnessTag freshness={live!.retail.freshness} lastUpdated={live!.retail.lastUpdated ?? undefined} />
              </div>
              <dl className="space-y-1.5 text-sm">
                <Row label="% long / short" value={`${live!.retail.data.pctLong.toFixed(0)}% / ${live!.retail.data.pctShort.toFixed(0)}%`} />
                {live!.retail.data.longPositions !== undefined && <Row label="Long positions" value={live!.retail.data.longPositions.toLocaleString()} />}
                {live!.retail.data.shortPositions !== undefined && <Row label="Short positions" value={live!.retail.data.shortPositions.toLocaleString()} />}
                {live!.retail.data.avgLongPrice !== undefined && <Row label="Avg long price" value={formatPrice(live!.retail.data.avgLongPrice, instrument.decimals)} />}
                {live!.retail.data.avgShortPrice !== undefined && <Row label="Avg short price" value={formatPrice(live!.retail.data.avgShortPrice, instrument.decimals)} />}
              </dl>
              <p className="text-[10px] text-(--text-faint) mt-2">Source: {live!.retail.source}</p>
            </>
          ) : (
            <>
              <DataFreshnessTag freshness={live!.retail.freshness} />
              <UnavailableNote reason={live!.retail.reason} />
            </>
          )}
        </Card>

        <Card
          title="Smart money divergence"
          action={<Link href="/smart-money" className="text-xs text-(--accent) hover:underline">Module →</Link>}
        >
          {demoMode ? (
            <SmartMoneyDemoBlock instrument={symbol} />
          ) : live!.smartMoney.data ? (
            <>
              <div className="flex items-center gap-2 mb-1">
                <DataFreshnessTag freshness={live!.smartMoney.freshness} />
              </div>
              <p className="text-sm font-medium text-(--accent)">{live!.smartMoney.data.signal}</p>
              <p className="text-xs text-(--text-dim) mt-1.5 leading-relaxed">{live!.smartMoney.data.explanation}</p>
              <div className="mt-2">
                <ConfidenceBar value={live!.smartMoney.data.confidence} compact />
              </div>
            </>
          ) : (
            <>
              <DataFreshnessTag freshness={live!.smartMoney.freshness} />
              <UnavailableNote reason={live!.smartMoney.reason} />
            </>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card
          title="Seasonality"
          subtitle={
            demoMode
              ? `${currentMonthStat(instrument).period} · ${currentMonthStat(instrument).years}-year history`
              : live!.seasonality.data
                ? `${live!.seasonality.data.period} · ${live!.seasonality.data.sampleDepth?.yearsSpanned ?? live!.seasonality.data.years}-year history`
                : undefined
          }
          action={!demoMode ? <DataFreshnessTag freshness={live!.seasonality.freshness} /> : undefined}
        >
          {demoMode ? (
            <SeasonalityDemoRows instrument={symbol} />
          ) : live!.seasonality.data ? (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <Row label="Avg return" value={formatSignedPct(live!.seasonality.data.avgReturn)} />
                <Row label="Median return" value={formatSignedPct(live!.seasonality.data.medianReturn)} />
                <Row label="% positive years" value={`${live!.seasonality.data.pctPositive}%`} />
                <Row label="Best / worst" value={`${formatSignedPct(live!.seasonality.data.bestReturn)} / ${formatSignedPct(live!.seasonality.data.worstReturn)}`} />
                <Row label="10y average" value={formatSignedPct(live!.seasonality.data.avg10y)} />
                <Row label="Max drawdown" value={formatSignedPct(live!.seasonality.data.maxDrawdown)} />
                {live!.seasonality.data.sampleDepth && (
                  <Row
                    label="Sample"
                    value={`${live!.seasonality.data.sampleDepth.observations} candles, ${live!.seasonality.data.sampleDepth.earliestDate.slice(0, 10)} to ${live!.seasonality.data.sampleDepth.latestDate.slice(0, 10)}`}
                  />
                )}
              </dl>
              <p className="text-[10px] text-(--text-faint) mt-2">Source: {live!.seasonality.source}</p>
            </>
          ) : (
            <UnavailableNote reason={live!.seasonality.reason} />
          )}
          <Link href="/seasonality" className="text-xs text-(--accent) hover:underline mt-2 inline-block">Full seasonality module →</Link>
        </Card>

        <Card title="Correlations (60-day, daily returns)">
          {correlations.length > 0 ? (
            <ul className="space-y-1.5">
              {correlations.map((c) => (
                <li key={c.symbol} className="flex items-center justify-between text-sm">
                  <Link href={`/markets/${c.symbol}`} className="hover:text-(--accent)">
                    {c.symbol} <span className="text-(--text-faint) text-xs">{c.name}</span>
                  </Link>
                  <span className={`tabular-nums text-xs font-medium ${c.corr > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {c.corr >= 0 ? "+" : ""}
                    {c.corr.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-(--text-faint)">Price data unavailable — correlations can&apos;t be computed right now.</p>
          )}
          {!demoMode && <p className="text-[10px] text-(--text-faint) mt-2">Compared against sample data for other markets — full cross-market correlation lands once more markets are converted to live data.</p>}
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Related news" action={<Link href="/news" className="text-xs text-(--accent) hover:underline">All news →</Link>}>
          {!demoMode && <p className="text-[10px] text-(--text-faint) mb-2">Sample data — not yet wired to the live News factor&apos;s feed.</p>}
          {related.length === 0 ? (
            <p className="text-sm text-(--text-faint)">No recent news tagged to this market.</p>
          ) : (
            <ul className="space-y-3">
              {related.map((n) => (
                <li key={n.id} className="text-sm">
                  <div className="font-medium leading-snug">{n.headline}</div>
                  <div className="text-xs text-(--text-faint) mt-0.5">
                    {n.interpretation} · importance {n.importance}/100 · {formatRelative(n.publishedAt)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Upcoming economic events" action={<Link href="/economic-calendar" className="text-xs text-(--accent) hover:underline">Calendar →</Link>}>
          {!demoMode && <p className="text-[10px] text-(--text-faint) mb-2">Sample data — not yet wired to a live economic calendar feed.</p>}
          {upcomingEvents.length === 0 ? (
            <p className="text-sm text-(--text-faint)">No scheduled releases affecting this market in the near term.</p>
          ) : (
            <ul className="space-y-2.5">
              {upcomingEvents.map((e) => (
                <li key={e.id} className="text-sm flex items-center justify-between">
                  <span>{e.event} <span className="text-(--text-faint) text-xs">({e.country})</span></span>
                  <span className="text-xs text-(--text-faint)">{formatDateTime(e.dateTime)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="What could invalidate this bias?" subtitle={`Current bias: ${score.bias}`}>
        <ul className="space-y-2">
          {invalidations.map((point, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-(--text-dim)">
              <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function UnavailableNote({ reason }: { reason?: string }) {
  return <p className="text-sm text-(--text-faint) mt-2">Data temporarily unavailable{reason ? ` — ${reason}` : ""}.</p>;
}

function InstitutionalDemoRows({ instrument }: { instrument: string }) {
  const positioning = generatePositioning(getInstrument(instrument)!);
  return (
    <dl className="space-y-1.5 text-sm">
      <Row label="Net positioning" value={positioning.netPositioning.toLocaleString()} />
      <Row label="Weekly net change" value={formatSigned(positioning.netWeeklyChange, 0)} />
      <Row label="% long / short" value={`${positioning.pctLong.toFixed(0)}% / ${positioning.pctShort.toFixed(0)}%`} />
      <Row label="Percentile (3yr)" value={`${positioning.percentile}th`} />
      <Row label="Open interest" value={positioning.openInterest.toLocaleString()} />
    </dl>
  );
}

function RetailDemoRows({ instrument }: { instrument: string }) {
  const retail = generateRetailSentiment(getInstrument(instrument)!);
  return (
    <>
      <dl className="space-y-1.5 text-sm">
        <Row label="% long / short" value={`${retail.pctLong.toFixed(0)}% / ${retail.pctShort.toFixed(0)}%`} />
        <Row label="24h change" value={formatSigned(retail.change24h)} />
        <Row label="7d change" value={formatSigned(retail.change7d)} />
        <Row label="Extreme?" value={retail.isExtreme ? "Yes" : "No"} />
        <Row label="Contrarian read" value={retail.contrarianBias} />
      </dl>
      <p className="text-[10px] text-(--text-faint) mt-2">Retail sentiment is an estimate aggregated across broker/platform sources.</p>
    </>
  );
}

function SmartMoneyDemoBlock({ instrument }: { instrument: string }) {
  const smartMoney = generateSmartMoney(getInstrument(instrument)!);
  return (
    <>
      <p className="text-sm font-medium text-(--accent)">{smartMoney.signal}</p>
      <p className="text-xs text-(--text-dim) mt-1.5 leading-relaxed">{smartMoney.explanation}</p>
      <div className="mt-2">
        <ConfidenceBar value={smartMoney.confidence} compact />
      </div>
    </>
  );
}

function SeasonalityDemoRows({ instrument }: { instrument: string }) {
  const seasonStat = currentMonthStat(getInstrument(instrument)!);
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
      <Row label="Avg return" value={formatSignedPct(seasonStat.avgReturn)} />
      <Row label="Median return" value={formatSignedPct(seasonStat.medianReturn)} />
      <Row label="% positive years" value={`${seasonStat.pctPositive}%`} />
      <Row label="Best / worst" value={`${formatSignedPct(seasonStat.bestReturn)} / ${formatSignedPct(seasonStat.worstReturn)}`} />
      <Row label="10y average" value={formatSignedPct(seasonStat.avg10y)} />
      <Row label="Max drawdown" value={formatSignedPct(seasonStat.maxDrawdown)} />
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-(--text-faint)">{label}</dt>
      <dd className="tabular-nums font-medium">{value}</dd>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[.03] py-2">
      <div className="text-[10px] text-(--text-faint) uppercase tracking-wide">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
