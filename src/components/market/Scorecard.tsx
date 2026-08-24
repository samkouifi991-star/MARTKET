// Grouped market-intelligence scorecard — left summary panel (bias/gauge/
// sub-scores/score history) + right panel of named sections (Technicals,
// Institutional Activity, Economic Growth, Inflation, Jobs Market,
// Interest Rates, Retail/Crowd Sentiment, Economic Surprise Index).
// Every number here comes from ScorecardData (lib/pipeline/scorecard.ts)
// or MarketScore — nothing is computed in this file beyond formatting and
// badge coloring. Dark theme, existing CSS variables/components only.
import { BiasThreshold } from "@/lib/config";
import { DataFreshness, Instrument, MarketScore, ScoreFactorKey } from "@/lib/types";
import { FactorSentiment, factorSentiment, factorSentimentBadgeClasses, formatSigned } from "@/lib/format";
import { formatDateTime } from "@/lib/time";
import { ScoreGauge } from "@/components/ui/ScoreGauge";
import { ConfidenceBar } from "@/components/ui/ConfidenceBar";
import { Card } from "@/components/ui/Card";
import { DataFreshnessTag } from "@/components/ui/DataFreshnessTag";
import { ScoreHistoryChart } from "@/components/charts/ScoreHistoryChart";
import { IndicatorRow, IndicatorSection, InterestRatesSection, ScorecardData, SurpriseIndexRow, TechnicalsRow } from "@/lib/pipeline/scorecard";
import { UnavailableState } from "@/components/ui/UnavailableState";

// The uppercase leading word for a not-yet-available section, matching
// DataFreshnessTag's own vocabulary — "not_applicable" (a factor that
// structurally can't exist for this asset, e.g. no CFTC contract) reads
// distinctly from "unavailable" (a real, temporary provider/data gap), the
// same distinction the freshness badge already draws.
function unavailableLeadWord(freshness: DataFreshness): "NOT APPLICABLE" | "UNAVAILABLE" {
  return freshness === "not_applicable" ? "NOT APPLICABLE" : "UNAVAILABLE";
}

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

function SectionShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-(--border) last:border-0 pb-4 last:pb-0">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-(--text-faint) mb-2">{title}</h4>
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
        <p className="text-[11px] text-amber-400/90 mb-2">
          Limited/shadow data — Scoring Engine V2&apos;s economic-release history for {symbol} is still accumulating. This section will fill in as more real releases are detected.
        </p>
      )}
      {section.rows.length === 0 ? (
        <p className="text-xs text-(--text-faint)">No V2 shadow release history recorded for this market yet.</p>
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

export function Scorecard({ instrument, score, data, biasThresholds }: { instrument: Instrument; score: MarketScore; data: ScorecardData; biasThresholds: BiasThreshold[] }) {
  const retailFactor = score.factors.find((f) => f.key === "retailSentiment" as ScoreFactorKey);
  // News has no dedicated screenshot section, but every one of the 9
  // scoring factors must stay visible somewhere in this redesign (nothing
  // silently dropped from the old flat factor list) — shown as its own
  // small section, same row shape as Technicals.
  const newsFactor = score.factors.find((f) => f.key === "news" as ScoreFactorKey);
  const newsRows: TechnicalsRow[] = newsFactor
    ? [{ label: "News & geopolitical risk", classification: factorSentiment(newsFactor.contribution), explanation: newsFactor.explanation, freshness: newsFactor.freshness, lastUpdated: newsFactor.lastUpdated, source: newsFactor.source }]
    : [];

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      {/* Left summary panel */}
      <Card className="lg:col-span-1 flex flex-col items-center">
        <div className="text-center mb-1">
          <div className="text-lg font-semibold">{instrument.symbol}</div>
          <div className="text-xs text-(--text-faint)">{instrument.name}</div>
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
        <div className="w-full mt-3">
          <div className="text-[10px] text-(--text-faint) uppercase tracking-wide mb-1">Score history</div>
          <ScoreHistoryChart history={score.history} thresholds={biasThresholds} height={120} autoWindow />
        </div>
      </Card>

      {/* Right grouped scorecard panel */}
      <Card className="lg:col-span-2" title="Scorecard">
        <div className="space-y-4">
          <SectionShell title="Technicals">
            <TechnicalsRows rows={data.technicals} />
          </SectionShell>

          <SectionShell title="Institutional Activity">
            {data.institutional.data ? (
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <DataFreshnessTag freshness={data.institutional.freshness} lastUpdated={data.institutional.lastUpdated ?? undefined} />
                </div>
                <Row label="COT — Net positioning" value={`${data.institutional.data.direction} (${data.institutional.data.strength}) · ${data.institutional.data.netPositioning.toLocaleString()}` } />
                <Row label="COT — Weekly change" value={formatSigned(data.institutional.data.netWeeklyChange, 0)} />
                <Row label="Long % / Short %" value={`${data.institutional.data.pctLong.toFixed(0)}% / ${data.institutional.data.pctShort.toFixed(0)}%`} />
                <Row label="Latest report date" value={data.institutional.data.reportDate.slice(0, 10)} />
                <p className="text-[10px] text-(--text-faint) pt-1">Source: {data.institutional.source}</p>
              </div>
            ) : (
              <UnavailableState>
                {unavailableLeadWord(data.institutional.freshness)}
                {data.institutional.reason ? ` — ${data.institutional.reason}` : ""}
              </UnavailableState>
            )}
          </SectionShell>

          <SectionShell title="Economic Growth">
            <IndicatorSectionView section={data.economicGrowth} />
          </SectionShell>

          <SectionShell title="Inflation">
            <IndicatorSectionView section={data.inflation} />
          </SectionShell>

          <SectionShell title="Jobs Market">
            <IndicatorSectionView section={data.jobsMarket} />
          </SectionShell>

          <SectionShell title="Interest Rates">
            <InterestRatesView section={data.interestRates} />
          </SectionShell>

          <SectionShell title="News & Geopolitical Risk">
            <TechnicalsRows rows={newsRows} />
          </SectionShell>

          <SectionShell title="Retail / Crowd Sentiment">
            {data.retail.data ? (
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <DataFreshnessTag freshness={data.retail.freshness} lastUpdated={data.retail.lastUpdated ?? undefined} />
                  {retailFactor && <StatusBadge sentiment={retailFactor.contribution > 0 ? "Bullish" : retailFactor.contribution < 0 ? "Bearish" : "Neutral"} />}
                </div>
                <Row label="Long % / Short %" value={`${data.retail.data.pctLong.toFixed(0)}% / ${data.retail.data.pctShort.toFixed(0)}%`} />
                {retailFactor && <p className="text-(--text-dim) leading-relaxed pt-1">{retailFactor.explanation}</p>}
                <p className="text-[10px] text-(--text-faint) pt-1">Source: {data.retail.source}</p>
              </div>
            ) : (
              <UnavailableState>UNAVAILABLE — verified retail sentiment provider not connected yet</UnavailableState>
            )}
          </SectionShell>

          <SectionShell title="Economic Surprise Index (V2 shadow)">
            <SurpriseIndexTable section={data.surpriseIndex} symbol={instrument.symbol} />
          </SectionShell>
        </div>
      </Card>
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
