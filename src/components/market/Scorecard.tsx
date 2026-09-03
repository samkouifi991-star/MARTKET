// Grouped market-intelligence scorecard — left summary panel (bias/gauge/
// sub-scores/score history) + right panel of named sections (Technicals,
// Institutional Activity, Economic Growth, Inflation, Jobs Market,
// Interest Rates, Retail/Crowd Sentiment, Economic Surprise Index).
// Every number here comes from ScorecardData (lib/pipeline/scorecard.ts)
// or MarketScore — nothing is computed in this file beyond formatting and
// badge coloring. Dark theme, existing CSS variables/components only.
import { BiasThreshold } from "@/lib/config";
import { DataFreshness, Instrument, MarketScore, PriceData, ScoreFactorKey } from "@/lib/types";
import { FactorSentiment, factorSentimentBadgeClasses, formatPrice, formatSigned, formatSignedPct, scoreColorClass } from "@/lib/format";
import { formatDateTime, formatRelative } from "@/lib/time";
import { ScoreGauge } from "@/components/ui/ScoreGauge";
import { ConfidenceBar } from "@/components/ui/ConfidenceBar";
import { Card } from "@/components/ui/Card";
import { DataFreshnessTag, unavailableLeadWord, DATA_FRESHNESS_LABELS } from "@/components/ui/DataFreshnessTag";
import { ScoreHistoryChart } from "@/components/charts/ScoreHistoryChart";
import { PriceScoreOverlayChart } from "@/components/charts/PriceScoreOverlayChart";
import { filterToRecentWindow } from "@/lib/time";
import { IndicatorRow, IndicatorSection, InterestRatesSection, NewsContextSection, ScorecardData, ScoreDriverRow, SurpriseIndexRow, TechnicalsRow, cotChangeLabel } from "@/lib/pipeline/scorecard";
import { UnavailableState } from "@/components/ui/UnavailableState";
import { HEATMAP_LABEL_CLASSES, HeatmapLabel } from "@/lib/pipeline/economic-heatmap";
import { pairDirectionLabel } from "@/lib/pipeline/forex-scorecard";

