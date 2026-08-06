import { DEFAULT_ALERT_RULES, ALERT_HISTORY } from "@/lib/demo/alerts";
import { AlertsClient } from "./AlertsClient";

export const metadata = { title: "Alerts — Market Intelligence AI" };

export default function AlertsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Alerts</h1>
        <p className="text-sm text-(--text-faint) mt-1">
          Trigger on score thresholds, bias changes, positioning shifts, divergence signals, high-impact releases, and more. Duplicate and excessive alerts are automatically suppressed.
        </p>
      </div>
      <AlertsClient initialRules={DEFAULT_ALERT_RULES} history={ALERT_HISTORY} />
    </div>
  );
}
