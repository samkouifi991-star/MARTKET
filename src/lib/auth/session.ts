import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { createSession as insertSession, deleteSession as removeSession, getSessionWithUser } from "@/db/queries/users";
import type { User } from "@/db/queries/users";

// Database-backed sessions (see schema.ts's `sessions` table for the
// rationale): the cookie carries nothing but an unguessable, high-entropy
// opaque token — no user data, no claims to trust without a lookup. Every
// real access re-validates it against Neon (see dal.ts's verifySession),
// so a session is revocable (logout) the instant its row is deleted,
// unlike a self-contained signed JWT that stays valid until it expires.
const COOKIE_NAME = "mi_session";
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export async function createSessionForUser(userId: number): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await insertSession(token, userId, expiresAt);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export async function getSessionUser(): Promise<User | undefined> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return undefined;
  const row = await getSessionWithUser(token);
  return row?.user;
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) await removeSession(token);
  cookieStore.delete(COOKIE_NAME);
}

// Optimistic-only check for proxy.ts (cookie presence, no DB round trip —
// Proxy runs on every request including prefetches, so it must stay fast;
// see node_modules/next/dist/docs's authentication guide). Never treat
// this as proof of a valid session — verifySession() in dal.ts is the
// real, DB-backed check every protected page/action must use.
export function hasSessionCookie(cookieValue: string | undefined): boolean {
  return Boolean(cookieValue);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