function StatusBadge({ sentiment }: { sentiment: FactorSentiment | null }) {
  if (!sentiment) {
    return <span className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium text-(--text-faint) border-(--border)">N/A</span>;
  }
  return <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${factorSentimentBadgeClasses(sentiment)}`}>{sentiment}</span>;
}

function badgeFromSurprise(row: IndicatorRow | SurpriseIndexRow): FactorSentiment | null {
  if ("classification" in row) return row.classification;
  // SurpriseIndexRow has no pre-computed classification (V2's surprise is a
  // magnitude, not an asset-directional read) — badge by raw surprise sign
  // only, purely to give the row a visual accent; the numeric columns are
  // the actual data.
  if (row.surprise === null) return null;
  if (row.surprise > 0) return "Bullish";
  if (row.surprise < 0) return "Bearish";
  return "Neutral";
}

// Compact "N contributing factors, X live, Y delayed, Z not applicable"
// trust summary — a pure tally of score.factors' existing freshness values
// (lib/pipeline/scorecard.ts's buildDataQualitySummary), with a tooltip
// explaining that confidence reflects data availability/freshness/coverage
// rather than a separate, unexplained number.
function DataQualitySummaryLine({ summary }: { summary: { total: number; counts: Partial<Record<DataFreshness, number>> } }) {
  const order: DataFreshness[] = ["live", "delayed", "stale", "estimated", "not_applicable", "unavailable", "error"];
  const parts = order.filter((f) => summary.counts[f]).map((f) => `${summary.counts[f]} ${DATA_FRESHNESS_LABELS[f].text.toLowerCase()}`);
  return (
    <p
      className="text-[10px] text-(--text-faint) leading-relaxed"
      title="Confidence reflects data availability, freshness, and coverage across this market's contributing factors — not just the raw score."
    >
      {summary.total} contributing factor{summary.total === 1 ? "" : "s"}
      {parts.length > 0 ? ` — ${parts.join(", ")}` : ""}
    </p>
  );
}

// `compact` renders the section collapsed behind a native <details> instead
// of always-open — for a section that's real but still thin on data (the V2
// Economic Surprise preview; see its own usage below), so it doesn't occupy
// a full section's worth of scroll space next to fully-live sections and
// read as "half-finished" on an otherwise complete Scorecard. The section
// itself is unchanged — same data, same component — only its default
// visibility changes.
function SectionShell({ title, badge, compact = false, id, children }: { title: string; badge?: string; compact?: boolean; id?: string; children: React.ReactNode }) {
  const heading = (
    <h4 className="text-xs font-semibold uppercase tracking-wide text-(--text-faint) mb-2 flex items-center gap-2">
      {title}
      {badge && (
        <span className="normal-case tracking-normal font-medium text-[10px] rounded-full px-1.5 py-0.5 bg-sky-500/10 text-sky-400">{badge}</span>
      )}
    </h4>
  );

  // scroll-mt so a jump from the sticky section nav doesn't land the
  // heading directly under the sticky bar itself.
  if (compact) {
    return (
      <details id={id} className="border-b border-(--border) last:border-0 pb-4 last:pb-0 scroll-mt-24">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{heading}</summary>
        <div className="mt-2">{children}</div>
      </details>
    );
  }

  return (
    <div id={id} className="border-b border-(--border) last:border-0 pb-4 last:pb-0 scroll-mt-24">
      {heading}
      {children}
    </div>
  );
}

function fmtNum(v: number | null, decimals = 2): string {
  if (v === null) return "—";
  return formatSigned(v, decimals);
}

function IndicatorTable({ rows }: { rows: IndicatorRow[] }) {
  if (rows.length === 0) return <UnavailableState>UNAVAILABLE — no released indicators are currently stored for this category.</UnavailableState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-(--text-faint) text-left">
            <th className="font-medium pb-1 pr-2">Status</th>
            <th className="font-medium pb-1 pr-2">Event</th>
            <th className="font-medium pb-1 pr-2 text-right">Actual</th>
            <th className="font-medium pb-1 pr-2 text-right">Forecast</th>
            <th className="font-medium pb-1 pr-2 text-right">Surprise</th>
            <th className="font-medium pb-1 text-right">Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.indicatorKey} className="border-t border-(--border)" title={r.source}>
              <td className="py-1.5 pr-2">
                <StatusBadge sentiment={badgeFromSurprise(r)} />
              </td>
              <td className="py-1.5 pr-2 whitespace-nowrap">{r.label}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums font-medium">{fmtNum(r.actual)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-(--text-faint)">{r.forecast === null ? "unavailable" : fmtNum(r.forecast)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-(--text-faint)">{r.surprise === null ? "unavailable" : fmtNum(r.surprise)}</td>
              <td className="py-1.5 text-right tabular-nums text-(--text-faint) whitespace-nowrap">{r.date.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Renders the calendar-release table when real releases exist; otherwise
// falls back to the Macro State view (real FRED level + period-over-period
// trend, see lib/pipeline/scorecard.ts's resolveMacroStateRow) instead of
// leaving the section blank; "unavailable" only when neither has any real
// data for this country/indicator.
function IndicatorSectionView({ section }: { section: IndicatorSection }) {
  if (section.kind === "calendar") return <IndicatorTable rows={section.rows} />;
  if (section.kind === "unavailable") return <UnavailableState>UNAVAILABLE — {section.reason}</UnavailableState>;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-(--text-faint)">No calendar release stored for this category yet — showing the underlying macro trend instead.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-(--text-faint) text-left">
              <th className="font-medium pb-1 pr-2">Status</th>
              <th className="font-medium pb-1 pr-2">Indicator</th>
              <th className="font-medium pb-1 pr-2 text-right">Value</th>
              <th className="font-medium pb-1 pr-2 text-right">Change</th>
              <th className="font-medium pb-1 pr-2">Trend</th>
              <th className="font-medium pb-1 text-right">Date</th>
            </tr>
          </thead>
          <tbody>
            {section.rows.map((r) => (
              <tr key={r.label} className="border-t border-(--border)" title={r.source}>
                <td className="py-1.5 pr-2">
                  <StatusBadge sentiment={r.classification} />
                </td>
                <td className="py-1.5 pr-2 whitespace-nowrap">{r.label}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums font-medium">{fmtNum(r.value)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-(--text-faint)">{formatSigned(r.changeAbs, 2)}</td>
                <td className="py-1.5 pr-2 whitespace-nowrap text-(--text-faint)">{r.trend}</td>
                <td className="py-1.5 text-right tabular-nums text-(--text-faint) whitespace-nowrap">{r.date.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Compact positive/negative driver list — a pure re-sort/re-label of the
// same score.factors contributions shown elsewhere on this scorecard (see
// lib/pipeline/scorecard.ts's buildScoreDrivers). No new numbers, no
// generated text — every contribution/explanation here is the real
// already-computed one.
function ScoreDriversView({ drivers }: { drivers: { positive: ScoreDriverRow[]; negative: ScoreDriverRow[] } }) {
  if (drivers.positive.length === 0 && drivers.negative.length === 0) {
    return <UnavailableState>UNAVAILABLE — no factor is currently pushing the score in either direction.</UnavailableState>;
  }
  return (
    <div className="grid sm:grid-cols-2 gap-3 text-xs">
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wide text-emerald-400/80 mb-1">Pushing bullish</div>
        {drivers.positive.length === 0 ? (
          <p className="text-(--text-faint)">None</p>
        ) : (
          drivers.positive.map((d) => (
            <div key={d.key} className="flex items-center justify-between gap-2" title={d.explanation}>
              <span>{d.label}</span>
              <span className="tabular-nums font-medium text-emerald-400">{formatSigned(d.contribution)}</span>
            </div>
          ))
        )}
      </div>
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wide text-rose-400/80 mb-1">Pushing bearish</div>
        {drivers.negative.length === 0 ? (
          <p className="text-(--text-faint)">None</p>
        ) : (
          drivers.negative.map((d) => (
            <div key={d.key} className="flex items-center justify-between gap-2" title={d.explanation}>
              <span>{d.label}</span>
              <span className="tabular-nums font-medium text-rose-400">{formatSigned(d.contribution)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TechnicalsRows({ rows }: { rows: TechnicalsRow[] }) {
  if (rows.length === 0) return <UnavailableState>UNAVAILABLE — no factor data available.</UnavailableState>;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-2 text-xs" title={`${r.source} — ${r.explanation}`}>
          <span>{r.label}</span>
          <div className="flex items-center gap-2">
            <DataFreshnessTag freshness={r.freshness} />
            <StatusBadge sentiment={r.classification} />
          </div>
        </div>
      ))}
    </div>
  );
}

function InterestRatesView({ section }: { section: InterestRatesSection }) {
  if (section.kind === "gold-drivers") {
    if (section.drivers.length === 0) return <UnavailableState>UNAVAILABLE — no gold-macro-regime series resolved.</UnavailableState>;
    return (
      <div className="space-y-1.5">
        {section.drivers.map((d) => (
          <div key={d.label} className="flex items-center justify-between gap-2 text-xs" title={d.explanation}>
            <span>{d.label}</span>
            <div className="flex items-center gap-2 tabular-nums">
              <span className="text-(--text-faint)">{formatSigned(d.changeValue, 2)}</span>
              <StatusBadge sentiment={d.contribution > 0 ? "Bullish" : d.contribution < 0 ? "Bearish" : "Neutral"} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const { policyRate, differential, yield2y } = section;
  return (
    <dl className="space-y-1.5 text-xs">
      <div className="flex items-center justify-between gap-2" title={policyRate.source}>
        <dt className="text-(--text-faint)">Current policy rate</dt>
        <dd className="tabular-nums font-medium">{policyRate.data ? `${policyRate.data.rate.toFixed(2)}% (${policyRate.data.date})` : "unavailable"}</dd>
      </div>
      {differential && (
        <div className="flex items-center justify-between gap-2" title={differential.source}>
          <dt className="text-(--text-faint)">Rate differential</dt>
          <dd className="tabular-nums font-medium">{differential.data ? `${differential.data.baseRate.toFixed(2)}% vs ${differential.data.quoteRate.toFixed(2)}% (${formatSigned(differential.data.diffPts, 2)}pt)` : "unavailable"}</dd>
        </div>
      )}
      <div className="flex items-center justify-between gap-2" title={yield2y.source}>
        <dt className="text-(--text-faint)">2Y yield</dt>
        <dd className="tabular-nums font-medium">{yield2y.data ? `${yield2y.data.rate.toFixed(2)}% (${yield2y.data.date})` : "unavailable"}</dd>
      </div>
    </dl>
  );
}

function SurpriseIndexTable({ section, symbol }: { section: ScorecardData["surpriseIndex"]; symbol: string }) {
  return (
    <>
      {section.limited && (
        <p className="text-[11px] text-(--text-faint) mb-2">
          Preview — real economic-release history for {symbol} is still accumulating. This section fills in as more releases are detected; it does not affect your V1 score above.
        </p>
      )}
      {section.rows.length === 0 ? (
        <p className="text-xs text-(--text-faint)">No release history recorded for this market yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-(--text-faint) text-left">
                <th className="font-medium pb-1 pr-2">Status</th>
                <th className="font-medium pb-1 pr-2">Country</th>
                <th className="font-medium pb-1 pr-2">Indicator</th>
                <th className="font-medium pb-1 pr-2 text-right">Actual</th>
                <th className="font-medium pb-1 pr-2 text-right">Forecast</th>
                <th className="font-medium pb-1 pr-2 text-right">Surprise Z</th>
                <th className="font-medium pb-1 pr-2">Impact</th>
                <th className="font-medium pb-1 text-right">Date</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map((r, i) => (
                <tr key={`${r.indicatorKey}-${r.date}-${i}`} className="border-t border-(--border)">
                  <td className="py-1.5 pr-2">
                    <StatusBadge sentiment={badgeFromSurprise(r)} />
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{r.country}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{r.indicatorKey}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums font-medium">{fmtNum(r.actual)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-(--text-faint)">{r.forecast === null ? "unavailable" : fmtNum(r.forecast)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-(--text-faint)">{r.surpriseZ === null ? "unavailable" : r.surpriseZ.toFixed(2)}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{r.importanceTier}</td>
                  <td className="py-1.5 text-right tabular-nums text-(--text-faint) whitespace-nowrap">{formatDateTime(r.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// Compact "base value / quote value / difference + direction pill" row —
// the same shape the old standalone /forex-scorecard/[pair] page used,
// rebuilt here since that page no longer exists (the Scorecard rename
// folds FX cross-currency comparison directly into the per-instrument
// Scorecard instead of a second deep-dive implementation).
function DifferentialRow({
  label,
  baseLabel,
  baseValue,
  quoteLabel,
  quoteValue,
  differential,
  band,
  base,
  quote,
  decimals = 0,
  unit = "",
}: {
  label: string;
  baseLabel: string;
  baseValue: string;
  quoteLabel: string;
  quoteValue: string;
  differential: number;
  band: HeatmapLabel | null;
  base: string;
  quote: string;
  decimals?: number;
  unit?: string;
}) {
  return (
    <div className="text-xs">
      <div className="text-(--text-faint) mb-1">{label}</div>
      <div className="space-y-1">
        <Row label={baseLabel} value={baseValue} />
        <Row label={quoteLabel} value={quoteValue} />
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-(--border)">
          <span className="text-(--text-faint)">Difference</span>
          <div className="flex items-center gap-2">
            <span className="font-semibold tabular-nums">{formatSigned(differential, decimals)}{unit}</span>
            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${band ? HEATMAP_LABEL_CLASSES[band] : ""}`}>
              {pairDirectionLabel(band, base, quote)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// FX-only — folds the old standalone Forex Scorecard's base-vs-quote
// comparison into this Scorecard. Reuses ForexScorecardData verbatim
// (forex-scorecard.ts), including its already-computed bands and
// deterministic narrative sentence — nothing recomputed here.
function CurrencyComparisonView({ data }: { data: NonNullable<ScorecardData["currencyComparison"]> }) {
  return (
    <div className="space-y-3">
      {data.narrative && <p className="text-xs text-(--text-dim) leading-relaxed">{data.narrative}</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        {data.strengthDifferential !== null && data.baseStrength.score !== null && data.quoteStrength.score !== null ? (
          <DifferentialRow
            label="Economic Strength"
            baseLabel={data.base}
            baseValue={`${formatSigned(data.baseStrength.score, 0)}${data.baseStrength.level ? ` (${data.baseStrength.level})` : ""}`}
            quoteLabel={data.quote}
            quoteValue={`${formatSigned(data.quoteStrength.score, 0)}${data.quoteStrength.level ? ` (${data.quoteStrength.level})` : ""}`}
            differential={data.strengthDifferential}
            band={data.strengthBand}
            base={data.base}
            quote={data.quote}
          />
        ) : (
          <UnavailableState>UNAVAILABLE — no verified economic-strength score yet for one or both currencies.</UnavailableState>
        )}
        {data.rateDifferentialPts !== null && data.baseRate !== null && data.quoteRate !== null ? (
          <DifferentialRow
            label="Interest Rates"
            baseLabel={`${data.base} policy rate`}
            baseValue={`${data.baseRate}%`}
            quoteLabel={`${data.quote} policy rate`}
            quoteValue={`${data.quoteRate}%`}
            differential={data.rateDifferentialPts}
            band={data.rateBand}
            base={data.base}
            quote={data.quote}
            decimals={2}
            unit="%"
          />
        ) : (
          <UnavailableState>UNAVAILABLE — no verified policy-rate series yet for one or both currencies.</UnavailableState>
        )}
      </div>
      {data.surpriseDifferential !== null && data.baseSurprise !== null && data.quoteSurprise !== null ? (
        <DifferentialRow
          label="Economic Surprise"
          baseLabel={data.base}
          baseValue={formatSigned(data.baseSurprise, 1)}
          quoteLabel={data.quote}
          quoteValue={formatSigned(data.quoteSurprise, 1)}
          differential={data.surpriseDifferential}
          band={data.surpriseBand}
          base={data.base}
          quote={data.quote}
          decimals={1}
        />
      ) : (
        <UnavailableState>UNAVAILABLE — no recent economic-release surprises detected for either currency yet.</UnavailableState>
      )}
      <div className="flex items-center gap-4 text-xs pt-1">
        <TrendMini label="Daily" trend={data.dailyTrend} />
        <TrendMini label="4H" trend={data.h4Trend} />
        <TrendMini label="1H" trend={data.h1Trend} />
        {data.retail && (
          <span className="text-(--text-faint)">
            Retail {data.retail.pctLong.toFixed(0)}% long{data.retail.contrarianBias !== "Neutral" ? ` — Contrarian ${data.retail.contrarianBias}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

function TrendMini({ label, trend }: { label: string; trend: "Bullish" | "Bearish" | "Neutral" | null }) {
  return (
    <span className="text-(--text-faint)">
      {label} <span className={trend === "Bullish" ? "text-emerald-400" : trend === "Bearish" ? "text-rose-400" : "text-(--text-dim)"}>{trend ?? "—"}</span>
    </span>
  );
}

// News & Market Context — composed entirely from fields the real
// ingestion pipeline already classified at write time (importance/
// geopolitical/monetary-policy relevance, risk sentiment); no new
// provider call, no summarization at render time. See
// scorecard.ts's resolveNewsContext.
function NewsContextView({ context, symbol }: { context: NewsContextSection; symbol: string }) {
  const hasAnything = context.latest.length > 0 || context.monetaryPolicy || context.geopolitical || context.riskSentiment || context.upcomingEvent;
  if (!hasAnything) {
    return <UnavailableState>UNAVAILABLE — no recent news or scheduled high-impact releases are currently tagged to {symbol}.</UnavailableState>;
  }
  return (
    <div className="space-y-3 text-xs">
      {context.latest.length > 0 && (
        <div>
          <div className="text-(--text-faint) mb-1">Latest important developments</div>
          <ul className="space-y-1.5">
            {context.latest.map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-2">
                <span className="leading-snug">{n.headline}</span>
                <span className="shrink-0 text-(--text-faint)">{formatRelative(n.publishedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {context.monetaryPolicy && (
        <Row label="Monetary-policy context" value={context.monetaryPolicy.headline} />
      )}
      {context.geopolitical && (
        <Row label="Geopolitical context" value={context.geopolitical.headline} />
      )}
      {context.riskSentiment && <Row label="Risk sentiment" value={context.riskSentiment} />}
      {context.upcomingEvent && (
        <Row label="Important upcoming event" value={`${context.upcomingEvent.event} (${context.upcomingEvent.country}) — ${formatDateTime(context.upcomingEvent.dateTime)}`} />
      )}
    </div>
  );
}

// Sticky compact anchor nav for a long Scorecard — plain scroll-to-section
// links (no scroll-spy) to keep this simple; see the page's section ids.
const SECTION_NAV_ITEMS = [
  { id: "sc-overview", label: "Overview" },
  { id: "sc-technical", label: "Technical" },
  { id: "sc-positioning", label: "Positioning" },
  { id: "sc-macro", label: "Macro" },
  { id: "sc-rates", label: "Rates" },
  { id: "sc-news", label: "News" },
];

function ScorecardSectionNav() {
  return (
    <div className="sticky top-14 z-20 -mx-1 mb-1 flex flex-wrap gap-1 rounded-lg border border-(--border) bg-(--bg-elevated)/95 backdrop-blur px-2 py-1.5 text-xs">
      {SECTION_NAV_ITEMS.map((s) => (
        <a key={s.id} href={`#${s.id}`} className="rounded-md px-2 py-1 text-(--text-faint) hover:text-(--text-dim) hover:bg-white/[.04] transition-colors">
          {s.label}
        </a>
      ))}
    </div>
  );
}

export function Scorecard({
  instrument,
  score,
  data,
  biasThresholds,
  price,
  priceFreshness,
}: {
  instrument: Instrument;
  score: MarketScore;
  data: ScorecardData;
  biasThresholds: BiasThreshold[];
  price: PriceData | null;
  priceFreshness: DataFreshness;
}) {
  const retailFactor = score.factors.find((f) => f.key === "retailSentiment" as ScoreFactorKey);

  return (
    <div className="space-y-3">
      <ScorecardSectionNav />
      <div id="sc-overview" className="grid lg:grid-cols-3 gap-4 scroll-mt-24">
        {/* Left summary panel */}
        <Card className="lg:col-span-1 flex flex-col items-center">
          <div className="text-center mb-1">
            <div className="text-lg font-semibold">{instrument.symbol}</div>
            <div className="text-xs text-(--text-faint)">{instrument.name}</div>
          </div>
          <div className="text-center mb-3">
            {price ? (
              <>
                <div className="flex items-baseline justify-center gap-2">
                  <span className="text-xl font-semibold tabular-nums">{formatPrice(price.current, instrument.decimals)}</span>
                  <span className={`text-sm tabular-nums font-medium ${scoreColorClass(price.changePct24h)}`}>{formatSignedPct(price.changePct24h)}</span>
                </div>
                <div className="mt-1 flex justify-center">
                  <DataFreshnessTag freshness={priceFreshness} />
                </div>
              </>
            ) : (
              <UnavailableState>{priceFreshness === "not_applicable" ? "NOT APPLICABLE" : "UNAVAILABLE"} — no current price available.</UnavailableState>
            )}
          </div>
          <ScoreGauge score={score.totalScore} bias={score.bias} />
          <div className="w-full mt-3 space-y-1.5 text-xs">
            <SubScoreRow label="Total score" value={score.totalScore} bold />
            <SubScoreRow label="Technical score" value={data.subScores.technical} />
            <SubScoreRow label="Sentiment + positioning score" value={data.subScores.sentimentPositioning} />
            <SubScoreRow label="Fundamentals / macro score" value={data.subScores.fundamentals} />
          </div>
          <div className="w-full mt-3">
            <ConfidenceBar value={score.confidence} />
          </div>
          <div className="w-full mt-1.5">
            <DataQualitySummaryLine summary={data.dataQuality} />
          </div>
          <div className="w-full mt-3">
            <div className="text-[10px] text-(--text-faint) uppercase tracking-wide mb-1">Score history (quick view)</div>
            <ScoreHistoryChart history={score.history} thresholds={biasThresholds} height={100} autoWindow />
          </div>
        </Card>

        {/* Right panel — "Why This Score?" leads, since the overview
            question ("what's the bias and why") should resolve before any
            detail section. */}
        <Card className="lg:col-span-2" title="Why This Score?">
          <ScoreDriversView drivers={data.scoreDrivers} />
        </Card>
      </div>

      {price && (
        <Card title="Price & Intelligence History" subtitle="Does the score move before the market does? Real, stored data only — never fabricated.">
          <PriceScoreOverlayChart priceSeries={filterToRecentWindow(price.series)} scoreHistory={score.history} decimals={instrument.decimals} thresholds={biasThresholds} />
        </Card>
      )}

      <Card>
        <div className="space-y-4">
          <SectionShell title="Technicals" id="sc-technical">
            <TechnicalsRows rows={data.technicals} />
          </SectionShell>

          {/* Sentiment & Positioning — retail and CFTC/institutional
              combined into one section (per the redesign spec: "combine
              the most important positioning information in one place"),
              rather than two separate sections a user has to mentally
              connect themselves. */}
          <SectionShell title="Sentiment & Positioning" id="sc-positioning">
            <div className="space-y-4">
              <div>
                <div className="text-[11px] text-(--text-faint) mb-1.5">Retail Sentiment</div>
                {data.retail.data ? (
                  <div className="space-y-1.5 text-xs" title={retailFactor?.explanation}>
                    <div className="flex items-center gap-2 mb-1">
                      <DataFreshnessTag freshness={data.retail.freshness} lastUpdated={data.retail.lastUpdated ?? undefined} />
                      {retailFactor && <StatusBadge sentiment={retailFactor.contribution > 0 ? "Bullish" : retailFactor.contribution < 0 ? "Bearish" : "Neutral"} />}
                    </div>
                    <Row label="Long % / Short %" value={`${data.retail.data.pctLong.toFixed(0)}% / ${data.retail.data.pctShort.toFixed(0)}%`} />
                    <p className="text-[10px] text-(--text-faint) pt-1">Source: {data.retail.source}</p>
                  </div>
                ) : (
                  <UnavailableState>UNAVAILABLE — verified retail sentiment provider not connected yet</UnavailableState>
                )}
              </div>
              <div className="pt-3 border-t border-(--border)">
                <div className="text-[11px] text-(--text-faint) mb-1.5">CFTC / Institutional Positioning</div>
                {data.institutional.data ? (
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <DataFreshnessTag freshness={data.institutional.freshness} lastUpdated={data.institutional.lastUpdated ?? undefined} />
                    </div>
                    <Row label="Net positioning" value={`${data.institutional.data.direction} (${data.institutional.data.strength}) · ${data.institutional.data.netPositioning.toLocaleString()}`} />
                    <Row label="Weekly change" value={formatSigned(data.institutional.data.netWeeklyChange, 0)} />
                    <Row label="Long % / Short %" value={`${data.institutional.data.pctLong.toFixed(0)}% / ${data.institutional.data.pctShort.toFixed(0)}%`} />
                    <Row label="Historical percentile (1y)" value={`${data.institutional.data.reportDate.slice(0, 10)}`} />
                    <Row label="Latest COT change" value={cotChangeLabel(data.institutional.data)} />
                    <p className="text-[10px] text-(--text-faint) pt-1">Source: {data.institutional.source}</p>
                  </div>
                ) : (
                  <UnavailableState>
                    {unavailableLeadWord(data.institutional.freshness)}
                    {data.institutional.reason ? ` — ${data.institutional.reason}` : ""}
                  </UnavailableState>
                )}
              </div>
            </div>
          </SectionShell>

          <div id="sc-macro" className="scroll-mt-24">
            {data.currencyComparison && (
              <SectionShell title="Currency Comparison">
                <CurrencyComparisonView data={data.currencyComparison} />
              </SectionShell>
            )}

            <SectionShell title="Economic Growth">
              <IndicatorSectionView section={data.economicGrowth} />
            </SectionShell>

            <SectionShell title="Inflation">
              <IndicatorSectionView section={data.inflation} />
            </SectionShell>

            <SectionShell title="Jobs Market">
              <IndicatorSectionView section={data.jobsMarket} />
            </SectionShell>
          </div>

          <SectionShell title="Interest Rates" id="sc-rates">
            <InterestRatesView section={data.interestRates} />
          </SectionShell>

          {/* Customer-facing label deliberately drops the internal "V2
              shadow" versioning term — collapsed by default (compact) and
              tagged "Preview" so this accumulating-data section reads as an
              intentional early look, not an unfinished part of the V1
              Scorecard above it. Same underlying data either way. */}
          <SectionShell title="Economic Surprise Intelligence" badge="Preview" compact>
            <SurpriseIndexTable section={data.surpriseIndex} symbol={instrument.symbol} />
          </SectionShell>

          <SectionShell title="News & Market Context" id="sc-news">
            <NewsContextView context={data.newsContext} symbol={instrument.symbol} />
          </SectionShell>
        </div>
      </Card>

      <p className="text-[11px] text-(--text-faint) leading-relaxed px-1">
        The Scorecard combines market, economic, positioning and technical context to help you understand current conditions. It does not guarantee future market direction.
      </p>
    </div>
  );
}

function SubScoreRow({ label, value, bold = false }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-(--text-faint)">{label}</span>
      <span className={`tabular-nums ${bold ? "font-semibold" : "font-medium"} ${value > 0 ? "text-emerald-400" : value < 0 ? "text-rose-400" : "text-(--text-dim)"}`}>{formatSigned(value)}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-(--text-faint)">{label}</span>
      <span className="tabular-nums font-medium">{value}</span>
    </div>
  );
}
