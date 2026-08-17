import { allMarketRows } from "@/lib/market-data";
import { AUDIT_LOGS, API_USAGE, FAILED_JOBS, SYSTEM_ANNOUNCEMENTS, USER_ACTIVITY } from "@/lib/demo/admin";
import { AdminClient } from "./AdminClient";
import { ProviderHealthTable } from "./ProviderHealthTable";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { DataFreshnessTag } from "@/components/ui/DataFreshnessTag";
import { factorLabel } from "@/lib/scoring";
import { formatDate, formatRelative } from "@/lib/time";
import { DATA_MODE } from "@/services/data-mode";
import { getProviderHealth, ProviderHealthRow } from "@/db/queries/provider-health";
import Link from "next/link";

export const metadata = { title: "Admin — Market Intelligence AI" };
export const dynamic = "force-dynamic";

async function loadProviderHealth(): Promise<{ rows: ProviderHealthRow[]; error: string | null }> {
  if (DATA_MODE === "demo") return { rows: [], error: null };
  try {
    return { rows: await getProviderHealth(), error: null };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function AdminPage() {
  const rows = allMarketRows();
  const dataQualityIssues = rows.flatMap((r) =>
    r.score.factors
      .filter((f) => f.freshness !== "live")
      .map((f) => ({ symbol: r.instrument.symbol, factor: f }))
  );
  const { rows: providerHealthRows, error: providerHealthError } = await loadProviderHealth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="text-sm text-(--text-faint) mt-1">Configure the scoring engine, review data quality, and audit every change. Every weight and threshold edit here is versioned.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Daily active users" value={USER_ACTIVITY.dailyActiveUsers.toLocaleString()} />
        <StatTile label="Free / Pro / Professional" value={`${USER_ACTIVITY.freeUsers.toLocaleString()} / ${USER_ACTIVITY.proUsers.toLocaleString()} / ${USER_ACTIVITY.professionalUsers.toLocaleString()}`} />
        <StatTile label="API requests today" value={API_USAGE.requestsToday.toLocaleString()} sub={`${API_USAGE.activeApiKeys} active keys`} />
        <StatTile label="Rate limit" value={`${API_USAGE.rateLimitPerMin}/min`} />
      </div>

      <AdminClient initialAuditLog={AUDIT_LOGS} />

      <Card
        title="GBPUSD dependency-chain validation"
        subtitle="Live reference market — every provider/dataset behind the GBPUSD score, checked individually"
        action={<Link href="/admin/gbpusd-validation" className="text-xs text-(--accent) hover:underline">Open validation page →</Link>}
      >
        <p className="text-sm text-(--text-faint)">
          {DATA_MODE === "demo"
            ? "Becomes callable once DATA_MODE is set to hybrid or live."
            : "Live-calls FMP, CFTC, FRED, Myfxbook, and IG specifically for GBPUSD and cross-checks against real database row counts — distinct from the aggregate provider health table below."}
        </p>
      </Card>

      <Card
        title="Provider health"
        subtitle={
          DATA_MODE === "demo"
            ? "Becomes live once DATA_MODE is set to hybrid or live and a database is connected"
            : "Status, last success/failure, markets covered, latency and request volume per provider"
        }
      >
        {DATA_MODE === "demo" ? (
          <p className="text-sm text-(--text-faint)">
            Provider health tracking is populated by the scheduled ingestion jobs once <code className="text-(--text-dim)">DATA_MODE</code> is
            <code className="text-(--text-dim)"> hybrid</code> or <code className="text-(--text-dim)">live</code> and{" "}
            <code className="text-(--text-dim)">DATABASE_URL</code> is configured. Currently running in demo mode — nothing to show.
          </p>
        ) : providerHealthError ? (
          <p className="text-sm text-rose-400">Data temporarily unavailable: {providerHealthError}</p>
        ) : (
          <ProviderHealthTable rows={providerHealthRows} />
        )}
      </Card>

      <Card title="Data quality — non-live factors" subtitle="Stale or estimated data is automatically down-weighted in scoring">
        {dataQualityIssues.length === 0 ? (
          <p className="text-sm text-(--text-faint)">All factor data is currently live.</p>
        ) : (
          <div className="space-y-2">
            {dataQualityIssues.map(({ symbol, factor }) => (
              <div key={`${symbol}-${factor.key}`} className="flex items-center justify-between text-sm py-1.5 border-b border-(--border) last:border-0">
                <div>
                  <Link href={`/markets/${symbol}`} className="font-medium hover:text-(--accent)">{symbol}</Link>
                  <span className="text-(--text-faint)"> · {factorLabel(factor.key)}</span>
                </div>
                <DataFreshnessTag freshness={factor.freshness} lastUpdated={factor.lastUpdated} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Failed data jobs">
        <div className="space-y-2">
          {FAILED_JOBS.map((j) => (
            <div key={j.id} className="text-sm py-1.5 border-b border-(--border) last:border-0">
              <div className="flex items-center justify-between">
                <span className="font-medium">{j.job}</span>
                <span className="text-xs text-(--text-faint)">{formatRelative(j.failedAt)} · {j.retries} retries</span>
              </div>
              <p className="text-xs text-rose-400 mt-0.5">{j.error}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="System announcements">
        <ul className="space-y-2">
          {SYSTEM_ANNOUNCEMENTS.map((a) => (
            <li key={a.id} className="text-sm flex items-center justify-between">
              <span>{a.title}</span>
              <span className="text-xs text-(--text-faint)">{formatDate(a.publishedAt)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
