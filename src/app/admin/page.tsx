import { allMarketRows } from "@/lib/market-data";
import { getCanonicalMarketRows } from "@/lib/pipeline/top-setups";
import { INSTRUMENTS } from "@/lib/instruments";
import { coverageReasonFor, coverageStatusFor } from "@/services/market-coverage";
import { AUDIT_LOGS, API_USAGE, FAILED_JOBS, SYSTEM_ANNOUNCEMENTS, USER_ACTIVITY, AuditLogEntry } from "@/lib/demo/admin";
import { getAdminUserActivity } from "@/db/queries/users";
import { listScoringConfigurationVersions } from "@/db/queries/scoring-config";
import { AdminClient } from "./AdminClient";
import { ProviderHealthTable } from "./ProviderHealthTable";
import { PipelineHealthTable } from "./PipelineHealthTable";
import { buildPipelineHealthReport, buildStaleDataAlerts, PipelineHealthRow } from "@/lib/pipeline/pipeline-health";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { DataFreshnessTag } from "@/components/ui/DataFreshnessTag";
import { factorLabel } from "@/lib/scoring";
import { formatDate, formatRelative } from "@/lib/time";
import { DATA_MODE, isDemoOnly } from "@/services/data-mode";
import { getProviderHealth, ProviderHealthRow } from "@/db/queries/provider-health";
import { requireAdmin } from "@/lib/auth/dal";
import { resolveActiveScoringConfig } from "@/lib/pipeline/scoring-config";
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

