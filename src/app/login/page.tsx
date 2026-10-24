"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import { useApp } from "@/lib/sync/provider";
import { Button, Card, Input, Label } from "@/components/ui";

/**
 * Email and password rather than a magic link.
 *
 * A magic link has to bounce out to a mail client and back, and in an
 * installed PWA that round trip lands in the browser rather than the app. For
 * one person signing in rarely, a password is the faster and less breakable
 * path.
 */
export default function LoginPage() {
  const router = useRouter();
  const { auth } = useApp();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (auth === "signed-in") router.replace("/spend");
  }, [auth, router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sb = supabase();
      if (mode === "signin") {
        const { error: failure } = await sb.auth.signInWithPassword({ email, password });
        if (failure) throw failure;
      } else {
        const { data, error: failure } = await sb.auth.signUp({ email, password });
        if (failure) throw failure;
        if (!data.session) setNotice("Check your email to confirm the account, then sign in.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4">
        <Card tone="danger" className="p-5">
          <h1 className="text-lg font-bold text-white">Not configured</h1>
          <p className="mt-2 text-sm text-muted">
            Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then reload.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-4">
      <div className="mb-6 text-center">
        <h1 className="flex items-center justify-center gap-2 text-2xl font-bold text-white">
          <span className="pulse-dot inline-block size-3 rounded-full bg-accent-bright" />
          Float &amp; Cash
        </h1>
        <p className="mt-1 text-sm text-muted">
          {mode === "signin" ? "Sign in to your ledger" : "Create your ledger"}
        </p>
      </div>

      <Card className="p-5">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error && (
            <p className="rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-xl border border-accent-line bg-accent-soft px-3 py-2 text-sm text-accent-bright">
              {notice}
            </p>
          )}

          <Button type="submit" variant="primary" disabled={busy} className="w-full py-3.5">
            {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>
      </Card>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
          setNotice(null);
        }}
        className="mt-4 text-center text-sm text-muted hover:text-ink"
      >
        {mode === "signin" ? "No account yet? Create one" : "Already have an account? Sign in"}
      </button>
    </main>
  );
}
