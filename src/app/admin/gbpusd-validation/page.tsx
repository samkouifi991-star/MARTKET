import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { DATA_MODE, isDemoOnly } from "@/services/data-mode";
import { getGbpusdValidationSnapshot, summarizeValidation } from "@/lib/pipeline/gbpusd-validation";
import { GbpusdValidationTable } from "./GbpusdValidationTable";
import { RunLiveValidationButton } from "./RunLiveValidationButton";
import { ArrowLeft } from "lucide-react";

export const metadata = { title: "GBPUSD Validation — Admin — Market Intelligence AI" };
// Storage-first by default: this page reads the database and provider
// health table, not live providers, so per-request revalidation is cheap
// and safe again (this was previously force-dynamic + a full live-provider
// battery on every render — the root cause of the FMP 429 storm).
export const revalidate = 30;

export default async function GbpusdValidationPage() {
  const demoMode = isDemoOnly();

  return (
    <div className="space-y-6">
      <Link href="/admin" className="inline-flex items-center gap-1 text-xs text-(--text-faint) hover:text-(--text-dim)">
        <ArrowLeft size={13} /> Back to Admin
      </Link>

      <div>
        <h1 className="text-xl font-semibold">GBPUSD dependency-chain validation</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Reads the stored provider-health and database records for every real dependency behind the GBPUSD score — distinct from the general Provider
          Health page, which reports aggregate status across all 25 markets. This page no longer calls providers on render; use{" "}
          <span className="text-(--text-dim)">Run Live Validation</span> below for an on-demand live check. DATA_MODE is currently{" "}
          <code className="text-(--text-dim)">{DATA_MODE}</code>.
        </p>
      </div>

      {demoMode ? (
        <Card title="Dependency chain">
          <p className="text-sm text-(--text-faint)">
            This page reports real provider/database status and only runs when <code className="text-(--text-dim)">DATA_MODE</code> is{" "}
            <code className="text-(--text-dim)">hybrid</code> or <code className="text-(--text-dim)">live</code>. Currently running in demo mode —
            nothing to validate.
          </p>
        </Card>
      ) : (
        <GbpusdValidationBody />
      )}
    </div>
  );
}

async function GbpusdValidationBody() {
  const { rows, dbCounts, dbError } = await getGbpusdValidationSnapshot();
  const summary = summarizeValidation(rows);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatTile label="Required live" value={`${summary.requiredLive}/${summary.requiredTotal}`} valueClassName={summary.allRequiredLive ? "text-emerald-400" : "text-amber-400"} />
        <StatTile label="Optional live" value={`${summary.optionalLive}/${summary.optionalTotal}`} />
        <StatTile label="Stale/Delayed" value={String(summary.degraded)} valueClassName="text-amber-400" />
        <StatTile label="Unavailable" value={String(summary.unavailable)} valueClassName="text-(--text-faint)" />
        <StatTile label="Error" value={String(summary.error)} valueClassName="text-rose-400" />
      </div>

      <Card
        title={summary.allRequiredLive ? "GBPUSD is fully live" : "GBPUSD is not yet fully live"}
        subtitle={
          summary.allRequiredLive
            ? `Every REQUIRED dependency below is live. ${summary.requiredTotal - summary.requiredLive === 0 && summary.optionalTotal - summary.optionalLive > 0 ? `${summary.optionalTotal - summary.optionalLive} OPTIONAL dependency(ies) are still degraded — confidence reflects that, but it does not block readiness.` : "This is evidence, not a guarantee — re-run after any credential or schema change."}`
            : "At least one REQUIRED dependency below is not live. Per the Definition of Done, GBPUSD is not considered fully live until every REQUIRED row reports LIVE — OPTIONAL rows (1H/4H confirmation, retail sentiment, secondary news) may legitimately stay unavailable without blocking readiness."
        }
      >
        <GbpusdValidationTable rows={rows} />
      </Card>

      <RunLiveValidationButton />

      <Card title="Database write/read check" subtitle="Real GBPUSD row counts in raw storage, not just 'tables exist'">
        {dbError ? (
          <div className="text-sm text-rose-400">
            <p>Data temporarily unavailable: {dbError}</p>
            {/relation .* does not exist/i.test(dbError) ? (
              <p className="text-xs text-(--text-faint) mt-2">
                This specific error means DATABASE_URL connects fine, but the tables haven&apos;t been created yet. Run{" "}
                <code className="text-(--text-dim)">npx drizzle-kit push</code> with the real DATABASE_URL (from wherever it was originally set —
                this value can&apos;t be read back once stored as a Vercel &quot;sensitive&quot; variable) to create them.
              </p>
            ) : (
              <p className="text-xs text-(--text-faint) mt-2">Confirm DATABASE_URL is correct and the database is reachable from Vercel&apos;s network.</p>
            )}
          </div>
        ) : dbCounts ? (
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
            <Row label="market_prices" value={dbCounts.marketPrices} />
            <Row label="market_candles (1d)" value={dbCounts.marketCandlesDaily} />
            <Row label="market_candles (4h)" value={dbCounts.marketCandles4h} />
            <Row label="market_candles (1h)" value={dbCounts.marketCandles1h} />
            <Row label="institutional_positioning" value={dbCounts.institutionalPositioning} />
            <Row label="retail_sentiment" value={dbCounts.retailSentiment} />
            <Row label="economic_indicators (US)" value={dbCounts.economicIndicatorsUS} />
            <Row label="economic_indicators (GB)" value={dbCounts.economicIndicatorsGB} />
          </dl>
        ) : (
          <p className="text-sm text-(--text-faint)">No counts available.</p>
        )}
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[11px] text-(--text-faint) uppercase tracking-wide">{label}</dt>
      <dd className={`text-sm font-semibold tabular-nums ${value > 0 ? "text-emerald-400" : "text-(--text-faint)"}`}>{value.toLocaleString()}</dd>
    </div>
  );
}
