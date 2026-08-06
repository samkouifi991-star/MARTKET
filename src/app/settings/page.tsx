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
            <div className="font-medium">Free</div>
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

      <Card title="Subscription plans" subtitle="Billed via Stripe (test mode in this demo)">
        <div className="grid sm:grid-cols-3 gap-4">
          {SUBSCRIPTION_PLANS.map((plan) => (
            <div key={plan.name} className={`rounded-xl border p-4 ${plan.name === "Pro" ? "border-(--accent) bg-(--accent-soft)" : "border-(--border)"}`}>
              <div className="font-semibold">{plan.name}</div>
              <div className="text-2xl font-semibold mt-1">${plan.price}<span className="text-sm text-(--text-faint) font-normal">/mo</span></div>
              <ul className="mt-3 space-y-1.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-xs text-(--text-dim)">
                    <Check size={13} className="text-emerald-400 mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <button className={`mt-4 w-full h-8 rounded-lg text-xs font-medium ${plan.name === "Free" ? "border border-(--border) text-(--text-dim)" : "bg-(--accent) text-white"}`}>
                {plan.name === "Free" ? "Current plan" : `Upgrade to ${plan.name}`}
              </button>
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
