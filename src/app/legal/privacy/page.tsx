import { LegalLayout } from "@/components/marketing/LegalLayout";
import { verifySession } from "@/lib/auth/dal";

export const metadata = { title: "Privacy Policy — Market Intelligence AI" };

export default async function PrivacyPage() {
  const sessionUser = await verifySession();
  return (
    <LegalLayout title="Privacy Policy" updated="2026" user={sessionUser ? { email: sessionUser.email } : null}>
      <p>This Privacy Policy explains what information Market Intelligence AI collects and how it&apos;s used.</p>

      <h2>Information we collect</h2>
      <p>
        Account information you provide (name, email, password — stored as a salted hash, never in plain text). Billing information
        is collected and stored directly by Stripe, our payment processor — we never receive or store your full card number.
      </p>

      <h2>How we use it</h2>
      <p>
        To provide and maintain your account and subscription, to communicate with you about your account or billing, and to
        improve the Service. We do not sell your personal information.
      </p>

      <h2>Third-party processors</h2>
      <p>
        We use Stripe to process payments and manage subscriptions, and market-data providers (including OANDA, the CFTC, and FRED)
        to source the market data the scoring engine runs on. Each operates under its own privacy policy.
      </p>

      <h2>Data retention</h2>
      <p>
        We retain account information for as long as your account is active. If your subscription lapses, your account and saved
        preferences (watchlists, alert rules) are kept, not deleted, so you can pick up where you left off if you reactivate.
      </p>

      <h2>Your choices</h2>
      <p>
        You can update your account details from Settings at any time, and cancel your subscription without losing your account or
        preferences.
      </p>

      <h2>Contact</h2>
      <p>Questions about this policy can be directed to the account owner listed in your Stripe receipt emails.</p>
    </LegalLayout>
  );
}
