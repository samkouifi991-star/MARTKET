import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { SUBSCRIPTION_PLANS, DISCLAIMER } from "@/lib/config";
import { NotificationPrefs } from "./NotificationPrefs";
import { requireSession, isAdminUser, isEntitled } from "@/lib/auth/dal";
import { getSubscriptionByUserId } from "@/db/queries/users";
import { signout } from "@/lib/auth/actions";
import { startTrialCheckout, openBillingPortal } from "@/lib/actions/billing";
import { formatDate } from "@/lib/time";
import { Check } from "lucide-react";

export const metadata = { title: "Settings — Market Intelligence AI" };
export const dynamic = "force-dynamic";

function daysUntil(date: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / (24 * 3600_000)));
}

const STATUS_LABEL: Record<string, string> = {
  trialing: "Free trial",
  active: "Active",
  canceled: "Canceled",
  past_due: "Payment past due",
  unpaid: "Payment failed",
  incomplete: "Incomplete",
  incomplete_expired: "Expired",
};

export default async function SettingsPage() {
  const user = await requireSession();
  const subscription = await getSubscriptionByUserId(user.id);
  const admin = isAdminUser(user);
  const entitled = admin || isEntitled(subscription ?? undefined);
  const plan = SUBSCRIPTION_PLANS[0];

  let planStatusLine: string;
  if (admin) {
    planStatusLine = "Admin access (owner account — subscription not required)";
  } else if (subscription?.status === "trialing" && subscription.trialEndsAt) {
    const days = daysUntil(subscription.trialEndsAt);
    planStatusLine = `Trial ends in ${days} day${days === 1 ? "" : "s"} — ${formatDate(subscription.trialEndsAt.toISOString())}`;
  } else if (subscription?.status === "active" && subscription.currentPeriodEnd) {
    planStatusLine = subscription.cancelAtPeriodEnd
      ? `Active — cancels on ${formatDate(subscription.currentPeriodEnd.toISOString())}`
      : `Active — renews ${formatDate(subscription.currentPeriodEnd.toISOString())}`;
  } else if (subscription) {
    planStatusLine = `${STATUS_LABEL[subscription.status] ?? subscription.status} — update payment below to restore access`;
  } else {
    planStatusLine = "Not subscribed — start your free trial below";
  }

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
            <div className="font-medium">{user.name || "—"}</div>
          </div>
          <div>
            <div className="text-[11px] text-(--text-faint) mb-1">Email</div>
            <div className="font-medium">{user.email}</div>
          </div>
          <div>
            <div className="text-[11px] text-(--text-faint) mb-1">Plan</div>
            <div className="font-medium">{planStatusLine}</div>
          </div>
          <div>
            <div className="text-[11px] text-(--text-faint) mb-1">Theme</div>
            <div className="font-medium">Dark (default) — toggle from the top bar</div>
          </div>
        </div>
        <form action={signout} className="mt-4">
          <button type="submit" className="text-xs text-(--text-dim) hover:text-(--text) underline underline-offset-2">
            Sign out
          </button>
        </form>
      </Card>

      <Card title="Notifications">
        <NotificationPrefs />
      </Card>

      <Card
        title="Subscription plan"
        subtitle={
          process.env.STRIPE_SECRET_KEY
            ? "Billing is handled securely by Stripe — this app never sees or stores your card details."
            : "Billing isn't connected in this environment yet — starting the trial won't charge a card."
        }
      >
        <div className="flex justify-center">
          <div className="w-full max-w-sm rounded-2xl border-2 border-(--accent) bg-(--accent-soft) p-6 text-center shadow-lg shadow-(--accent)/10">
            <div className="font-semibold text-lg">{plan.name}</div>
            <div className="mt-2 text-4xl font-semibold tabular-nums">
              ${plan.price}
              <span className="text-sm text-(--text-faint) font-normal">/month</span>
            </div>
            <div className="mt-1.5 text-sm font-medium text-(--accent)">{planStatusLine}</div>
            <ul className="mt-4 space-y-1.5 text-left">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-1.5 text-xs text-(--text-dim)">
                  <Check size={13} className="text-emerald-400 mt-0.5 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            {entitled && subscription?.stripeCustomerId ? (
              <form action={openBillingPortal} className="mt-5">
                <button type="submit" className="w-full h-9 rounded-lg text-sm font-semibold bg-(--accent) text-white">
                  Manage billing
                </button>
              </form>
            ) : (
              <form action={startTrialCheckout} className="mt-5">
                <button type="submit" className="w-full h-9 rounded-lg text-sm font-semibold bg-(--accent) text-white">
                  Start {plan.trialDays}-Day Free Trial
                </button>
              </form>
            )}
            <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-(--text-faint)">
              <span>${plan.price}/month</span>
              <span>·</span>
              <span>{plan.trialDays} days free</span>
              <span>·</span>
              <span>Cancel anytime</span>
            </div>
          </div>
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
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <Link href="/legal/terms" className="text-(--accent) hover:underline">Terms of Service</Link>
          <Link href="/legal/privacy" className="text-(--accent) hover:underline">Privacy Policy</Link>
          <Link href="/legal/subscription-policy" className="text-(--accent) hover:underline">Subscription & Cancellation Policy</Link>
        </div>
      </Card>
    </div>
  );
}
