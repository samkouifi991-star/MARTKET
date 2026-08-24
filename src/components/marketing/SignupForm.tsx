"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup, type AuthFormState } from "@/lib/auth/actions";

export function SignupForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signup, undefined);

  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="name" className="block text-xs text-(--text-faint) mb-1">Name (optional)</label>
        <input
          id="name"
          name="name"
          autoComplete="name"
          className="w-full h-10 rounded-lg border border-(--border) bg-(--bg-card) px-3 text-sm outline-none focus:border-(--accent)"
        />
      </div>
      <div>
        <label htmlFor="email" className="block text-xs text-(--text-faint) mb-1">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full h-10 rounded-lg border border-(--border) bg-(--bg-card) px-3 text-sm outline-none focus:border-(--accent)"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-xs text-(--text-faint) mb-1">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full h-10 rounded-lg border border-(--border) bg-(--bg-card) px-3 text-sm outline-none focus:border-(--accent)"
        />
        <p className="mt-1 text-[11px] text-(--text-faint)">At least 8 characters.</p>
      </div>

      {state?.error && <p className="text-xs text-rose-400">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full h-10 rounded-lg bg-(--accent) text-white text-sm font-semibold disabled:opacity-60"
      >
        {pending ? "Creating account…" : "Continue to payment details"}
      </button>

      <p className="text-[11px] text-(--text-faint) text-center">
        No charge today · $39/month after your 3-day trial · cancel anytime
      </p>

      <p className="text-xs text-(--text-dim) text-center">
        Already have an account?{" "}
        <Link href="/signin" className="text-(--accent) hover:underline">Sign in</Link>
      </p>
    </form>
  );
}
