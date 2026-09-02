"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Egress guard (Supabase free-tier egress incident): switching back to a
// browser tab fires BOTH the window "focus" event and a "visibilitychange"
// to "visible" almost simultaneously — without a guard, that's two full
// router.refresh() calls (i.e. two full re-runs of the page's server-side
// data fetch) for one "user came back to this tab" moment. Any refresh from
// any trigger resets this cooldown, so the interval timer itself is also
// covered — a refresh that just happened never fires again this soon
// regardless of which of the three triggers caused it.
const MIN_REFRESH_GAP_MS = 5000;

/** Keeps a force-dynamic server page's data current for a user who leaves
 * the tab open, without a live client-side subscription — router.refresh()
 * just re-runs the page's server-side data fetch (the same reads the page
 * already does on a fresh load) and re-renders with whatever's current, no
 * full page reload. Fires on an interval and whenever the tab regains
 * focus/visibility, so a stale background tab catches up the moment the
 * user comes back to it rather than waiting out the interval. */
export function AutoRefresh({ intervalSeconds = 45 }: { intervalSeconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    let lastRefresh = 0;
    function refresh() {
      const now = Date.now();
      if (now - lastRefresh < MIN_REFRESH_GAP_MS) return;
      lastRefresh = now;
      router.refresh();
    }

    const interval = setInterval(refresh, intervalSeconds * 1000);
    function onFocus() {
      refresh();
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") refresh();
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
