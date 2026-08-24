import { Check } from "lucide-react";
import { SUBSCRIPTION_PLANS } from "@/lib/config";

export function PricingCard({ cta, microcopy }: { cta: React.ReactNode; microcopy?: React.ReactNode }) {
  const plan = SUBSCRIPTION_PLANS[0];
  return (
    <div className="w-full max-w-sm mx-auto rounded-2xl border-2 border-(--accent) bg-(--accent-soft) p-6 text-center shadow-xl shadow-(--accent)/10">
      <div className="font-semibold text-lg">Market Intelligence {plan.name}</div>
      <div className="mt-2 text-4xl font-semibold tabular-nums">
        ${plan.price}
        <span className="text-sm text-(--text-faint) font-normal">/month</span>
      </div>
      <div className="mt-1.5 text-sm font-medium text-(--accent)">
        {plan.trialDays}-day free trial, then ${plan.price}/month
      </div>
      <ul className="mt-4 space-y-1.5 text-left">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-1.5 text-xs text-(--text-dim)">
            <Check size={13} className="text-emerald-400 mt-0.5 shrink-0" />
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-5">{cta}</div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-(--text-faint)">
        {microcopy ?? (
          <>
            <span>No charge today</span>
            <span>·</span>
            <span>${plan.price}/month after trial</span>
            <span>·</span>
            <span>cancel anytime</span>
          </>
        )}
      </div>
    </div>
  );
}