async function loadPipelineHealth(): Promise<{ rows: PipelineHealthRow[]; error: string | null }> {
  if (DATA_MODE === "demo") return { rows: [], error: null };
  try {
    return { rows: await buildPipelineHealthReport(), error: null };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function AdminPage() {
  await requireAdmin();
  // Previously always read allMarketRows() (lib/market-data.ts's demo-only
  // generator) regardless of DATA_MODE, so this diagnostic always showed
  // every factor as "estimated" in live/hybrid mode — never the real
  // per-factor freshness the platform is actually serving. includeAll:true
  // since this admin view should audit PARTIAL/BLOCKED markets too, not
  // just the public LAUNCH_READY set.
  const rows = isDemoOnly() ? allMarketRows() : await getCanonicalMarketRows({ includeAll: true });
  const dataQualityIssues = rows.flatMap((r) =>
    r.score.factors
      .filter((f) => f.freshness !== "live")
      .map((f) => ({ symbol: r.instrument.symbol, factor: f }))
  );
  const { rows: providerHealthRows, error: providerHealthError } = await loadProviderHealth();
  const { rows: pipelineHealthRows, error: pipelineHealthError } = await loadPipelineHealth();
  const staleDataAlerts = buildStaleDataAlerts(pipelineHealthRows);
  const activeScoringConfig = await resolveActiveScoringConfig();

  // Phase 18 (public-launch demo sweep): the stat tiles and audit log below
  // used to be hand-picked demo data shown unconditionally regardless of
  // DATA_MODE — real users/subscriptions/session and scoring-version
  // history have existed since the auth/Stripe/scoring-config milestones,
  // just never read back here. API request/rate-limit counts have no real
  // equivalent (this product has no customer-facing API-key system
  // anywhere in the codebase) — demo-only, not shown outside demo mode.
  const demoMode = isDemoOnly();
  const userActivity = demoMode ? null : await getAdminUserActivity();
  const auditLog: AuditLogEntry[] = demoMode
    ? AUDIT_LOGS
    : (await listScoringConfigurationVersions(20)).map((v) => ({
        id: String(v.id),
        actor: v.createdBy,
        action: "Saved scoring configuration",
        detail: v.includesV2Settings ? "V1 weights, bias thresholds, and V2 tuning settings" : "V1 weights and bias thresholds",
        at: v.createdAt.toISOString(),
      }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="text-sm text-(--text-faint) mt-1">Configure the scoring engine, review data quality, and audit every change. Every weight and threshold edit here is versioned.</p>
      </div>

      {demoMode ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="Daily active users" value={USER_ACTIVITY.dailyActiveUsers.toLocaleString()} />
          <StatTile label="Trialing / Subscribers" value={`${USER_ACTIVITY.trialUsers.toLocaleString()} / ${USER_ACTIVITY.subscriberUsers.toLocaleString()}`} />
          <StatTile label="API requests today" value={API_USAGE.requestsToday.toLocaleString()} sub={`${API_USAGE.activeApiKeys} active keys`} />
          <StatTile label="Rate limit" value={`${API_USAGE.rateLimitPerMin}/min`} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Recently active (24h / 7d)" value={`${userActivity!.recentlyActiveUsers24h.toLocaleString()} / ${userActivity!.recentlyActiveUsers7d.toLocaleString()}`} sub="Users with a login session started in the window" />
          <StatTile label="Trialing / Subscribers" value={`${userActivity!.trialUsers.toLocaleString()} / ${userActivity!.subscriberUsers.toLocaleString()}`} />
        </div>
      )}

      <AdminClient initialAuditLog={auditLog} activeScoringConfig={activeScoringConfig} />

      <Card
        title="Scoring Engine V2 (shadow mode)"
        subtitle="Event-driven, asset-specific engine running alongside V1 — not shown to regular users yet"
        action={<Link href="/admin/scoring-v2" className="text-xs text-(--accent) hover:underline">Open comparison page →</Link>}
      >
        <p className="text-sm text-(--text-faint)">
          Compares V1&apos;s live score against V2&apos;s shadow score per market, including the &quot;why did the score change&quot;
          attribution breakdown and any integrity-check failures.
        </p>
      </Card>

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

      <Card
        title="Stale Data Alerts"
        subtitle="Admin-only — never shown to customers. Every field beyond its dataset's established SLA, from the same read as the Data Pipeline Health table below."
      >
        {DATA_MODE === "demo" ? (
          <p className="text-sm text-(--text-faint)">Becomes live once DATA_MODE is set to hybrid or live.</p>
        ) : pipelineHealthError ? (
          <p className="text-sm text-rose-400">Data temporarily unavailable: {pipelineHealthError}</p>
        ) : staleDataAlerts.length === 0 ? (
          <p className="text-sm text-emerald-400">No stale data — every launch market&apos;s pipeline is within SLA.</p>
        ) : (
          <ul className="space-y-1.5">
            {staleDataAlerts.map((a, i) => (
              <li key={`${a.symbol}-${a.dataset}-${i}`} className="flex items-center justify-between text-sm border-b border-(--border) last:border-0 pb-1.5 last:pb-0">
                <span>
                  <Link href={`/markets/${a.symbol}`} className="font-medium hover:text-(--accent)">{a.symbol}</Link>
                  <span className="text-(--text-faint)"> · {a.dataset}</span>
                </span>
                <span className="text-xs text-rose-400 font-medium uppercase tracking-wide">
                  {a.status}
                  {a.ageHours !== null && ` · ${Math.round(a.ageHours)}h`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Data Pipeline Health"
        subtitle={
          DATA_MODE === "demo"
            ? "Becomes live once DATA_MODE is set to hybrid or live"
            : "Per-market freshness age for every dataset feeding the score — highlighted cells are beyond that dataset's own established SLA"
        }
      >
        {DATA_MODE === "demo" ? (
          <p className="text-sm text-(--text-faint)">Pipeline health is populated by the scheduled ingestion jobs once DATA_MODE is hybrid or live. Currently running in demo mode — nothing to show.</p>
        ) : pipelineHealthError ? (
          <p className="text-sm text-rose-400">Data temporarily unavailable: {pipelineHealthError}</p>
        ) : (
          <PipelineHealthTable rows={pipelineHealthRows} />
        )}
      </Card>

      <Card title="Market coverage" subtitle="LAUNCH_READY markets are the only ones shown on public surfaces (Markets, Top Setups, Dashboard rankings, Search, Watchlists, landing page) — PARTIAL/BLOCKED stay visible here only">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-(--text-faint) text-xs">
                <th className="font-medium pb-2 pr-3">Symbol</th>
                <th className="font-medium pb-2 pr-3">Asset class</th>
                <th className="font-medium pb-2 pr-3">Status</th>
                <th className="font-medium pb-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {INSTRUMENTS.map((i) => {
                const status = coverageStatusFor(i.symbol);
                const reason = coverageReasonFor(i.symbol);
                const statusClasses =
                  status === "LAUNCH_READY"
                    ? "text-emerald-400 bg-emerald-500/10"
                    : status === "PARTIAL"
                      ? "text-amber-400 bg-amber-500/10"
                      : "text-rose-400 bg-rose-500/10";
                return (
                  <tr key={i.symbol} className="border-t border-(--border)">
                    <td className="py-1.5 pr-3">
                      <Link href={`/markets/${i.symbol}`} className="font-medium hover:text-(--accent)">{i.symbol}</Link>
                      <span className="text-(--text-faint) text-xs ml-1">{i.name}</span>
                    </td>
                    <td className="py-1.5 pr-3 text-(--text-faint)">{i.assetClass}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusClasses}`}>{status}</span>
                    </td>
                    <td className="py-1.5 text-(--text-faint) text-xs">
                      {reason ?? (status === "PARTIAL" ? "Real provider config exists but hasn't cleared full verification/promotion yet." : "")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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

      {demoMode && (
        <>
          {/* Phase 18 (public-launch demo sweep): "Failed data jobs" duplicates
              what the real Provider health / Stale Data Alerts cards above
              already show honestly, and "System announcements" is purely
              editorial content with no data source at all — both demo-only,
              not shown outside demo mode rather than inventing a real feed
              for either. */}
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
        </>
      )}
    </div>
  );
}
