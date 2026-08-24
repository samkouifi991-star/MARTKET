import { CENTRAL_BANKS } from "@/lib/demo/centralBanks";
import { Card } from "@/components/ui/Card";
import { formatDate } from "@/lib/time";
import { requireEntitlement } from "@/lib/auth/dal";

export const metadata = { title: "Interest Rates & Monetary Policy — Market Intelligence AI" };

const STANCE_CLASSES: Record<string, string> = {
  Hawkish: "text-rose-400 bg-rose-500/10",
  Dovish: "text-emerald-400 bg-emerald-500/10",
  Neutral: "text-slate-300 bg-slate-500/10",
};

export default async function InterestRatesPage() {
  await requireEntitlement();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Interest Rates &amp; Monetary Policy</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Policy rates, meeting-implied probabilities, and yield curves for every major central bank. For currency pairs, the rate differential between the two currencies drives the interest-rate factor; for equities and metals, real yields and rate expectations are used instead.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {CENTRAL_BANKS.map((cb) => (
          <Card key={cb.code} title={`${cb.name} (${cb.currency})`} action={<span className={`text-[11px] rounded-full px-2 py-0.5 font-medium ${STANCE_CLASSES[cb.stance]}`}>{cb.stance}</span>}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
              <Metric label="Current rate" value={`${cb.currentRate}%`} />
              <Metric label="Previous rate" value={`${cb.previousRate}%`} />
              <Metric label="Next meeting" value={formatDate(cb.nextMeeting)} />
              <Metric label="Yield curve slope" value={`${cb.yieldCurveSlope > 0 ? "+" : ""}${cb.yieldCurveSlope}pt`} />
              <Metric label="2yr yield" value={`${cb.yield2y}%`} />
              <Metric label="10yr yield" value={`${cb.yield10y}%`} />
            </div>
            <div className="mb-3">
              <div className="text-[11px] text-(--text-faint) mb-1">Meeting-implied probability</div>
              <div className="flex h-2 rounded-full overflow-hidden bg-(--border)">
                <div className="bg-rose-400" style={{ width: `${cb.probHike}%` }} title={`Hike ${cb.probHike}%`} />
                <div className="bg-slate-400" style={{ width: `${cb.probHold}%` }} title={`Hold ${cb.probHold}%`} />
                <div className="bg-emerald-400" style={{ width: `${cb.probCut}%` }} title={`Cut ${cb.probCut}%`} />
              </div>
              <div className="flex justify-between text-[10px] text-(--text-faint) mt-1">
                <span>Hike {cb.probHike}%</span>
                <span>Hold {cb.probHold}%</span>
                <span>Cut {cb.probCut}%</span>
              </div>
            </div>
            <p className="text-xs text-(--text-dim) leading-relaxed border-t border-(--border) pt-2">{cb.lastStatement}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-(--text-faint)">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}
