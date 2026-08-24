import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, opts: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}): Response {
  const { ok = true, status = 200, headers = {} } = opts;
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    text: async () => JSON.stringify(body),
    json: async () => body,
    headers: { get: (name: string) => headers[name] ?? null },
  } as unknown as Response;
}

const SESSION_HEADERS = { CST: "cst-token", "X-SECURITY-TOKEN": "security-token" };

describe("capital-com client sentiment", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CAPITAL_COM_API_KEY = "test-api-key";
    process.env.CAPITAL_COM_IDENTIFIER = "test-identifier";
    process.env.CAPITAL_COM_PASSWORD = "test-password";
    delete process.env.CAPITAL_COM_ENVIRONMENT;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("returns unavailable, without ever calling fetch, when no confirmed marketId exists for the symbol (every symbol-map entry today)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { getRetailSentiment } = await import("./capital-com");

    const result = await getRetailSentiment("XAUUSD");

    expect(result.status).toBe("unavailable");
    expect(result.value).toBeNull();
    expect(result.error).toMatch(/No confirmed Capital\.com marketId/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns unavailable, without ever calling fetch, when credentials are not configured (even if a marketId existed)", async () => {
    delete process.env.CAPITAL_COM_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { getRetailSentiment } = await import("./capital-com");

    const result = await getRetailSentiment("XAUUSD");

    expect(result.status).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hits the demo host by default and the live host when CAPITAL_COM_ENVIRONMENT=live", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/session")) return Promise.resolve(jsonResponse({}, { headers: SESSION_HEADERS }));
      return Promise.resolve(jsonResponse({ marketId: "GOLD", longPositionPercentage: 60, shortPositionPercentage: 40 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchClientSentiment } = await import("./capital-com");
    await fetchClientSentiment("GOLD");
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("https://demo-api-capital.backend-capital.com/"))).toBe(true);

    vi.resetModules();
    process.env.CAPITAL_COM_API_KEY = "test-api-key";
    process.env.CAPITAL_COM_IDENTIFIER = "test-identifier";
    process.env.CAPITAL_COM_PASSWORD = "test-password";
    process.env.CAPITAL_COM_ENVIRONMENT = "live";
    const fetchMock2 = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/session")) return Promise.resolve(jsonResponse({}, { headers: SESSION_HEADERS }));
      return Promise.resolve(jsonResponse({ marketId: "GOLD", longPositionPercentage: 60, shortPositionPercentage: 40 }));
    });
    vi.stubGlobal("fetch", fetchMock2);
    const { fetchClientSentiment: fetchLive } = await import("./capital-com");
    await fetchLive("GOLD");
    expect(fetchMock2.mock.calls.some(([url]) => String(url).startsWith("https://api-capital.backend-capital.com/"))).toBe(true);
  });

  it("logs in once via POST /api/v1/session, then calls /api/v1/clientsentiment/{marketId} with the CST/X-SECURITY-TOKEN headers", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/api/v1/session")) {
        expect(init?.method).toBe("POST");
        expect((init?.headers as Record<string, string>)["X-CAP-API-KEY"]).toBe("test-api-key");
        return Promise.resolve(jsonResponse({}, { headers: SESSION_HEADERS }));
      }
      expect(url).toContain("/api/v1/clientsentiment/GOLD");
      expect((init?.headers as Record<string, string>).CST).toBe("cst-token");
      expect((init?.headers as Record<string, string>)["X-SECURITY-TOKEN"]).toBe("security-token");
      return Promise.resolve(jsonResponse({ marketId: "GOLD", longPositionPercentage: 65, shortPositionPercentage: 35 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchClientSentiment } = await import("./capital-com");

    const result = await fetchClientSentiment("GOLD");

    expect(result.ok).toBe(true);
    expect(result.raw).toMatchObject({ marketId: "GOLD", longPositionPercentage: 65, shortPositionPercentage: 35 });
  });

  it("throws when the login response is missing CST/X-SECURITY-TOKEN headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, {}));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchClientSentiment } = await import("./capital-com");

    await expect(fetchClientSentiment("GOLD")).rejects.toThrow(/missing CST\/X-SECURITY-TOKEN/);
  });

  it("returns error (never throws, never fabricates) on a non-2xx clientsentiment response, and never logs the password", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/session")) return Promise.resolve(jsonResponse({}, { headers: SESSION_HEADERS }));
      return Promise.resolve(jsonResponse({ errorCode: "error.not-found" }, { ok: false, status: 404 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchClientSentiment } = await import("./capital-com");

    const result = await fetchClientSentiment("GOLD");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(JSON.stringify(result.raw)).not.toMatch(/test-password/);
  });

  it("searchMarkets extracts marketId/instrumentName candidates from a markets[] response", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/session")) return Promise.resolve(jsonResponse({}, { headers: SESSION_HEADERS }));
      return Promise.resolve(
        jsonResponse({
          markets: [{ epic: "GOLD", instrumentName: "Gold" }, { epic: "SILVER", instrumentName: "Silver" }],
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const { searchMarkets } = await import("./capital-com");

    const result = await searchMarkets("Gold");

    expect(result.ok).toBe(true);
    expect(result.markets).toHaveLength(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("searchTerm=Gold"))).toBe(true);
  });
});
