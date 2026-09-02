// Forex Scorecard detail — Phase 5 of the platform redesign. Full
// breakdown for one FX pair: base/quote Economic Strength + differential,
// policy rates + differential, economic-surprise differential,
// multi-timeframe technical trend, retail sentiment, and the pair's real
// canonical (V1) score.
import { notFound } from "next/navigation";
import Link from "next/link";
import { FX_PAIRS, buildForexScorecard, pairDirectionLabel } from "@/lib/pipeline/forex-scorecard";
import { HeatmapLabel, HEATMAP_LABEL_CLASSES } from "@/lib/pipeline/economic-heatmap";
import { requireEntitlement } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { BiasBadge } from "@/components/ui/BiasBadge";
import { DataFreshnessTag } from "@/components/ui/DataFreshnessTag";
import { formatSigned } from "@/lib/format";
import { ArrowLeft } from "lucide-react";

// Shared row shape for the Economic Strength / Interest Rates / Economic
// Surprise cards below — each is "base value, quote value, difference +
// direction pill", the exact same layout with different numbers and units.
function DifferentialCard({
  title,
  baseLabel,
  baseValue,
  quoteLabel,
  quoteValue,
  differential,
  band,
  base,
  quote,
  unit = "",
  unavailableReason,
}: {
  title: string;
  baseLabel: string;
  baseValue: string | null;
  quoteLabel: string;
  quoteValue: string | null;
  differential: number | null;
  band: HeatmapLabel | null;
  base: string;
  quote: string;
  unit?: string;
  unavailableReason: string;
}) {
  return (
    <Card title={title}>
      {baseValue !== null && quoteValue !== null && differential !== null ? (
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-(--text-faint)">{baseLabel}</span>
            <span className="font-medium tabular-nums">{baseValue}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-(--text-faint)">{quoteLabel}</span>
            <span className="font-medium tabular-nums">{quoteValue}</span>
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-(--border)">
            <span className="text-(--text-faint)">Difference</span>
            <div className="flex items-center gap-2">
              <span className="font-semibold tabular-nums">{formatSigned(differential, unit === "%" ? 2 : 0)}{unit}</span>
              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${band ? HEATMAP_LABEL_CLASSES[band] : ""}`}>
                {pairDirectionLabel(band, base, quote)}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <DataFreshnessTag freshness="unavailable" reason={unavailableReason} />
      )}
    </Card>
  );
}

export function generateStaticParams() {
  return FX_PAIRS.map((symbol) => ({ pair: symbol }));
}

export async function generateMetadata({ params }: { params: Promise<{ pair: string }> }) {
  const { pair } = await params;
  return { title: `${pair} Forex Scorecard — Market Intelligence AI` };
}

export const dynamic = "force-dynamic";

function trendClass(label: "Bullish" | "Bearish" | "Neutral" | null): string {
  if (label === "Bullish") return "text-emerald-400";
  if (label === "Bearish") return "text-rose-400";
  return "text-(--text-faint)";
}

export default async function ForexScorecardDetailPage({ params }: { params: Promise<{ pair: string }> }) {
  await requireEntitlement();
  const { pair } = await params;
  if (!FX_PAIRS.includes(pair)) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/forex-scorecard" className="text-xs text-(--text-faint) hover:text-(--text) flex items-center gap-1 mb-1">
            <ArrowLeft size={12} /> All pairs
          </Link>
          <h1 className="text-xl font-semibold">{pair}</h1>
        </div>
      </div>

      {isDemoOnly() ? (
        <Card>
          <p className="text-sm text-(--text-faint)">Becomes live once DATA_MODE is set to hybrid or live.</p>
        </Card>
      ) : (
        <ScorecardDetail pair={pair} />
      )}
    </div>
  );
}

async function ScorecardDetail({ pair }: { pair: string }) {
  const data = await buildForexScorecard(pair, true);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile
          label="Final score"
          value={data.finalScore !== null ? formatSigned(data.finalScore, 1) : "—"}
          sub={data.finalScore === null ? "Unavailable" : (data.finalBias ?? undefined)}
        />
        <StatTile
          label="Strength differential"
          value={data.strengthDifferential !== null ? formatSigned(data.strengthDifferential, 0) : "—"}
          sub={data.strengthDifferential === null ? "Unavailable" : `${data.base} vs ${data.quote}`}
        />
        <StatTile
          label="Rate differential"
          value={data.rateDifferentialPts !== null ? `${formatSigned(data.rateDifferentialPts, 2)}pt` : "—"}
          sub={data.rateDifferentialPts === null ? "Unavailable" : undefined}
        />
        <StatTile
          label="Surprise differential"
          value={data.surpriseDifferential !== null ? formatSigned(data.surpriseDifferential, 1) : "—"}
          sub={data.surpriseDifferential === null ? "Unavailable" : undefined}
        />
      </div>

      {/* One deterministic sentence combining the differentials/trend
          already shown above — see synthesizeForexNarrative. Every clause
          is a direct readout of a real field; never generated by an LLM. */}
      {data.narrative && (
        <Card>
          <p className="text-sm leading-relaxed">{data.narrative}</p>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <DifferentialCard
          title="Economic Strength"
          baseLabel={data.base}
          baseValue={data.baseStrength.score !== null ? `${formatSigned(data.baseStrength.score, 0)}${data.baseStrength.level ? ` (${data.baseStrength.level})` : ""}` : null}
          quoteLabel={data.quote}
          quoteValue={data.quoteStrength.score !== null ? `${formatSigned(data.quoteStrength.score, 0)}${data.quoteStrength.level ? ` (${data.quoteStrength.level})` : ""}` : null}
          differential={data.strengthDifferential}
          band={data.strengthBand}
          base={data.base}
          quote={data.quote}
          unavailableReason="No verified economic-strength score yet for one or both currencies."
        />
        <DifferentialCard
          title="Interest Rates"
          baseLabel={`${data.base} policy rate`}
          baseValue={data.baseRate !== null ? `${data.baseRate}%` : null}
          quoteLabel={`${data.quote} policy rate`}
          quoteValue={data.quoteRate !== null ? `${data.quoteRate}%` : null}
          differential={data.rateDifferentialPts}
          band={data.rateBand}
          base={data.base}
          quote={data.quote}
          unit="%"
          unavailableReason="No verified policy-rate series yet for one or both currencies."
        />
      </div>

      <DifferentialCard
        title="Economic Surprise"
        baseLabel={data.base}
        baseValue={data.baseSurprise !== null ? formatSigned(data.baseSurprise, 1) : null}
        quoteLabel={data.quote}
        quoteValue={data.quoteSurprise !== null ? formatSigned(data.quoteSurprise, 1) : null}
        differential={data.surpriseDifferential}
        band={data.surpriseBand}
        base={data.base}
        quote={data.quote}
        unavailableReason="No recent economic-release surprises detected for either currency yet."
      />

      <Card title="Technical">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-xs text-(--text-faint) mb-1">Daily</div>
            <div className={`text-sm font-medium ${trendClass(data.dailyTrend)}`}>{data.dailyTrend ?? <DataFreshnessTag freshness="unavailable" />}</div>
          </div>
          <div>
            <div className="text-xs text-(--text-faint) mb-1">4H</div>
            <div className={`text-sm font-medium ${trendClass(data.h4Trend)}`}>{data.h4Trend ?? <DataFreshnessTag freshness="unavailable" />}</div>
          </div>
          <div>
            <div className="text-xs text-(--text-faint) mb-1">1H</div>
            <div className={`text-sm font-medium ${trendClass(data.h1Trend)}`}>{data.h1Trend ?? <DataFreshnessTag freshness="unavailable" />}</div>
          </div>
        </div>
      </Card>

      <Card title="Retail">
        {data.retail ? (
          <div className="flex items-center justify-between text-sm">
            <span>
              {data.retail.pctLong >= data.retail.pctShort ? `${data.retail.pctLong.toFixed(0)}% long` : `${data.retail.pctShort.toFixed(0)}% short`}
            </span>
            {data.retail.contrarianBias !== "Neutral" && (
              <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${data.retail.contrarianBias === "Bullish" ? HEATMAP_LABEL_CLASSES.Bullish : HEATMAP_LABEL_CLASSES.Bearish}`}>
                CONTRARIAN {data.retail.contrarianBias.toUpperCase()}
              </span>
            )}
          </div>
        ) : (
          <DataFreshnessTag freshness="unavailable" reason="No verified retail-sentiment provider connected for this pair yet." />
        )}
      </Card>

      <Card title="Final score" subtitle="This pair's real canonical score — not a separate blended number">
        {data.finalScore !== null ? (
          <div className="flex items-center justify-between">
            <span className="text-2xl font-semibold tabular-nums">{formatSigned(data.finalScore, 1)}</span>
            {data.finalBias && <BiasBadge bias={data.finalBias} />}
          </div>
        ) : (
          <DataFreshnessTag freshness="unavailable" reason={`Score has not been computed yet for ${pair}.`} />
        )}
        <Link href={`/markets/${pair}`} className="text-xs text-(--accent) hover:underline mt-2 inline-block">
          Full scorecard breakdown →
        </Link>
      </Card>
    </div>
  );
}
