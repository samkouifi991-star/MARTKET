// Regression coverage for the access-control rule the paywall depends on:
// only `trialing`/`active` subscriptions (or an approved admin bypass,
// itself gated to non-production) grant access to the paid product.
// canceled/past_due/unpaid/incomplete/incomplete_expired must all be
// denied — this is what keeps a lapsed or failed-payment user out of the
// app pages until they reactivate, per the task's explicit requirement.
import { describe, expect, it, afterEach } from "vitest";
import { isEntitled, isAdminUser, isAdminBypassAllowed } from "./dal";
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

describe("isAdminUser — approved bypass, non-production only", () => {
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  afterEach(() => {
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
    if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdminEmails;
  });

  it("allows the bypass outside production", () => {
    delete process.env.VERCEL_ENV;
    expect(isAdminBypassAllowed()).toBe(true);
  });

  it("never allows the bypass in production, even for the approved email", () => {
    process.env.VERCEL_ENV = "production";
    expect(isAdminBypassAllowed()).toBe(false);
    expect(isAdminUser(user("samkouifi991@gmail.com"))).toBe(false);
  });

  it("denies a non-admin email regardless of environment", () => {
    delete process.env.VERCEL_ENV;
    expect(isAdminUser(user("someone-else@example.com"))).toBe(false);
  });

  it("denies when there is no user at all", () => {
    delete process.env.VERCEL_ENV;
    expect(isAdminUser(undefined)).toBe(false);
  });
});
