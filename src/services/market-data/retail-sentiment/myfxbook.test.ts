import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, statusText: ok ? "OK" : "Error", json: async () => body } as Response;
}

describe("myfxbook session retry", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MYFXBOOK_EMAIL = "test@example.com";
    process.env.MYFXBOOK_PASSWORD = "secret";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("re-authenticates once and retries when the outlook call reports an invalid session", async () => {
    const fetchMock = vi.fn();
    let loginCalls = 0;
    fetchMock.mockImplementation(async (urlStr: string) => {
      const url = new URL(urlStr);
      if (url.pathname.endsWith("/login.json")) {
        loginCalls += 1;
        return jsonResponse({ error: false, session: `session-${loginCalls}` });
      }
      if (url.pathname.endsWith("/get-community-outlook.json")) {
        const session = url.searchParams.get("session");
        if (session === "session-1") {
          return jsonResponse({ error: true, message: "Invalid session" });
        }
        return jsonResponse({ error: false, symbols: [{ name: "GBPUSD", longPercentage: 60, shortPercentage: 40 }] });
      }
      throw new Error(`unexpected URL ${urlStr}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { myfxbookProvider } = await import("./myfxbook");
    const result = await myfxbookProvider.getRetailSentiment("GBPUSD");

    expect(loginCalls).toBe(2); // first login + forced re-login after invalid session
    expect(result.status).toBe("live");
    expect(result.value?.pctLong).toBe(60);
  });

  it("surfaces a genuine rejection (not session-related) as an error instead of retrying forever", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockImplementation(async (urlStr: string) => {
      const url = new URL(urlStr);
      if (url.pathname.endsWith("/login.json")) {
        return jsonResponse({ error: false, session: "session-1" });
      }
      if (url.pathname.endsWith("/get-community-outlook.json")) {
        return jsonResponse({ error: true, message: "Internal server error" });
      }
      throw new Error(`unexpected URL ${urlStr}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { myfxbookProvider } = await import("./myfxbook");
    const result = await myfxbookProvider.getRetailSentiment("GBPUSD");

    expect(result.status).toBe("error");
    expect(result.error).toContain("Internal server error");
  });

  it("never reuses a session across separate calls — each getRetailSentiment call logs in fresh", async () => {
    const fetchMock = vi.fn();
    let loginCalls = 0;
    fetchMock.mockImplementation(async (urlStr: string) => {
      const url = new URL(urlStr);
      if (url.pathname.endsWith("/login.json")) {
        loginCalls += 1;
        return jsonResponse({ error: false, session: `session-${loginCalls}` });
      }
      if (url.pathname.endsWith("/get-community-outlook.json")) {
        return jsonResponse({ error: false, symbols: [{ name: "GBPUSD", longPercentage: 55, shortPercentage: 45 }] });
      }
      throw new Error(`unexpected URL ${urlStr}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { myfxbookProvider } = await import("./myfxbook");
    await myfxbookProvider.getRetailSentiment("GBPUSD");
    await myfxbookProvider.getRetailSentiment("GBPUSD");

    expect(loginCalls).toBe(2); // one fresh login per call, no cross-call cache
  });

  describe("diagnoseMyfxbookConnection", () => {
    it("reports each stage succeeding and the symbol found", async () => {
      const fetchMock = vi.fn();
      fetchMock.mockImplementation(async (urlStr: string) => {
        const url = new URL(urlStr);
        if (url.pathname.endsWith("/login.json")) return jsonResponse({ error: false, session: "session-1" });
        if (url.pathname.endsWith("/get-community-outlook.json")) {
          return jsonResponse({ error: false, symbols: [{ name: "GBPUSD", longPercentage: 62, shortPercentage: 38 }] });
        }
        throw new Error(`unexpected URL ${urlStr}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { diagnoseMyfxbookConnection } = await import("./myfxbook");
      const diag = await diagnoseMyfxbookConnection("GBPUSD");

      expect(diag).toEqual({ loginSuccessful: true, sessionReceived: true, communityOutlookSuccessful: true, symbolFound: true });
    });

    it("pinpoints a login failure without touching the outlook endpoint", async () => {
      const fetchMock = vi.fn();
      fetchMock.mockImplementation(async (urlStr: string) => {
        const url = new URL(urlStr);
        if (url.pathname.endsWith("/login.json")) return jsonResponse({ error: true, message: "invalid credentials" });
        throw new Error(`unexpected URL ${urlStr}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { diagnoseMyfxbookConnection } = await import("./myfxbook");
      const diag = await diagnoseMyfxbookConnection("GBPUSD");

      expect(diag.loginSuccessful).toBe(false);
      expect(diag.sessionReceived).toBe(false);
      expect(diag.communityOutlookSuccessful).toBe(false);
      expect(diag.symbolFound).toBe(false);
      expect(diag.error).not.toMatch(/secret|password/i); // never leaks the credential
    });

    it("pinpoints a symbol-not-found case distinctly from an outlook failure", async () => {
      const fetchMock = vi.fn();
      fetchMock.mockImplementation(async (urlStr: string) => {
        const url = new URL(urlStr);
        if (url.pathname.endsWith("/login.json")) return jsonResponse({ error: false, session: "session-1" });
        if (url.pathname.endsWith("/get-community-outlook.json")) {
          return jsonResponse({ error: false, symbols: [{ name: "EURUSD", longPercentage: 50, shortPercentage: 50 }] });
        }
        throw new Error(`unexpected URL ${urlStr}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { diagnoseMyfxbookConnection } = await import("./myfxbook");
      const diag = await diagnoseMyfxbookConnection("GBPUSD");

      expect(diag.communityOutlookSuccessful).toBe(true);
      expect(diag.symbolFound).toBe(false);
    });
  });
});
