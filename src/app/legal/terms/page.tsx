import { LegalLayout } from "@/components/marketing/LegalLayout";
import { verifySession } from "@/lib/auth/dal";

export const metadata = { title: "Terms of Service — Market Intelligence AI" };

export default async function TermsPage() {
  const sessionUser = await verifySession();
  return (
    <LegalLayout title="Terms of Service" updated="2026" user={sessionUser ? { email: sessionUser.email } : null}>
      <p>
        These Terms govern your use of Market Intelligence AI (&quot;the Service&quot;). By creating an account or starting a trial, you
        agree to these Terms.
      </p>

      <h2>The Service</h2>
      <p>
        Market Intelligence AI provides transparent, factor-based market intelligence — technical trend, institutional positioning,
        retail sentiment, macro conditions, seasonality, and risk signals combined into a single explainable score per market.
      </p>

      <h2>Not investment advice</h2>
      <p>
        The Service is provided for informational and educational purposes only. Nothing in the Service constitutes investment,
        financial, legal, or tax advice, or a recommendation to buy, sell, or hold any instrument. Scores represent analytical
        estimates, not certainties, and past performance does not guarantee future results. You are solely responsible for your own
        trading and investment decisions.
      </p>

      <h2>Accounts</h2>
      <p>
        You must provide accurate information when creating an account and are responsible for keeping your login credentials
        confidential. You are responsible for all activity under your account.
      </p>

      <h2>Subscription and billing</h2>
      <p>
        The Service is offered on a single paid plan, billed monthly through Stripe, with a 3-day free trial for new subscriptions.
        See the <a className="text-(--accent) hover:underline" href="/legal/subscription-policy">Subscription &amp; Cancellation Policy</a> for
        full billing terms.
      </p>

      <h2>Acceptable use</h2>
      <p>
        You agree not to misuse the Service — including attempting to circumvent access controls, scraping data at a scale that
        degrades the Service for others, or reselling access without authorization.
      </p>

      <h2>Disclaimer and limitation of liability</h2>
      <p>
        The Service is provided &quot;as is&quot; without warranties of any kind. Market data may be delayed, estimated, or
        inaccurate. To the maximum extent permitted by law, Market Intelligence AI is not liable for any trading losses or other
        damages arising from use of the Service.
      </p>

      <h2>Changes</h2>
      <p>We may update these Terms from time to time. Continued use of the Service after a change constitutes acceptance of the revised Terms.</p>
    </LegalLayout>
  );
}
