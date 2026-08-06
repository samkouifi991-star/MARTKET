"use client";

import { Moon, Sun } from "lucide-react";

// Reads/writes the DOM attribute directly instead of mirroring it into React
// state — the inline script in layout.tsx already sets data-theme before
// paint, and CSS (see .theme-icon-* in globals.css) shows the right icon for
// that attribute with zero risk of a hydration mismatch.
function toggleTheme() {
  const root = document.documentElement;
  const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
  root.setAttribute("data-theme", next);
  localStorage.setItem("mi-theme", next);
}

export function ThemeToggle() {
  return (
    <button
      onClick={toggleTheme}
      aria-label="Toggle theme"
      className="grid place-items-center w-9 h-9 rounded-lg border border-(--border) text-(--text-dim) hover:text-(--text) hover:border-(--border-strong) transition-colors"
    >
      <span className="theme-icon-sun">
        <Sun size={16} />
      </span>
      <span className="theme-icon-moon">
        <Moon size={16} />
      </span>
    </button>
  );
}
