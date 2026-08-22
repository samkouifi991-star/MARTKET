import { Card } from "@/components/ui/Card";
import { SUBSCRIPTION_PLANS, DISCLAIMER } from "@/lib/config";
import { NotificationPrefs } from "./NotificationPrefs";
import { Check } from "lucide-react";

export const metadata = { title: "Settings — Market Intelligence AI" };

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-(--text-faint) mt-1">Manage your profile, notifications, and subscription.</p>
      </div>

      <Card title="Profile">
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-[11px] text-(--text-faint) mb-1">Name</div>
            <div className="font-medium">Jordan Trader</div>
          </div>
          <div>
            <div className="text-[11px] text-(--text-faint) mb-1">Email</div>
            <div className="font-medium">jordan@example.com</div>
          </div>
          <div>
            <div className="text-[11px] text-(--text-faint) mb-1">Plan</div>
            <div className="font-medium">Not subscribed — start your free trial below</div>
          </div>
          <div>
            <div className="text-[11px] text-(--text-faint) mb-1">Theme</div>
            <div className="font-medium">Dark (default) — toggle from the top bar</div>
          </div>
        </div>
      </Card>

      <Card title="Notifications">
        <NotificationPrefs />
      </Card>

      <Card
        title="Subscription plan"
        subtitle="No payment processor is connected in this environment — starting the trial won't charge a card."
      >
        <div className="flex justify-center">
          {SUBSCRIPTION_PLANS.map((plan) => (
            <div
              key={plan.name}
              className="w-full max-w-sm rounded-2xl border-2 border-(--accent) bg-(--accent-soft) p-6 text-center shadow-lg shadow-(--accent)/10"
            >
              <div className="font-semibold text-lg">{plan.name}</div>
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
              <button className="mt-5 w-full h-9 rounded-lg text-sm font-semibold bg-(--accent) text-white">
                Start {plan.trialDays}-Day Free Trial
              </button>
              <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-(--text-faint)">
                <span>${plan.price}/month</span>
                <span>·</span>
                <span>{plan.trialDays} days free</span>
                <span>·</span>
                <span>Cancel anytime</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Legal">
        <p className="text-xs text-(--text-dim) leading-relaxed">{DISCLAIMER}</p>
        <ul className="text-xs text-(--text-faint) mt-3 space-y-1 list-disc list-inside">
          <li>For informational and educational purposes only — not investment advice.</li>
          <li>Past performance does not guarantee future results.</li>
          <li>Scores represent analytical estimates, not certainties.</li>
          <li>Data may be delayed, estimated, or inaccurate — every module labels its freshness.</li>
          <li>You are solely responsible for your own trading decisions.</li>
        </ul>
      </Card>
    </div>
  );
}
