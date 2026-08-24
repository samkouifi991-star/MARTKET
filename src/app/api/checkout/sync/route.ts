// Reconciles this app's subscription row synchronously right after Stripe
// Checkout completes — Stripe's success_url points here (see
// lib/billing.ts's createTrialCheckoutSession). The webhook
// (api/webhooks/stripe/route.ts) remains the authoritative, permanent
// source of truth for every subscription change from here on; this route
// only exists so the user doesn't land on /dashboard before that webhook
// (which can take a second or two) has arrived.
import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { syncSubscription } from "@/lib/billing";
import { requireSession } from "@/lib/auth/dal";

export async function GET(req: NextRequest) {
  const user = await requireSession(); // redirects to /signin if not logged in

  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) return NextResponse.redirect(new URL("/paywall?error=missing_session", req.url));

  try {
    const stripe = getStripe();
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });

    // Defense in depth: never apply another user's checkout session to
    // this session's account.
    if (checkoutSession.client_reference_id !== String(user.id)) {
      return NextResponse.redirect(new URL("/paywall?error=session_mismatch", req.url));
    }

    if (checkoutSession.subscription && typeof checkoutSession.subscription !== "string") {
      await syncSubscription(checkoutSession.subscription);
    }

    return NextResponse.redirect(new URL("/dashboard?welcome=1", req.url));
  } catch (err) {
    console.error("checkout/sync failed", err);
    // The webhook will still land shortly and reconcile the real state —
    // don't strand the user on an error page over this route's own sync
    // attempt failing.
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
}
