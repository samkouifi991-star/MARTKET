"use client";

import { useActionState, useState } from "react";
import { submitManualEconomicRelease, submitManualNewsEvent, type ManualEntryActionState } from "@/lib/actions/manual-data-entry";
import { Card } from "@/components/ui/Card";
import { SectionTabs } from "@/components/ui/SectionTabs";

// The 8 currencies this platform's economic-strength/scoring architecture
// tracks (CCY_TO_COUNTRY's exact key set, lib/scoring.ts) — kept as a small
// local literal here rather than importing lib/scoring.ts into the client
// bundle just for 8 currency codes.
const TRACKED_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD"] as const;

const inputClass = "h-9 w-full rounded-lg border border-(--border) bg-(--bg-card) px-2.5 text-sm outline-none focus:border-(--border-strong)";
const labelClass = "text-xs text-(--text-faint) mb-1 block";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

function EconomicReleaseForm({ initialCurrency, initialEvent }: { initialCurrency?: string; initialEvent?: string }) {
  const [state, formAction, pending] = useActionState<ManualEntryActionState, FormData>(submitManualEconomicRelease, undefined);

  return (
    <form action={formAction}>
      <Card
        title="Economic Release"
        subtitle="Runs the exact same validate → normalize → save → calculate surprise → determine affected markets → recompute pipeline as the Zapier webhook — you never calculate the surprise yourself."
        action={
          <button type="submit" disabled={pending} className="text-sm rounded-lg bg-(--accent) text-white px-4 py-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
            {pending ? "Saving…" : "Save & Process"}
          </button>
        }
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Currency">
            <select name="currency" required defaultValue={initialCurrency && (TRACKED_CURRENCIES as readonly string[]).includes(initialCurrency) ? initialCurrency : "USD"} className={inputClass}>
              {TRACKED_CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Impact">
            <select name="impact" defaultValue="" className={inputClass}>
              <option value="">Unclassified</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Event name (must match this platform's known indicator names to be surprise-scored, e.g. “CPI m/m”)">
              <input name="event" required defaultValue={initialEvent ?? ""} placeholder="e.g. CPI m/m" className={inputClass} />
            </Field>
          </div>
          <Field label="Release date">
            <input type="date" name="releaseDate" required className={inputClass} />
          </Field>
          <Field label="Release time (UTC)">
            <input type="time" name="releaseTime" defaultValue="00:00" className={inputClass} />
          </Field>
          <Field label="Actual">
            <input name="actual" placeholder="e.g. 0.4%" className={inputClass} />
          </Field>
          <Field label="Forecast">
            <input name="forecast" placeholder="e.g. 0.2%" className={inputClass} />
          </Field>
          <Field label="Previous">
            <input name="previous" placeholder="e.g. 0.1%" className={inputClass} />
          </Field>
          <Field label="Revised Previous">
            <input name="revisedPrevious" placeholder="optional" className={inputClass} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes (optional, not used in scoring — kept for traceability)">
              <textarea name="notes" rows={2} className={`${inputClass} h-auto py-2`} />
            </Field>
          </div>
        </div>
        {state?.error && <p className="text-xs text-rose-400 mt-3">{state.error}</p>}
        {state?.success && <p className="text-xs text-emerald-400 mt-3">{state.success}</p>}
      </Card>
    </form>
  );
}

function NewsEntryForm() {
  const [state, formAction, pending] = useActionState<ManualEntryActionState, FormData>(submitManualNewsEvent, undefined);

  return (
    <form action={formAction}>
      <Card
        title="News / Geopolitical Event"
        subtitle="Classified by the same AI classifier as the Zapier pipeline — it classifies the text you supply here, it never invents an article that wasn't given to it."
        action={
          <button type="submit" disabled={pending} className="text-sm rounded-lg bg-(--accent) text-white px-4 py-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
            {pending ? "Saving…" : "Save & Process"}
          </button>
        }
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Field label="Headline">
              <input name="headline" required placeholder="e.g. Fed signals rates may remain higher for longer" className={inputClass} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Summary (optional — the actual text the classifier reads)">
              <textarea name="summary" rows={3} className={`${inputClass} h-auto py-2`} />
            </Field>
          </div>
          <Field label="Source">
            <input name="source" required placeholder="e.g. Forex Factory email" className={inputClass} />
          </Field>
          <Field label="Related currency (optional)">
            <select name="currency" defaultValue="" className={inputClass}>
              <option value="">None / multiple</option>
              {TRACKED_CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Published date">
            <input type="date" name="publishedDate" required className={inputClass} />
          </Field>
          <Field label="Published time (UTC)">
            <input type="time" name="publishedTime" defaultValue="00:00" className={inputClass} />
          </Field>
          <Field label="Impact (optional)">
            <select name="impact" defaultValue="" className={inputClass}>
              <option value="">Let the classifier decide</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </Field>
          <Field label="Source URL (optional)">
            <input name="sourceUrl" placeholder="https://…" className={inputClass} />
          </Field>
        </div>
        {state?.error && <p className="text-xs text-rose-400 mt-3">{state.error}</p>}
        {state?.success && <p className="text-xs text-emerald-400 mt-3">{state.success}</p>}
      </Card>
    </form>
  );
}

export function DataEntryClient({ initialCurrency, initialEvent }: { initialCurrency?: string; initialEvent?: string } = {}) {
  const [tab, setTab] = useState<"economic" | "news">("economic");

  return (
    <div className="space-y-4">
      <SectionTabs
        tabs={[
          { key: "economic", label: "Economic Release" },
          { key: "news", label: "News / Geopolitical Event" },
        ]}
        active={tab}
        onChange={(key) => setTab(key as "economic" | "news")}
      />
      {tab === "economic" ? <EconomicReleaseForm initialCurrency={initialCurrency} initialEvent={initialEvent} /> : <NewsEntryForm />}
    </div>
  );
}
