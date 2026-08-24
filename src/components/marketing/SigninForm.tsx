"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signin, type AuthFormState } from "@/lib/auth/actions";

export function SigninForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signin, undefined);

  return (
    <form action={action} className="space-y-4">
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
          autoComplete="current-password"
          className="w-full h-10 rounded-lg border border-(--border) bg-(--bg-card) px-3 text-sm outline-none focus:border-(--accent)"
        />
      </div>

      {state?.error && <p className="text-xs text-rose-400">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="w-full h-10 rounded-lg bg-(--accent) text-white text-sm font-semibold disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-xs text-(--text-dim) text-center">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-(--accent) hover:underline">Start your 3-day free trial</Link>
      </p>
    </form>
  );
}
