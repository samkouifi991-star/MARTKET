import { LegalLayout } from "@/components/marketing/LegalLayout";
import { verifySession } from "@/lib/auth/dal";

export const metadata = { title: "Subscription & Cancellation Policy — Market Intelligence AI" };

export default async function SubscriptionPolicyPage() {
  const sessionUser = await verifySession();
  return (
    <LegalLayout title="Subscription & Cancellation Policy" updated="2026" user={sessionUser ? { email: sessionUser.email } : null}>
      <h2>The plan</h2>
      <p>
        Market Intelligence AI offers a single plan — Market Intelligence Pro — at $39/month. There is no Free plan, no
        Professional tier, and no annual plan.
      </p>

      <h2>Free trial</h2>
      <p>
        New subscriptions include a 3-day free trial. You will not be charged when the trial starts — a valid payment method is
        required to start the trial, but it is only charged once the trial ends. You can cancel any time during the trial and pay
        nothing.
      </p>

      <h2>Billing after the trial</h2>
      <p>
        Unless you cancel before the trial ends, your subscription automatically continues at $39/month, billed to the payment
        method on file, according to the subscription terms set up through Stripe. Each successful payment renews access for
        another month.
      </p>

      <h2>Cancellation</h2>
      <p>
        You can cancel at any time from Settings → Manage billing, which opens Stripe&apos;s secure billing portal. Cancellation
        takes effect at the end of your current billing period — you keep access until then, and are not charged again afterward.
      </p>

      <h2>Failed or missed payments</h2>
      <p>
        If a renewal payment fails, your subscription enters a past-due state and paid access is paused until the payment method
        is updated. Your account and saved preferences are never deleted — updating your payment method from the billing portal
        resumes access.
      </p>

      <h2>Refunds</h2>
      <p>
        Because the trial gives you full access before any charge occurs, monthly charges after the trial are generally
        non-refundable. If you believe you were charged in error, contact us and we&apos;ll review it.
      </p>
    </LegalLayout>
  );
}
