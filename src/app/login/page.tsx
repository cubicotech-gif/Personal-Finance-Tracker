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
      <main className="mx-auto max-w-lg px-4 py-16">
        <Card className="p-4">
          <h1 className="mb-2 text-lg font-semibold">Not configured</h1>
          <p className="text-sm text-muted">
            Set <code className="rounded bg-canvas px-1">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="rounded bg-canvas px-1">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, then reload.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="mb-1 text-2xl font-semibold">Finance</h1>
      <p className="mb-6 text-sm text-muted">
        {mode === "signin" ? "Sign in to sync this device." : "Create the account for this ledger."}
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
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
        {notice && <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">{notice}</p>}

        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>

      <button
        type="button"
        className="mt-4 text-sm text-muted underline"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
          setNotice(null);
        }}
      >
        {mode === "signin" ? "Create an account instead" : "I already have an account"}
      </button>
    </main>
  );
}
