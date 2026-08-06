"use client";

import { useState } from "react";

const CHANNELS = ["In-app notifications", "Email digests", "SMS (coming soon)", "Push (coming soon)", "Webhooks (coming soon)"];

export function NotificationPrefs() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    "In-app notifications": true,
    "Email digests": true,
    "SMS (coming soon)": false,
    "Push (coming soon)": false,
    "Webhooks (coming soon)": false,
  });

  return (
    <div className="space-y-2.5">
      {CHANNELS.map((c) => {
        const disabled = c.includes("coming soon");
        return (
          <div key={c} className="flex items-center justify-between py-1.5 border-b border-(--border) last:border-0">
            <span className={`text-sm ${disabled ? "text-(--text-faint)" : ""}`}>{c}</span>
            <button
              disabled={disabled}
              onClick={() => setEnabled((prev) => ({ ...prev, [c]: !prev[c] }))}
              className={`h-6 w-10 rounded-full relative transition-colors disabled:opacity-40 ${enabled[c] ? "bg-(--accent)" : "bg-(--border-strong)"}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enabled[c] ? "translate-x-4" : "translate-x-0.5"}`} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
