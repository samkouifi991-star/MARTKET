import { describe, expect, it, vi } from "vitest";
import type { Provenance } from "../../types";
import type { NormalizedRetailSentiment } from "./types";

vi.mock("./myfxbook", () => ({ myfxbookProvider: { name: "myfxbook", sourceLabel: "Myfxbook Community Outlook", getRetailSentiment: vi.fn() } }));
vi.mock("./ig-provider", () => ({ igProvider: { name: "ig", sourceLabel: "IG Client Sentiment", getRetailSentiment: vi.fn() } }));

import { myfxbookProvider } from "./myfxbook";
import { igProvider } from "./ig-provider";
import { getRetailSentiment } from "./index";

const live = (provider: "myfxbook" | "ig"): Provenance<NormalizedRetailSentiment> => ({
  provider,
  source: provider === "myfxbook" ? "Myfxbook Community Outlook" : "IG Client Sentiment",
  status: "live",
  fetchedAt: new Date().toISOString(),
  sourceUpdatedAt: new Date().toISOString(),
  nextExpectedUpdate: null,
  value: { symbol: "GBPUSD", pctLong: 60, pctShort: 40 },
});

const unavailable = (provider: "myfxbook" | "ig", reason: string): Provenance<NormalizedRetailSentiment> => ({
  provider,
  source: provider === "myfxbook" ? "Myfxbook Community Outlook" : "IG Client Sentiment",
  status: "unavailable",
  fetchedAt: new Date().toISOString(),
  sourceUpdatedAt: null,
  nextExpectedUpdate: null,
  value: null,
  error: reason,
});

const errored = (provider: "myfxbook" | "ig", reason: string): Provenance<NormalizedRetailSentiment> => ({
  provider,
  source: provider === "myfxbook" ? "Myfxbook Community Outlook" : "IG Client Sentiment",
  status: "error",
  fetchedAt: new Date().toISOString(),
  sourceUpdatedAt: null,
  nextExpectedUpdate: null,
  value: null,
  error: reason,
});

describe("retail-sentiment combinator", () => {
  it("prefers Myfxbook when it is live, without calling IG's result", async () => {
    vi.mocked(myfxbookProvider.getRetailSentiment).mockResolvedValue(live("myfxbook"));
    vi.mocked(igProvider.getRetailSentiment).mockResolvedValue(live("ig"));

    const result = await getRetailSentiment("GBPUSD");
    expect(result.provider).toBe("myfxbook");
  });

  it("falls back to IG when Myfxbook does not cover the market", async () => {
    vi.mocked(myfxbookProvider.getRetailSentiment).mockResolvedValue(unavailable("myfxbook", "Myfxbook does not cover XYZ"));
    vi.mocked(igProvider.getRetailSentiment).mockResolvedValue(live("ig"));

    const result = await getRetailSentiment("XYZ");
    expect(result.provider).toBe("ig");
    expect(result.status).toBe("live");
  });

  it("returns Myfxbook's unavailable reason when neither provider covers the market", async () => {
    vi.mocked(myfxbookProvider.getRetailSentiment).mockResolvedValue(unavailable("myfxbook", "Myfxbook does not cover XYZ"));
    vi.mocked(igProvider.getRetailSentiment).mockResolvedValue(unavailable("ig", "No confirmed IG epic for XYZ"));

    const result = await getRetailSentiment("XYZ");
    expect(result.status).toBe("unavailable");
    expect(result.provider).toBe("myfxbook");
  });

  it("never fabricates a value — a failed request surfaces as error, not a silently substituted number", async () => {
    vi.mocked(myfxbookProvider.getRetailSentiment).mockResolvedValue(errored("myfxbook", "Myfxbook login failed: 500"));
    vi.mocked(igProvider.getRetailSentiment).mockResolvedValue(unavailable("ig", "No confirmed IG epic for GBPUSD"));

    const result = await getRetailSentiment("GBPUSD");
    expect(result.value).toBeNull();
    expect(result.status).toBe("error");
  });
});
