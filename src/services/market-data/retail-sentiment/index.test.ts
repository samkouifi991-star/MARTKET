import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Provenance } from "../../types";
import type { NormalizedRetailSentiment } from "./types";

vi.mock("./oanda", () => ({ oandaProvider: { name: "oanda", sourceLabel: "OANDA PositionBook", getRetailSentiment: vi.fn() } }));
vi.mock("./myfxbook", () => ({ myfxbookProvider: { name: "myfxbook", sourceLabel: "Myfxbook Community Outlook", getRetailSentiment: vi.fn() } }));
vi.mock("./ig-provider", () => ({ igProvider: { name: "ig", sourceLabel: "IG Client Sentiment", getRetailSentiment: vi.fn() } }));

import { oandaProvider } from "./oanda";
import { myfxbookProvider } from "./myfxbook";
import { igProvider } from "./ig-provider";
import { getRetailSentiment } from "./index";

type ProviderId = "oanda" | "myfxbook" | "ig";

const SOURCE_LABEL: Record<ProviderId, string> = {
  oanda: "OANDA PositionBook",
  myfxbook: "Myfxbook Community Outlook",
  ig: "IG Client Sentiment",
};

const live = (provider: ProviderId): Provenance<NormalizedRetailSentiment> => ({
  provider,
  source: SOURCE_LABEL[provider],
  status: "live",
  fetchedAt: new Date().toISOString(),
  sourceUpdatedAt: new Date().toISOString(),
  nextExpectedUpdate: null,
  value: { symbol: "GBPUSD", pctLong: 60, pctShort: 40 },
});

const unavailable = (provider: ProviderId, reason: string): Provenance<NormalizedRetailSentiment> => ({
  provider,
  source: SOURCE_LABEL[provider],
  status: "unavailable",
  fetchedAt: new Date().toISOString(),
  sourceUpdatedAt: null,
  nextExpectedUpdate: null,
  value: null,
  error: reason,
});

const errored = (provider: ProviderId, reason: string): Provenance<NormalizedRetailSentiment> => ({
  provider,
  source: SOURCE_LABEL[provider],
  status: "error",
  fetchedAt: new Date().toISOString(),
  sourceUpdatedAt: null,
  nextExpectedUpdate: null,
  value: null,
  error: reason,
});

describe("retail-sentiment combinator — OANDA primary, IG secondary, Myfxbook fallback-only", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prefers OANDA when it is live, without calling IG's or Myfxbook's result", async () => {
    vi.mocked(oandaProvider.getRetailSentiment).mockResolvedValue(live("oanda"));
    vi.mocked(igProvider.getRetailSentiment).mockResolvedValue(live("ig"));
    vi.mocked(myfxbookProvider.getRetailSentiment).mockResolvedValue(live("myfxbook"));

    const result = await getRetailSentiment("GBPUSD");
    expect(result.provider).toBe("oanda");
  });

  it("falls back to IG when OANDA does not cover the market", async () => {
    vi.mocked(oandaProvider.getRetailSentiment).mockResolvedValue(unavailable("oanda", "OANDA PositionBook does not cover XYZ"));
    vi.mocked(igProvider.getRetailSentiment).mockResolvedValue(live("ig"));
    vi.mocked(myfxbookProvider.getRetailSentiment).mockResolvedValue(live("myfxbook"));

    const result = await getRetailSentiment("XYZ");
    expect(result.provider).toBe("ig");
    expect(result.status).toBe("live");
  });

  it("falls back to Myfxbook, last, when neither OANDA nor IG cover the market", async () => {
    vi.mocked(oandaProvider.getRetailSentiment).mockResolvedValue(unavailable("oanda", "OANDA PositionBook does not cover XYZ"));
    vi.mocked(igProvider.getRetailSentiment).mockResolvedValue(unavailable("ig", "No confirmed IG epic for XYZ"));
    vi.mocked(myfxbookProvider.getRetailSentiment).mockResolvedValue(live("myfxbook"));

    const result = await getRetailSentiment("XYZ");
    expect(result.provider).toBe("myfxbook");
    expect(result.status).toBe("live");
  });

  it("returns OANDA's unavailable reason when no provider covers the market", async () => {
    vi.mocked(oandaProvider.getRetailSentiment).mockResolvedValue(unavailable("oanda", "OANDA PositionBook does not cover XYZ"));
    vi.mocked(igProvider.getRetailSentiment).mockResolvedValue(unavailable("ig", "No confirmed IG epic for XYZ"));
    vi.mocked(myfxbookProvider.getRetailSentiment).mockResolvedValue(unavailable("myfxbook", "Myfxbook does not cover XYZ"));

    const result = await getRetailSentiment("XYZ");
    expect(result.status).toBe("unavailable");
    expect(result.provider).toBe("oanda");
  });

  it("never fabricates a value — a failed request surfaces as error, not a silently substituted number", async () => {
    vi.mocked(oandaProvider.getRetailSentiment).mockResolvedValue(errored("oanda", "OANDA PositionBook request failed: 500"));
    vi.mocked(igProvider.getRetailSentiment).mockResolvedValue(unavailable("ig", "No confirmed IG epic for GBPUSD"));
    vi.mocked(myfxbookProvider.getRetailSentiment).mockResolvedValue(unavailable("myfxbook", "Myfxbook does not cover GBPUSD"));

    const result = await getRetailSentiment("GBPUSD");
    expect(result.value).toBeNull();
    expect(result.status).toBe("error");
  });

  it("Myfxbook's credentials being broken never blocks the pipeline — OANDA succeeding is enough", async () => {
    vi.mocked(oandaProvider.getRetailSentiment).mockResolvedValue(live("oanda"));
    vi.mocked(igProvider.getRetailSentiment).mockResolvedValue(unavailable("ig", "No confirmed IG epic for GBPUSD"));
    vi.mocked(myfxbookProvider.getRetailSentiment).mockResolvedValue(errored("myfxbook", "Myfxbook's API rejected the configured login"));

    const result = await getRetailSentiment("GBPUSD");
    expect(result.provider).toBe("oanda");
    expect(result.status).toBe("live");
    expect(myfxbookProvider.getRetailSentiment).not.toHaveBeenCalled();
  });
});
