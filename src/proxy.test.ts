import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function req(path: string): NextRequest {
  return new NextRequest(`https://example.com${path}`);
}

describe("proxy (auth middleware)", () => {
  it("lets a session-cookie-free request through for the cron routes (existing behavior)", () => {
    const res = proxy(req("/api/cron/economic-releases"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets a session-cookie-free request through for the high-frequency watch route — this is a real regression test: this route was initially missing from PUBLIC_PREFIXES, causing GitHub Actions' bearer-token requests to be redirected to /signin instead of ever reaching the route handler", () => {
    const res = proxy(req("/api/watch/economic-releases"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("still redirects an unrelated, session-protected path to /signin when no session cookie is present", () => {
    const res = proxy(req("/dashboard"));
    expect(res.headers.get("location")).toContain("/signin");
  });
});
