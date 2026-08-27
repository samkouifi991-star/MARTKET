"use client";

// Generic compact tab strip — reused across the new Economic Strength /
// Forex Scorecard / Geopolitical Risk / Admin Manual Data Entry pages
// (requirement: "tabs" as part of the premium-density visual direction).
// Visual convention lifted from NewsClient's/CalendarClient's existing
// one-off filter-button rows so every tab strip in the product looks the
// same, rather than each page inventing its own.
export type SectionTab = { key: string; label: string };

export function SectionTabs({ tabs, active, onChange }: { tabs: SectionTab[]; active: string; onChange: (key: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-(--border) p-1 w-fit">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`h-8 px-3 rounded-md text-xs transition-colors ${active === t.key ? "bg-(--accent-soft) text-(--accent)" : "text-(--text-faint) hover:text-(--text-dim)"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
