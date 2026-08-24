// Regression coverage for the access-control rule the paywall depends on:
// the approved admin/owner account (ADMIN_EMAILS) always bypasses the
// SUBSCRIPTION check — in every environment, including production — while
// every other user needs an active `trialing`/`active` subscription.
// canceled/past_due/unpaid/incomplete/incomplete_expired must all be
// denied — this is what keeps a lapsed or failed-payment user out of the
// app pages until they reactivate. The admin bypass never skips
// authentication itself: requireSession() (a real, valid session cookie)
// always runs first, in every guard below.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { isEntitled, isAdminUser } from "./dal";
import type { Subscription, User } from "@/db/queries/users";

function subscription(status: string): Subscription {
  return {
    id: 1,
    userId: 1,
    stripeCustomerId: "cus_test",
    stripeSubscriptionId: "sub_test",
    status,
    priceId: "price_test",
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    updatedAt: new Date(),
    createdAt: new Date(),
  };
}

function user(email: string): User {
  return { id: 1, email, passwordHash: "hash", name: null, createdAt: new Date() };
}

describe("isEntitled", () => {
  it.each(["trialing", "active"])("grants access for status=%s", (status) => {
    expect(isEntitled(subscription(status))).toBe(true);
  });

  it.each(["canceled", "past_due", "unpaid", "incomplete", "incomplete_expired"])("denies access for status=%s", (status) => {
    expect(isEntitled(subscription(status))).toBe(false);
  });

  it("denies access when there is no subscription row at all", () => {
    expect(isEntitled(undefined)).toBe(false);
  });
});

describe("isAdminUser — works in every environment, including production", () => {
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  afterEach(() => {
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
    if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdminEmails;
  });

  it("allows the approved admin email in production — this is the real regression test: the bypass used to be disabled specifically in production", () => {
    process.env.VERCEL_ENV = "production";
    expect(isAdminUser(user("samkouifi991@gmail.com"))).toBe(true);
  });

  it("allows the approved admin email outside production too", () => {
    delete process.env.VERCEL_ENV;
    expect(isAdminUser(user("samkouifi991@gmail.com"))).toBe(true);
  });

  it("denies a non-admin email regardless of environment", () => {
    process.env.VERCEL_ENV = "production";
    expect(isAdminUser(user("someone-else@example.com"))).toBe(false);
  });

  it("denies when there is no user at all", () => {
    process.env.VERCEL_ENV = "production";
    expect(isAdminUser(undefined)).toBe(false);
  });

  it("email matching is case-insensitive", () => {
    process.env.VERCEL_ENV = "production";
    expect(isAdminUser(user("SamKouifi991@Gmail.com"))).toBe(true);
  });
});

// requireEntitlement/requireSession/requireAdmin are the real page-level
// guards — tested end-to-end (through the actual exported functions, not
// just the pure isAdminUser/isEntitled helpers) by mocking the session and
// subscription lookups plus next/navigation's redirect, mirroring exactly
// what a Server Component page does when it calls these.
vi.mock("./session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/db/queries/users", () => ({ getSubscriptionByUserId: vi.fn() }));

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

describe("requireEntitlement / requireSession / requireAdmin", () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;
  const originalVercelEnv = process.env.VERCEL_ENV;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.VERCEL_ENV = "production";
  });

  afterEach(() => {
    if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdminEmails;
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
  });

  it("admin can reach requireEntitlement() in production with no subscription row at all — the exact scenario behind 'my own admin account gets redirected to /paywall'", async () => {
    const { getSessionUser } = await import("./session");
    const { getSubscriptionByUserId } = await import("@/db/queries/users");
    vi.mocked(getSessionUser).mockResolvedValue(user("samkouifi991@gmail.com"));
    vi.mocked(getSubscriptionByUserId).mockResolvedValue(undefined);

    const { requireEntitlement } = await import("./dal");
    const result = await requireEntitlement();

    expect(result.user.email).toBe("samkouifi991@gmail.com");
    expect(result.subscription).toBeNull();
    // The admin short-circuit returns before ever reading a subscription —
    // no Stripe/subscription state is created or consulted for the admin.
    expect(getSubscriptionByUserId).not.toHaveBeenCalled();
  });

  it("a normal signed-in user with no trial/subscription is redirected to /paywall", async () => {
    const { getSessionUser } = await import("./session");
    const { getSubscriptionByUserId } = await import("@/db/queries/users");
    vi.mocked(getSessionUser).mockResolvedValue(user("customer@example.com"));
    vi.mocked(getSubscriptionByUserId).mockResolvedValue(undefined);

    const { requireEntitlement } = await import("./dal");
    await expect(requireEntitlement()).rejects.toThrow("REDIRECT:/paywall");
  });

  it("a trialing user is allowed", async () => {
    const { getSessionUser } = await import("./session");
    const { getSubscriptionByUserId } = await import("@/db/queries/users");
    vi.mocked(getSessionUser).mockResolvedValue(user("customer@example.com"));
    vi.mocked(getSubscriptionByUserId).mockResolvedValue(subscription("trialing"));

    const { requireEntitlement } = await import("./dal");
    const result = await requireEntitlement();
    expect(result.subscription?.status).toBe("trialing");
  });

  it("an active subscriber is allowed", async () => {
    const { getSessionUser } = await import("./session");
    const { getSubscriptionByUserId } = await import("@/db/queries/users");
    vi.mocked(getSessionUser).mockResolvedValue(user("customer@example.com"));
    vi.mocked(getSubscriptionByUserId).mockResolvedValue(subscription("active"));

    const { requireEntitlement } = await import("./dal");
    const result = await requireEntitlement();
    expect(result.subscription?.status).toBe("active");
  });

  it("a canceled subscriber is still redirected to /paywall, admin or not — the bypass is identity-based, not weight-based", async () => {
    const { getSessionUser } = await import("./session");
    const { getSubscriptionByUserId } = await import("@/db/queries/users");
    vi.mocked(getSessionUser).mockResolvedValue(user("customer@example.com"));
    vi.mocked(getSubscriptionByUserId).mockResolvedValue(subscription("canceled"));

    const { requireEntitlement } = await import("./dal");
    await expect(requireEntitlement()).rejects.toThrow("REDIRECT:/paywall");
  });

  it("a logged-out admin email cannot bypass authentication — with no session at all, requireEntitlement redirects to /signin, never granting access", async () => {
    const { getSessionUser } = await import("./session");
    vi.mocked(getSessionUser).mockResolvedValue(undefined);

    const { requireEntitlement } = await import("./dal");
    await expect(requireEntitlement()).rejects.toThrow("REDIRECT:/signin");
  });

  it("requireAdmin() allows the approved admin account", async () => {
    const { getSessionUser } = await import("./session");
    vi.mocked(getSessionUser).mockResolvedValue(user("samkouifi991@gmail.com"));

    const { requireAdmin } = await import("./dal");
    const admin = await requireAdmin();
    expect(admin.email).toBe("samkouifi991@gmail.com");
  });

  it("requireAdmin() denies a normal signed-in user (redirects to /paywall) — /admin stays restricted to the owner account", async () => {
    const { getSessionUser } = await import("./session");
    vi.mocked(getSessionUser).mockResolvedValue(user("customer@example.com"));

    const { requireAdmin } = await import("./dal");
    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/paywall");
  });
});
