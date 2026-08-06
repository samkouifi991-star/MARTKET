"use client";

import { useState } from "react";
import { Info } from "lucide-react";

export function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className="text-(--text-faint) hover:text-(--text-dim)"
        aria-label="More info"
      >
        <Info size={13} />
      </button>
      {open && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-56 rounded-lg border border-(--border-strong) bg-(--bg-elevated) px-2.5 py-2 text-[11px] leading-relaxed text-(--text-dim) shadow-xl z-50">
          {text}
        </span>
      )}
    </span>
  );
}
