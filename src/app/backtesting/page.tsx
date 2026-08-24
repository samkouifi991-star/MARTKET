import { assetClassBacktest, riskRegimeBacktest, scoreRangeBacktest, volRegimeBacktest } from "@/lib/demo/backtest";
import { BacktestClient } from "./BacktestClient";
import { AlertTriangle } from "lucide-react";
import { requireEntitlement } from "@/lib/auth/dal";

export const metadata = { title: "Backtesting — Market Intelligence AI" };

export default async function BacktestingPage() {
  await requireEntitlement();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Historical Score Testing</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Forward 1-, 5- and 20-day returns following each historical score reading, bucketed by score range. Built to avoid look-ahead bias: every bucket only uses information available at the time the score was recorded.
        </p>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-start gap-2.5">
        <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-200">
          This section reports results honestly, including weaker-performing conditions. Formulas are not tuned after the fact to make historical performance look better than it is. Past performance does not guarantee future results.
        </p>
      </div>

      <BacktestClient scoreRange={scoreRangeBacktest()} byAssetClass={assetClassBacktest()} byVolRegime={volRegimeBacktest()} byRiskRegime={riskRegimeBacktest()} />
    </div>
  );
}
