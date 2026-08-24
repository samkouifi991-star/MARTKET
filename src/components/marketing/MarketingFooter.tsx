import Link from "next/link";
import { DISCLAIMER } from "@/lib/config";

export function MarketingFooter() {
  return (
    <footer className="border-t border-(--border)">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-(--text-dim)">
          <Link href="/legal/terms" className="hover:text-(--text)">Terms</Link>
          <Link href="/legal/privacy" className="hover:text-(--text)">Privacy</Link>
          <Link href="/legal/subscription-policy" className="hover:text-(--text)">Subscription & Cancellation Policy</Link>
          <Link href="/pricing" className="hover:text-(--text)">Pricing</Link>
        </div>
        <p className="text-[11px] leading-relaxed text-(--text-faint) max-w-4xl">
          <strong className="text-(--text-dim)">Disclaimer:</strong> {DISCLAIMER}
        </p>
        <p className="text-[11px] text-(--text-faint)">© {new Date().getFullYear()} Market Intelligence AI. For informational and educational purposes only. Not investment advice.</p>
      </div>
    </footer>
  );
}
