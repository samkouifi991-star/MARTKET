import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/dal");
vi.mock("@/lib/ingestion/economic-event");
vi.mock("@/lib/ingestion/news");
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requireAdmin } from "@/lib/auth/dal";
import { ingestEconomicEvent } from "@/lib/ingestion/economic-event";
import { ingestNews } from "@/lib/ingestion/news";
import { submitManualEconomicRelease, submitManualNewsEvent } from "./manual-data-entry";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("submitManualEconomicRelease", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ id: 1, email: "admin@example.com" } as never);
  });

  it("requires admin before doing anything else", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("not admin"));
    await expect(submitManualEconomicRelease(undefined, formData({ currency: "USD", event: "CPI m/m", releaseDate: "2027-01-15" }))).rejects.toThrow("not admin");
    expect(ingestEconomicEvent).not.toHaveBeenCalled();
  });

  it("rejects a submission with no release date", async () => {
    const result = await submitManualEconomicRelease(undefined, formData({ currency: "USD", event: "CPI m/m" }));
    expect(result).toEqual({ error: expect.stringContaining("Release date") });
    expect(ingestEconomicEvent).not.toHaveBeenCalled();
  });

  it("rejects a submission with no currency/event", async () => {
    const result = await submitManualEconomicRelease(undefined, formData({ releaseDate: "2027-01-15" }));
    expect(result).toEqual({ error: expect.stringContaining("Currency and Event") });
  });

  it("calls ingestEconomicEvent with channel manual/provider manual-admin and reports success", async () => {
    vi.mocked(ingestEconomicEvent).mockResolvedValue({ dryRun: false, economicEventId: 42, processingStatus: "classified", recomputedMarkets: ["EURUSD"] });
    const result = await submitManualEconomicRelease(
      undefined,
      formData({ currency: "USD", event: "CPI m/m", releaseDate: "2027-01-15", releaseTime: "13:30", actual: "0.4%", forecast: "0.2%", previous: "0.1%" })
    );
    expect(ingestEconomicEvent).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "USD", event: "CPI m/m", scheduledAt: "2027-01-15T13:30:00.000Z", actual: "0.4%" }),
      { channel: "manual", provider: "manual-admin", dryRun: false, rawPayload: expect.anything() }
    );
    expect(result).toEqual({ success: expect.stringContaining("surprise-scored") });
  });
});

describe("submitManualNewsEvent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ id: 1, email: "admin@example.com" } as never);
  });

  it("rejects a submission with no headline/source", async () => {
    const result = await submitManualNewsEvent(undefined, formData({ publishedDate: "2027-01-15" }));
    expect(result).toEqual({ error: expect.stringContaining("Headline and Source") });
    expect(ingestNews).not.toHaveBeenCalled();
  });

  it("calls ingestNews with channel manual and reports success", async () => {
    vi.mocked(ingestNews).mockResolvedValue({ dryRun: false, duplicate: false, newsArticleId: 7, recomputedMarkets: ["EURUSD"] });
    const result = await submitManualNewsEvent(
      undefined,
      formData({ headline: "Fed signals rates may remain higher for longer", source: "Forex Factory email", publishedDate: "2027-01-15", publishedTime: "13:30" })
    );
    expect(ingestNews).toHaveBeenCalledWith(
      expect.objectContaining({ headline: "Fed signals rates may remain higher for longer", publishedAt: "2027-01-15T13:30:00.000Z" }),
      { channel: "manual", dryRun: false, rawPayload: expect.anything() }
    );
    expect(result).toEqual({ success: expect.stringContaining("Recomputed: EURUSD") });
  });

  it("reports a friendly message on duplicate delivery", async () => {
    vi.mocked(ingestNews).mockResolvedValue({ dryRun: false, duplicate: true });
    const result = await submitManualNewsEvent(undefined, formData({ headline: "x", source: "y", publishedDate: "2027-01-15" }));
    expect(result).toEqual({ success: expect.stringContaining("deduped") });
  });
});
