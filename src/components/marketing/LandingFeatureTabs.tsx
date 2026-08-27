"use client";

// Tabbed "More ways to see the market" section for the landing page
// (Phase 13) — keeps 5 feature previews in one compact section instead of
// 5 separate full-length sections, per the "don't make the page
// excessively long" instruction. Each panel is pre-rendered server-side
// (real data or an honest unavailable state); this component only toggles
// which one is visible.
import { useState } from "react";
import { SectionTabs } from "@/components/ui/SectionTabs";

export type LandingTabPanel = { key: string; label: string; content: React.ReactNode };

export function LandingFeatureTabs({ panels }: { panels: LandingTabPanel[] }) {
  const [active, setActive] = useState(panels[0]?.key ?? "");

  return (
    <div>
      <div className="flex justify-center mb-5">
        <SectionTabs tabs={panels.map((p) => ({ key: p.key, label: p.label }))} active={active} onChange={setActive} />
      </div>
      {panels.map((p) => (
        <div key={p.key} className={p.key === active ? "block" : "hidden"}>
          {p.content}
        </div>
      ))}
    </div>
  );
}
