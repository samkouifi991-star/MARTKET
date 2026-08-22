"use server";

import { redirect } from "next/navigation";
import { getUserByEmail, createUser, getSubscriptionByUserId } from "@/db/queries/users";
import { hashPassword, verifyPassword } from "./password";
import { createSessionForUser, destroySession } from "./session";
import { isAdminUser, isEntitled } from "./dal";
import { createTrialCheckoutSession } from "@/lib/billing";

export type AuthFormState = { error: string } | undefined;

function validateEmail(email: string): string | null {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  return null;
}

function validatePassword(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  return null;
}

/** Create an account → start a session → immediately send the browser to
 * Stripe Checkout for the 3-day-trial subscription. Card entry happens
 * entirely on Stripe's hosted page; this app never sees the card data. */
export async function signup(_prevState: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const emailError = validateEmail(email);
  if (emailError) return { error: emailError };
  const passwordError = validatePassword(password);
  if (passwordError) return { error: passwordError };

  const existing = await getUserByEmail(email);
  if (existing) return { error: "An account with this email already exists — sign in instead." };

  const passwordHash = await hashPassword(password);
  const user = await createUser(email, passwordHash, name || undefined);
  await createSessionForUser(user.id);

  let checkoutUrl: string;
  try {
    checkoutUrl = await createTrialCheckoutSession(user);
  } catch {
    // Account + session are already created — never lose the account over
    // a billing-setup failure (e.g. Stripe not configured yet). Land on
    // the paywall, where "Start 3-Day Free Trial" can retry checkout.
    redirect("/paywall?error=checkout_unavailable");
  }
  redirect(checkoutUrl);
}

export async function signin(_prevState: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const user = await getUserByEmail(email);
  if (!user) return { error: "Invalid email or password." };

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return { error: "Invalid email or password." };

  await createSessionForUser(user.id);

  const subscription = await getSubscriptionByUserId(user.id);
  redirect(isAdminUser(user) || isEntitled(subscription) ? "/dashboard" : "/paywall");
}

export async function signout(): Promise<void> {
  await destroySession();
  redirect("/");
}
