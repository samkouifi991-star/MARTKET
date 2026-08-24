// Phase 14 security audit: this route triggers real live provider calls
// (FMP/CFTC/FRED/Myfxbook) and previously had no admin check at all —
// proxy.ts's optimistic gate only confirms SOME session cookie is
// present, not that the user is the admin. Proves the route's own
// DB-backed admin check actually blocks a non-admin, authenticated user.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/session");
vi.mock("@/lib/pipeline/gbpusd-validation");
vi.mock("@/services/market-data/request-cache");
vi.mock("@/services/data-mode", () => ({ isDemoOnly: () => false }));

import { getSessionUser } from "@/lib/auth/session";
import { getGbpusdValidation } from "@/lib/pipeline/gbpusd-validation";
import { cached } from "@/services/market-data/request-cache";
import { POST } from "./route";

const ADMIN = { id: 1, email: "samkouifi991@gmail.com", passwordHash: "x", name: null, createdAt: new Date() };
const REGULAR_CUSTOMER = { id: 2, email: "customer@example.com", passwordHash: "x", name: null, createdAt: new Date() };

describe("POST /api/admin/gbpusd-validation/run", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ADMIN_EMAILS = "samkouifi991@gmail.com";
  });

  it("returns 401 and never calls the live-validation pipeline for an unauthenticated request", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(undefined);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(getGbpusdValidation).not.toHaveBeenCalled();
  });

  it("returns 401 and never calls the live-validation pipeline for a logged-in NON-admin customer — the exact gap this fix closes", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(REGULAR_CUSTOMER);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(getGbpusdValidation).not.toHaveBeenCalled();
  });

  it("allows the admin/owner account through to the real validation pipeline", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(ADMIN);
    vi.mocked(cached).mockImplementation(async (_key, _ttl, fn) => fn());
    vi.mocked(getGbpusdValidation).mockResolvedValue({} as never);
    const res = await POST();
    expect(res.status).toBe(200);
    expect(getGbpusdValidation).toHaveBeenCalled();
  });
});
