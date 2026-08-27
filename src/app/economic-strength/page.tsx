// Economic Strength Index — Phase 4 of the platform redesign. A
// per-currency composite (-100..100) combining growth, labor, relative
// policy-rate positioning, and recent economic-surprise momentum for the
// 8 currencies this platform tracks. See lib/pipeline/economic-strength.ts
// for the full methodology and its "never fabricate a score" guarantee.
import { requireEntitlement } from "@/lib/auth/dal";
import { isDemoOnly } from "@/services/data-mode";
import { computeAllCurrencyStrengths } from "@/lib/pipeline/economic-strength";
import { Card } from "@/components/ui/Card";
import { StrengthBadge } from "@/components/ui/StrengthBadge";
import { formatSigned } from "@/lib/format";

export const metadata = { title: "Economic Strength Index — Market Intelligence AI" };
export const dynamic = "force-dynamic";

export default async function EconomicStrengthPage() {
  await requireEntitlement();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Economic Strength Index</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          A composite score per currency, combining economic growth, labor market health, relative policy-rate positioning, and recent economic-surprise momentum — real data, this platform&apos;s own methodology.
        </p>
      </div>

      {isDemoOnly() ? (
        <Card>
          <p className="text-sm text-(--text-faint)">Becomes live once DATA_MODE is set to hybrid or live and FRED/economic-release data is populated.</p>
        </Card>
      ) : (
        <StrengthList />
      )}
    </div>
  );
}

async function StrengthList() {
  const currencies = await computeAllCurrencyStrengths(true);
  const ranked = [...currencies].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));

  return (
    <Card title="Ranked by composite strength">
      <div className="space-y-2">
        {ranked.map((c) => (
          <details key={c.currency} className="group rounded-lg border border-(--border) open:border-(--border-strong)">
            <summary className="flex items-center justify-between gap-3 px-3 py-2.5 cursor-pointer list-none">
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-semibold text-sm w-12 shrink-0">{c.currency}</span>
                <span className="text-xs text-(--text-faint) truncate">{c.country}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {c.score !== null ? (
                  <span className={`text-sm font-semibold tabular-nums ${c.score > 0 ? "text-emerald-400" : c.score < 0 ? "text-rose-400" : "text-(--text-dim)"}`}>{formatSigned(c.score, 0)}</span>
                ) : (
                  <span className="text-xs text-(--text-faint)">N/A</span>
                )}
                {c.level ? <StrengthBadge level={c.level} size="sm" /> : <span className="text-[11px] text-(--text-faint)">Unavailable</span>}
              </div>
            </summary>
            <div className="px-3 pb-3 pt-1 border-t border-(--border)">
              {c.drivers.length === 0 ? (
                <p className="text-xs text-(--text-faint)">No verified growth/labor/rate/surprise data currently available for {c.country}.</p>
              ) : (
                <ul className="space-y-1.5">
                  {c.drivers.map((d) => (
                    <li key={d.label} className="flex items-start justify-between gap-3 text-xs">
                      <span className="text-(--text-dim)">{d.explanation}</span>
                      <span className={`shrink-0 tabular-nums font-medium ${d.contribution > 0 ? "text-emerald-400" : d.contribution < 0 ? "text-rose-400" : "text-(--text-faint)"}`}>
                        {formatSigned(d.contribution, 1)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        ))}
      </div>
    </Card>
  );
}
