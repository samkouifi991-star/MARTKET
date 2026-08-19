import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { DATA_MODE, isDemoOnly } from "@/services/data-mode";
import { getGbpusdValidation, ValidationRow } from "@/lib/pipeline/gbpusd-validation";
import { GbpusdValidationTable } from "./GbpusdValidationTable";
import { ArrowLeft } from "lucide-react";

export const metadata = { title: "GBPUSD Validation — Admin — Market Intelligence AI" };
export const dynamic = "force-dynamic";

// The Definition of Done requires every dependency to be genuinely live —
// an API request merely succeeding is not enough. This page never asserts
// "GBPUSD is LIVE" on its own; it only reports what each dependency
// currently says, so a human decides readiness from real evidence.
function summarize(rows: ValidationRow[]) {
  const live = rows.filter((r) => r.status === "live").length;
  const degraded = rows.filter((r) => r.status === "stale" || r.status === "delayed").length;
  const unavailable = rows.filter((r) => r.status === "unavailable").length;
  const error = rows.filter((r) => r.status === "error").length;
  return { total: rows.length, live, degraded, unavailable, error, allLive: rows.length > 0 && live === rows.length };
}

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
          Live-calls every real dependency behind the GBPUSD score, specifically for GBPUSD — distinct from the general Provider Health page, which
          reports aggregate status across all 25 markets. DATA_MODE is currently <code className="text-(--text-dim)">{DATA_MODE}</code>.
        </p>
      </div>

      {demoMode ? (
        <Card title="Dependency chain">
          <p className="text-sm text-(--text-faint)">
            This page calls real providers directly and only runs when <code className="text-(--text-dim)">DATA_MODE</code> is{" "}
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
  const { rows, dbCounts, dbError, myfxbookDiagnostic } = await getGbpusdValidation();
  const summary = summarize(rows);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatTile label="Dependencies checked" value={String(summary.total)} />
        <StatTile label="Live" value={String(summary.live)} valueClassName="text-emerald-400" />
        <StatTile label="Stale/Delayed" value={String(summary.degraded)} valueClassName="text-amber-400" />
        <StatTile label="Unavailable" value={String(summary.unavailable)} valueClassName="text-(--text-faint)" />
        <StatTile label="Error" value={String(summary.error)} valueClassName="text-rose-400" />
      </div>

      <Card
        title={summary.allLive ? "GBPUSD is fully live" : "GBPUSD is not yet fully live"}
        subtitle={
          summary.allLive
            ? "Every dependency below reports LIVE. This is evidence, not a guarantee — re-run after any credential or schema change."
            : "At least one dependency below is not LIVE. Per the Definition of Done, GBPUSD is not considered fully live until every row here reports LIVE."
        }
      >
        <GbpusdValidationTable rows={rows} />
      </Card>

      <Card title="Myfxbook connection diagnostic" subtitle="Step-by-step, so a failure is traceable to exactly one stage — never logs the password or session token">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
          <DiagnosticStep label="Login successful" ok={myfxbookDiagnostic.loginSuccessful} />
          <DiagnosticStep label="Session received" ok={myfxbookDiagnostic.sessionReceived} />
          <DiagnosticStep label="Community outlook successful" ok={myfxbookDiagnostic.communityOutlookSuccessful} />
          <DiagnosticStep label="GBPUSD found" ok={myfxbookDiagnostic.symbolFound} />
        </dl>
        {myfxbookDiagnostic.error && <p className="text-xs text-rose-400 mt-3">{myfxbookDiagnostic.error}</p>}
      </Card>

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

function DiagnosticStep({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div>
      <dt className="text-[11px] text-(--text-faint) uppercase tracking-wide">{label}</dt>
      <dd className={`text-sm font-semibold ${ok ? "text-emerald-400" : "text-rose-400"}`}>{ok ? "Yes" : "No"}</dd>
    </div>
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
