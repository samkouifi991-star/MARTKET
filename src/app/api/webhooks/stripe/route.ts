// Stripe is the billing source of truth: every subscription status/period
// change this app knows about arrives here, never guessed or derived
// client-side. This route is deliberately excluded from session auth (see
// proxy.ts's PUBLIC_PATH_PREFIXES) — Stripe calls it directly, with no
// session cookie, authenticating instead via the signature header this
// handler verifies against STRIPE_WEBHOOK_SECRET.
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { syncSubscription } from "@/lib/billing";

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not configured — rejecting webhook");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      // Belt-and-suspenders alongside api/checkout/sync's synchronous
      // reconciliation — the webhook is what actually matters once the
      // user has left the checkout flow.
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.subscription) {
          const subscription =
            typeof session.subscription === "string" ? await getStripe().subscriptions.retrieve(session.subscription) : session.subscription;
          await syncSubscription(subscription);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscription(event.data.object);
        break;
      }

      // Recorded for completeness per the task's explicit requirement —
      // subscription.updated already carries the resulting status change
      // (e.g. past_due/unpaid on failure, active on recovery), so these
      // two don't need their own DB write, just acknowledgment.
      case "invoice.payment_succeeded":
      case "invoice.payment_failed":
        break;

      default:
        break;
    }
  } catch (err) {
    // A DB hiccup here must not make Stripe think the event needs
    // redelivery forever without visibility — log loudly, but still 200 so
    // Stripe doesn't retry-storm; the next subscription.updated event (or
    // a manual reconciliation) will catch up the state.
    console.error(`Stripe webhook handler failed for ${event.type}`, err);
  }

  return NextResponse.json({ received: true });
}
