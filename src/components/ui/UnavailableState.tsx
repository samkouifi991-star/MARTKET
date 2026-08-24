import { Info } from "lucide-react";

// Shared compact replacement for ad hoc "Data temporarily unavailable..."
// paragraphs — a small icon-plus-line treatment instead of dead paragraph
// space. Content should lead with one of this project's standard freshness
// words (LIVE/DELAYED/STALE/NOT APPLICABLE/UNAVAILABLE — see
// DataFreshnessTag) so the vocabulary stays consistent between the
// freshness badges and this fallback copy wherever a section has nothing
// real to show.
export function UnavailableState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-(--border) bg-white/[.02] px-2.5 py-2 text-xs text-(--text-faint) leading-snug">
      <Info size={13} className="shrink-0 mt-0.5 opacity-70" />
      <span>{children}</span>
    </div>
  );
}
