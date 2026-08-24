// Accounts + billing queries — the only place that touches the users/
// sessions/subscriptions tables. Stripe webhooks (app/api/webhooks/stripe/
// route.ts) are the sole writer of subscription status/period fields; every
// other write here is auth-flow-driven (signup, session create/destroy).
import { eq, and, gt, gte, sql } from "drizzle-orm";
import { getDb } from "../client";
import { users, sessions, subscriptions } from "../schema";

export type User = typeof users.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;

export async function createUser(email: string, passwordHash: string, name?: string): Promise<User> {
  const db = getDb();
  const [user] = await db.insert(users).values({ email: email.toLowerCase().trim(), passwordHash, name }).returning();
  return user;
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1);
  return user;
}

export async function getUserById(id: number): Promise<User | undefined> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user;
}

export async function createSession(id: string, userId: number, expiresAt: Date): Promise<void> {
  const db = getDb();
  await db.insert(sessions).values({ id, userId, expiresAt });
}

export async function getSessionWithUser(sessionId: string): Promise<{ session: typeof sessions.$inferSelect; user: User } | undefined> {
  const db = getDb();
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function getSubscriptionByUserId(userId: number): Promise<Subscription | undefined> {
  const db = getDb();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  return sub;
}

export async function getSubscriptionByStripeCustomerId(stripeCustomerId: string): Promise<Subscription | undefined> {
  const db = getDb();
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, stripeCustomerId)).limit(1);
  return sub;
}

export async function getUserByStripeCustomerId(stripeCustomerId: string): Promise<User | undefined> {
  const db = getDb();
  const [row] = await db
    .select({ user: users })
    .from(subscriptions)
    .innerJoin(users, eq(subscriptions.userId, users.id))
    .where(eq(subscriptions.stripeCustomerId, stripeCustomerId))
    .limit(1);
  return row?.user;
}

// Called once, right after a user starts Stripe Checkout — records which
// Stripe customer belongs to which user before any webhook has fired, so
// the webhook (which only ever sees Stripe IDs, never our userId) can find
// its way back via getSubscriptionByStripeCustomerId /
// getUserByStripeCustomerId above.
export async function createPendingSubscription(userId: number, stripeCustomerId: string): Promise<void> {
  const db = getDb();
  await db
    .insert(subscriptions)
    .values({ userId, stripeCustomerId, status: "incomplete" })
    .onConflictDoUpdate({ target: subscriptions.userId, set: { stripeCustomerId, updatedAt: new Date() } });
}

export type SubscriptionUpsert = {
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  status: string;
  priceId: string | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

// Webhook-driven upsert, keyed by Stripe customer id (the one identifier
// every relevant Stripe event carries) rather than our own userId — see
// app/api/webhooks/stripe/route.ts.
export async function upsertSubscriptionByStripeCustomerId(data: SubscriptionUpsert): Promise<void> {
  const db = getDb();
  const existing = await getSubscriptionByStripeCustomerId(data.stripeCustomerId);
  if (!existing) {
    // A webhook should never arrive before createPendingSubscription ran
    // (Checkout Session creation happens synchronously before Stripe can
    // emit any event for that customer) — but never silently drop real
    // billing state if it somehow does.
    throw new Error(`No local subscription row for Stripe customer ${data.stripeCustomerId} — cannot attribute this webhook to a user`);
  }
  await db
    .update(subscriptions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(subscriptions.stripeCustomerId, data.stripeCustomerId));
}

export type AdminUserActivity = {
  recentlyActiveUsers24h: number;
  recentlyActiveUsers7d: number;
  trialUsers: number;
  subscriberUsers: number;
};

// Phase 18 (public-launch demo sweep): the admin dashboard's "Daily active
// users" / "Trialing / Subscribers" stat tiles used to be hand-picked demo
// numbers shown unconditionally, regardless of DATA_MODE — real users,
// sessions and subscriptions have existed since the auth/Stripe milestones.
// "Recently active" is a real proxy from session creation (login) times —
// this app has no separate page-view/activity-event log, so it counts
// distinct users who started a session in the window, not literal DAU.
// Trial/subscriber counts are exact, read straight from subscriptions.status
// (Stripe's own vocabulary, never a parallel invented one).
export async function getAdminUserActivity(): Promise<AdminUserActivity> {
  const db = getDb();
  const since24h = new Date(Date.now() - 24 * 3600_000);
  const since7d = new Date(Date.now() - 7 * 86_400_000);

  const [active24h, active7d, trials, subscribers] = await Promise.all([
    db.select({ count: sql<number>`count(distinct ${sessions.userId})` }).from(sessions).where(gte(sessions.createdAt, since24h)),
    db.select({ count: sql<number>`count(distinct ${sessions.userId})` }).from(sessions).where(gte(sessions.createdAt, since7d)),
    db.select({ count: sql<number>`count(*)` }).from(subscriptions).where(eq(subscriptions.status, "trialing")),
    db.select({ count: sql<number>`count(*)` }).from(subscriptions).where(eq(subscriptions.status, "active")),
  ]);

  return {
    recentlyActiveUsers24h: Number(active24h[0]?.count ?? 0),
    recentlyActiveUsers7d: Number(active7d[0]?.count ?? 0),
    trialUsers: Number(trials[0]?.count ?? 0),
    subscriberUsers: Number(subscribers[0]?.count ?? 0),
  };
}
