import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession, isAdminUser, isEntitled } from "@/lib/auth/dal";
import { getSubscriptionByUserId } from "@/db/queries/users";
import { startTrialCheckout } from "@/lib/actions/billing";
import { PricingCard } from "@/components/marketing/PricingCard";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { signout } from "@/lib/auth/actions";

export const metadata = { title: "Start Your Trial — Market Intelligence AI" };
export const dynamic = "force-dynamic";

const STATUS_MESSAGE: Record<string, string> = {
  canceled: "Your subscription was canceled.",
  past_due: "Your last payment didn't go through.",
  unpaid: "Your subscription payment failed.",
  incomplete_expired: "Your trial checkout expired before it was completed.",
};

export default async function PaywallPage({ searchParams }: { searchParams: Promise<{ error?: string; checkout?: string }> }) {
  const user = await requireSession();
  if (isAdminUser(user)) redirect("/dashboard");

  const subscription = await getSubscriptionByUserId(user.id);
  if (isEntitled(subscription ?? undefined)) redirect("/dashboard");

  const { error, checkout } = await searchParams;
  const statusMessage = subscription ? STATUS_MESSAGE[subscription.status] : undefined;

  return (
    <div className="min-h-dvh flex flex-col">
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center">
          <Link href="/" className="flex items-center gap-2 justify-center mb-6">
            <span className="grid place-items-center w-8 h-8 rounded-lg bg-gradient-to-br from-(--accent) to-cyan-400 text-white font-bold text-sm">
              MI
            </span>
            <span className="font-semibold tracking-tight text-(--text)">Market Intelligence AI</span>
          </Link>

          <h1 className="text-lg font-semibold">
            {statusMessage ? "Reactivate your subscription" : "Start your trial to continue"}
          </h1>
          <p className="text-sm text-(--text-faint) mt-1">
            {statusMessage ?? "You're signed in, but you don't have an active trial or subscription yet."}
          </p>
          {error === "checkout_unavailable" && (
            <p className="text-xs text-rose-400 mt-2">Billing setup failed — please try again in a moment.</p>
          )}
          {checkout === "canceled" && (
            <p className="text-xs text-amber-400 mt-2">Checkout was canceled — no charge was made.</p>
          )}

          <div className="mt-6">
            <PricingCard
              cta={
                <form action={startTrialCheckout}>
                  <button type="submit" className="w-full h-10 rounded-lg bg-(--accent) text-white text-sm font-semibold">
                    Start 3-Day Free Trial
                  </button>
                </form>
              }
            />
          </div>

          <form action={signout} className="mt-6">
            <button type="submit" className="text-xs text-(--text-faint) hover:text-(--text-dim) underline underline-offset-2">
              Sign out
            </button>
          </form>
        </div>
      </div>
      <MarketingFooter />
    </div>
  );
}
