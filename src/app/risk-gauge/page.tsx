import { generateRiskGauge } from "@/lib/demo/riskGauge";
import { Card } from "@/components/ui/Card";
import { DEFAULT_RISK_GAUGE_BANDS } from "@/lib/config";
import { requireEntitlement } from "@/lib/auth/dal";

export const metadata = { title: "Risk-On / Risk-Off Gauge — Market Intelligence AI" };

export default async function RiskGaugePage() {
  await requireEntitlement();
  const risk = generateRiskGauge();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Risk-On / Risk-Off Gauge</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          A proprietary but fully transparent composite of cross-asset risk signals, from 0 (strong risk-off) to 100 (strong risk-on). Every component and its exact contribution is shown below.
        </p>
      </div>

      <Card>
        <div className="flex flex-col items-center py-4">
          <div className="text-5xl font-semibold tabular-nums">{risk.value}</div>
          <div className="text-(--text-dim) mt-1">{risk.label}</div>
          <div className="w-full max-w-xl mt-5">
            <div className="h-3 rounded-full overflow-hidden flex">
              <div className="flex-[20] bg-rose-500/70" />
              <div className="flex-[20] bg-rose-400/50" />
              <div className="flex-[19] bg-slate-400/40" />
              <div className="flex-[20] bg-emerald-400/50" />
              <div className="flex-[21] bg-emerald-500/70" />
            </div>
            <div className="relative h-3">
              <div
                className="absolute -top-4 w-0.5 h-4 bg-(--text)"
                style={{ left: `${risk.value}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-(--text-faint) mt-1">
              {DEFAULT_RISK_GAUGE_BANDS.map((b) => (
                <span key={b.label}>{b.label}</span>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card title="What's driving the current reading">
        <div className="space-y-2.5">
          {risk.components.map((c) => (
            <div key={c.label} className="flex items-center justify-between gap-4 py-1.5 border-b border-(--border) last:border-0">
              <div>
                <div className="text-sm font-medium">{c.label}</div>
                <div className="text-xs text-(--text-faint)">{c.detail}</div>
              </div>
              <div className="w-40 shrink-0">
                <div className="h-1.5 rounded-full bg-(--border) relative">
                  <div
                    className={`h-1.5 rounded-full absolute ${c.contribution >= 0 ? "bg-emerald-400 left-1/2" : "bg-rose-400 right-1/2"}`}
                    style={{ width: `${Math.min(50, (Math.abs(c.contribution) / 20) * 50)}%` }}
                  />
                  <div className="absolute left-1/2 top-0 bottom-0 w-px bg-(--border-strong)" />
                </div>
                <div className={`text-right text-xs mt-1 tabular-nums font-medium ${c.contribution >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {c.contribution >= 0 ? "+" : ""}
                  {c.contribution.toFixed(1)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
