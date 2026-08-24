import { MarketingNav } from "./MarketingNav";
import { MarketingFooter } from "./MarketingFooter";

export function LegalLayout({ title, updated, user, children }: { title: string; updated: string; user: { email: string } | null; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col">
      <MarketingNav user={user} />
      <main className="flex-1 max-w-3xl mx-auto px-4 sm:px-6 py-12 w-full">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-xs text-(--text-faint) mt-1 mb-8">Last updated {updated}</p>
        <div className="space-y-5 text-sm text-(--text-dim) leading-relaxed [&_h2]:text-(--text) [&_h2]:font-semibold [&_h2]:text-base [&_h2]:mt-8 [&_h2]:mb-2">
          {children}
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
