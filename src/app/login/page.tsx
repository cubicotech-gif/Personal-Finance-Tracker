"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import { useApp } from "@/lib/sync/provider";
import { Button, Card, ErrorNote, Input, Label } from "@/components/ui";

/**
 * Email and password rather than a magic link.
 *
 * A magic link has to bounce out to a mail client and back, and in a standalone
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
    if (auth === "signed-in") router.replace("/log");
  }, [auth, router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sb = supabase();
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) {
          setNotice("Check your email to confirm the account, then sign in.");
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4">
        <Card className="p-4">
          <h1 className="t-section mb-2">Not configured</h1>
          <p className="text-muted">
            Set <code className="rounded-lg bg-raised px-1.5 py-0.5">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="rounded-lg bg-raised px-1.5 py-0.5">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then
            reload.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-4">
      <form onSubmit={onSubmit} className="flex flex-1 flex-col">
        <div className="pt-20">
          <h1 className="t-hero">Finance</h1>
          <p className="mt-2 text-muted">
            {mode === "signin" ? "Sign in to sync this device." : "Create the account for this ledger."}
          </p>
        </div>

        <div className="mt-10 space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <ErrorNote>{error}</ErrorNote>
          {notice && <p className="rounded-2xl bg-accent-soft px-4 py-3 text-accent">{notice}</p>}
        </div>

        {/* The action sits at the bottom, where the thumb already is. */}
        <div
          className="mt-auto space-y-1 pt-6 pb-3"
          style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
        >
          <Button type="submit" variant="primary" className="h-14 w-full" disabled={busy}>
            {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
          <button
            type="button"
            className="min-h-11 w-full text-muted underline"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setNotice(null);
            }}
          >
            {mode === "signin" ? "Create an account instead" : "I already have an account"}
          </button>
        </div>
      </form>
    </main>
  );
}
