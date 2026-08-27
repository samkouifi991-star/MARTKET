// Forex Scorecard detail — Phase 5 of the platform redesign. Full
// breakdown for one FX pair: base/quote Economic Strength + differential,
// policy rates + differential, economic-surprise differential,
// multi-timeframe technical trend, retail sentiment, and the pair's real
// canonical (V1) score.
import { notFound } from "next/navigation";
import Link from "next/link";
import { FX_PAIRS, buildForexScorecard } from "@/lib/pipeline/forex-scorecard";
import { requireEntitlement } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { StrengthBadge } from "@/components/ui/StrengthBadge";
import { BiasBadge } from "@/components/ui/BiasBadge";
import { formatSigned } from "@/lib/format";
import { ArrowLeft } from "lucide-react";

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
        <StatTile label="Final score" value={data.finalScore !== null ? formatSigned(data.finalScore, 1) : "N/A"} sub={data.finalBias ?? undefined} />
        <StatTile label="Strength differential" value={data.strengthDifferential !== null ? formatSigned(data.strengthDifferential, 0) : "N/A"} sub={`${data.base} vs ${data.quote}`} />
        <StatTile label="Rate differential" value={data.rateDifferentialPts !== null ? `${formatSigned(data.rateDifferentialPts, 2)}pt` : "N/A"} />
        <StatTile label="Surprise differential" value={data.surpriseDifferential !== null ? formatSigned(data.surpriseDifferential, 1) : "N/A"} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title={`${data.base} Economic Strength`}>
          {data.baseStrength.score !== null ? (
            <div className="flex items-center justify-between">
              <span className={`text-2xl font-semibold tabular-nums ${data.baseStrength.score > 0 ? "text-emerald-400" : "text-rose-400"}`}>{formatSigned(data.baseStrength.score, 0)}</span>
              {data.baseStrength.level && <StrengthBadge level={data.baseStrength.level} />}
            </div>
          ) : (
            <p className="text-sm text-(--text-faint)">Unavailable — no verified data yet.</p>
          )}
        </Card>
        <Card title={`${data.quote} Economic Strength`}>
          {data.quoteStrength.score !== null ? (
            <div className="flex items-center justify-between">
              <span className={`text-2xl font-semibold tabular-nums ${data.quoteStrength.score > 0 ? "text-emerald-400" : "text-rose-400"}`}>{formatSigned(data.quoteStrength.score, 0)}</span>
              {data.quoteStrength.level && <StrengthBadge level={data.quoteStrength.level} />}
            </div>
          ) : (
            <p className="text-sm text-(--text-faint)">Unavailable — no verified data yet.</p>
          )}
        </Card>
      </div>

      <Card title="Policy rates">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs text-(--text-faint)">{data.base} policy rate</div>
            <div className="font-medium tabular-nums">{data.baseRate !== null ? `${data.baseRate}%` : "N/A"}</div>
          </div>
          <div>
            <div className="text-xs text-(--text-faint)">{data.quote} policy rate</div>
            <div className="font-medium tabular-nums">{data.quoteRate !== null ? `${data.quoteRate}%` : "N/A"}</div>
          </div>
          <div>
            <div className="text-xs text-(--text-faint)">Differential</div>
            <div className="font-medium tabular-nums">{data.rateDifferentialPts !== null ? `${formatSigned(data.rateDifferentialPts, 2)}pt` : "N/A"}</div>
          </div>
        </div>
      </Card>

      <Card title="Multi-timeframe trend">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-xs text-(--text-faint) mb-1">Daily</div>
            <div className={`text-sm font-medium ${trendClass(data.dailyTrend)}`}>{data.dailyTrend ?? "N/A"}</div>
          </div>
          <div>
            <div className="text-xs text-(--text-faint) mb-1">4H</div>
            <div className={`text-sm font-medium ${trendClass(data.h4Trend)}`}>{data.h4Trend ?? "N/A"}</div>
          </div>
          <div>
            <div className="text-xs text-(--text-faint) mb-1">1H</div>
            <div className={`text-sm font-medium ${trendClass(data.h1Trend)}`}>{data.h1Trend ?? "N/A"}</div>
          </div>
        </div>
      </Card>

      <Card title="Retail sentiment">
        {data.retail ? (
          <div className="flex items-center justify-between text-sm">
            <span>{data.retail.pctLong.toFixed(0)}% long / {data.retail.pctShort.toFixed(0)}% short</span>
            <span className={`text-xs font-medium ${trendClass(data.retail.contrarianBias)}`}>Contrarian: {data.retail.contrarianBias}</span>
          </div>
        ) : (
          <p className="text-sm text-(--text-faint)">Unavailable — no verified retail-sentiment data yet.</p>
        )}
      </Card>

      <Card title="Final score" subtitle="This pair's real canonical score — not a separate blended number">
        {data.finalScore !== null ? (
          <div className="flex items-center justify-between">
            <span className="text-2xl font-semibold tabular-nums">{formatSigned(data.finalScore, 1)}</span>
            {data.finalBias && <BiasBadge bias={data.finalBias} />}
          </div>
        ) : (
          <p className="text-sm text-(--text-faint)">Unavailable — score has not been computed yet for {pair}.</p>
        )}
        <Link href={`/markets/${pair}`} className="text-xs text-(--accent) hover:underline mt-2 inline-block">
          Full scorecard breakdown →
        </Link>
      </Card>
    </div>
  );
}
