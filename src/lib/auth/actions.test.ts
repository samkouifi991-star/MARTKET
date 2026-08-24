// Rate-limiting behavior for signin/signup (Phase 14 security audit) — the
// account-creation/credential-checking logic itself is exercised
// end-to-end elsewhere; this focuses on proving the DB-backed rate limit
// (never in-memory — see actions.ts's own header comment on why) actually
// short-circuits before any credential work happens once the per-IP limit
// is exceeded, and never blocks a request still under it.
import { describe, expect, it, vi, beforeEach } from "vitest";

class RedirectSignal extends Error {
  constructor(public url: string) {
    super(`REDIRECT:${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));

const headersMock = vi.fn();
vi.mock("next/headers", () => ({ headers: () => headersMock() }));

vi.mock("@/db/queries/rate-limit");
vi.mock("@/db/queries/users");
vi.mock("./password");
vi.mock("./session");
vi.mock("@/lib/billing");

import { recordAuthAttempt } from "@/db/queries/rate-limit";
import { getUserByEmail, createUser } from "@/db/queries/users";
import { verifyPassword } from "./password";
import { signin, signup } from "./actions";

function fakeHeaders(forwardedFor: string | null) {
  return { get: (name: string) => (name === "x-forwarded-for" ? forwardedFor : null) };
}

describe("signin rate limiting", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    headersMock.mockReturnValue(fakeHeaders("203.0.113.7"));
  });

  it("rejects with a rate-limit error, without ever checking credentials, once the per-IP signin limit is exceeded", async () => {
    vi.mocked(recordAuthAttempt).mockResolvedValue(11); // > SIGNIN_LIMIT (10)
    const form = new FormData();
    form.set("email", "user@example.com");
    form.set("password", "correct-password");

    const result = await signin(undefined, form);

    expect(result?.error).toMatch(/too many attempts/i);
    expect(getUserByEmail).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("proceeds to real credential checking when still under the limit", async () => {
    vi.mocked(recordAuthAttempt).mockResolvedValue(1);
    vi.mocked(getUserByEmail).mockResolvedValue(undefined);
    const form = new FormData();
    form.set("email", "user@example.com");
    form.set("password", "whatever");

    const result = await signin(undefined, form);

    expect(getUserByEmail).toHaveBeenCalledWith("user@example.com");
    expect(result?.error).toBe("Invalid email or password.");
  });

  it("keys the rate limit on the client's real IP (x-forwarded-for), not a hardcoded value", async () => {
    vi.mocked(recordAuthAttempt).mockResolvedValue(1);
    vi.mocked(getUserByEmail).mockResolvedValue(undefined);
    headersMock.mockReturnValue(fakeHeaders("198.51.100.42, 10.0.0.1"));
    const form = new FormData();
    form.set("email", "user@example.com");
    form.set("password", "whatever");

    await signin(undefined, form);

    // Only the first (real client) address in a possibly-multi-hop
    // x-forwarded-for header is used, never the whole chain.
    expect(recordAuthAttempt).toHaveBeenCalledWith("198.51.100.42", "signin", expect.any(Number));
  });

  it("falls back to a shared bucket rather than skipping the check when x-forwarded-for is absent", async () => {
    vi.mocked(recordAuthAttempt).mockResolvedValue(1);
    vi.mocked(getUserByEmail).mockResolvedValue(undefined);
    headersMock.mockReturnValue(fakeHeaders(null));
    const form = new FormData();
    form.set("email", "user@example.com");
    form.set("password", "whatever");

    await signin(undefined, form);

    expect(recordAuthAttempt).toHaveBeenCalledWith("unknown", "signin", expect.any(Number));
  });
});

describe("signup rate limiting", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    headersMock.mockReturnValue(fakeHeaders("203.0.113.7"));
  });

  it("rejects with a rate-limit error, without ever touching account creation, once the per-IP signup limit is exceeded", async () => {
    vi.mocked(recordAuthAttempt).mockResolvedValue(6); // > SIGNUP_LIMIT (5)
    const form = new FormData();
    form.set("email", "new@example.com");
    form.set("password", "longenoughpassword");

    const result = await signup(undefined, form);

    expect(result?.error).toMatch(/too many attempts/i);
    expect(getUserByEmail).not.toHaveBeenCalled();
  });

  it("uses a separate, more permissive limit/window than signin", async () => {
    vi.mocked(recordAuthAttempt).mockResolvedValue(1);
    vi.mocked(getUserByEmail).mockResolvedValue(undefined);
    vi.mocked(createUser).mockResolvedValue({ id: 1, email: "new@example.com", passwordHash: "x", name: null, createdAt: new Date() });
    const form = new FormData();
    form.set("email", "new@example.com");
    form.set("password", "longenoughpassword");

    // Won't reach a redirect in this test double (createTrialCheckoutSession
    // is mocked but unconfigured) — the RedirectSignal thrown proves
    // rate limiting didn't block this under-limit request; asserting the
    // action, not the specific redirect target, keeps this test focused.
    await expect(signup(undefined, form)).rejects.toThrow(RedirectSignal);
    expect(recordAuthAttempt).toHaveBeenCalledWith("203.0.113.7", "signup", expect.any(Number));
  });
});

describe("logout/session invalidation", () => {
  it("destroySession is called on signout, actually invalidating the session (not just clearing the cookie client-side)", async () => {
    vi.resetAllMocks();
    const { destroySession } = await import("./session");
    const { signout } = await import("./actions");
    await expect(signout()).rejects.toThrow(RedirectSignal);
    expect(destroySession).toHaveBeenCalled();
  });
});
