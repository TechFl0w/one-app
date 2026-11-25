"use client";

import { useActionState, useState } from "react";
import { signIn, signUp, type AuthState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "signin" ? signIn : signUp, {});

  return (
    <form action={action} className="card w-full max-w-sm space-y-4 p-8">
      <div>
        <h1 className="text-2xl font-bold">{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
        <p className="mt-1 text-sm text-muted">
          {mode === "signin" ? "Sign in to manage your business." : "Set up your business in a few minutes."}
        </p>
      </div>
      <input type="hidden" name="next" value={next ?? "/"} />
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input
          className="input"
          id="password"
          name="password"
          type="password"
          minLength={8}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          required
        />
      </div>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state.message && <p className="rounded-xl bg-accent-tint px-4 py-2 text-sm text-accent">{state.message}</p>}
      <button className="btn-primary w-full" disabled={pending}>
        {mode === "signin" ? "Sign in" : "Create account"}
      </button>
      <button
        type="button"
        className="w-full text-sm text-muted hover:text-ink"
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
      >
        {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
