"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Keeps a force-dynamic server page's data current for a user who leaves
 * the tab open, without a live client-side subscription — router.refresh()
 * just re-runs the page's server-side data fetch (the same Neon reads the
 * page already does on a fresh load) and re-renders with whatever's current,
 * no full page reload. Fires on an interval and whenever the tab regains
 * focus/visibility, so a stale background tab catches up the moment the
 * user comes back to it rather than waiting out the interval. */
export function AutoRefresh({ intervalSeconds = 45 }: { intervalSeconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), intervalSeconds * 1000);

    function onFocus() {
      router.refresh();
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") router.refresh();
    }

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router, intervalSeconds]);

  return null;
}
