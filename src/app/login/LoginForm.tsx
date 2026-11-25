"use client";

import { useActionState, useState } from "react";
import { sendSignInLink, signIn, signUp, type AuthState } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<"signin" | "signup" | "link">("signin");
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "signin" ? signIn : mode === "signup" ? signUp : sendSignInLink, {});

  return (
    <form action={action} className="card w-full max-w-sm space-y-4 p-8">
      <div>
        <h1 className="text-2xl font-bold">{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-1 text-sm text-muted">
          {mode === "signup" ? "Set up your business in a few minutes." : mode === "link" ? "We’ll email you a link that signs you in." : "Sign in to manage your business."}
        </p>
      </div>
      <input type="hidden" name="next" value={next ?? "/"} />
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {mode !== "link" && <div>
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
      </div>}
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state.message && <p className="rounded-xl bg-accent-tint px-4 py-2 text-sm text-accent">{state.message}</p>}
      <button className="btn-primary w-full" disabled={pending}>
        {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Email me a sign-in link"}
      </button>
      {mode === "signin" && (
        <button type="button" className="w-full text-sm text-muted hover:text-ink" onClick={() => setMode("link")}>
          Forgot your password? Email me a sign-in link
        </button>
      )}
      <button
        type="button"
        className="w-full text-sm text-muted hover:text-ink"
        onClick={() => setMode(mode === "signup" ? "signin" : mode === "link" ? "signin" : "signup")}
      >
        {mode === "signin" ? "New here? Create an account" : mode === "link" ? "Back to sign in with a password" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
