import { requireEntitlement } from "@/lib/auth/dal";
import { Card } from "@/components/ui/Card";
import { Bell } from "lucide-react";

export const metadata = { title: "Smart Alerts — Market Intelligence AI" };

// Pre-launch value pass: this route previously rendered AlertsClient, a
// fully hardcoded/in-memory placeholder (no DB table, no evaluation engine,
// no persistence — creating or toggling a rule only mutated React state
// that reset on reload). A paying customer had no way to tell that from a
// real, working alert. Until a real alert engine exists (persistence,
// evaluation hooked into the existing score/ingestion write paths, trigger
// history — first-30-days work, not this pass), this route is an honest
// "Coming Soon" state with no controls that could be mistaken for live
// ones. Removed from the sidebar entirely (see Sidebar.tsx) — this page
// exists only for a direct link/bookmark.
export default async function AlertsPage() {
  await requireEntitlement();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Smart Alerts</h1>
      </div>
      <Card>
        <div className="flex flex-col items-center text-center gap-3 py-10">
          <div className="grid place-items-center w-12 h-12 rounded-full bg-(--accent-soft) text-(--accent)">
            <Bell size={22} />
          </div>
          <h2 className="text-base font-semibold">Smart Alerts — Coming Soon</h2>
          <p className="text-sm text-(--text-faint) max-w-md">
            Get notified when scores change materially, new setups emerge, or important events affect your markets.
          </p>
        </div>
      </Card>
    </div>
  );
}
