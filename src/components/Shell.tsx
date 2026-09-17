"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useApp } from "@/lib/sync/provider";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { cx } from "./ui";

const TABS = [
  { href: "/log", label: "Log" },
  { href: "/boxes", label: "Boxes" },
  { href: "/accounts", label: "Accounts" },
  { href: "/people", label: "People" },
] as const;

function SyncStatus() {
  const { online, pending, blockedError } = useApp();

  if (blockedError) {
    return (
      <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs text-danger" title={blockedError}>
        sync blocked
      </span>
    );
  }
  if (!online) {
    return (
      <span className="rounded-full bg-canvas px-2 py-0.5 text-xs text-muted">
        offline{pending > 0 ? ` · ${pending} queued` : ""}
      </span>
    );
  }
  if (pending > 0) {
    return <span className="rounded-full bg-canvas px-2 py-0.5 text-xs text-muted">saving…</span>;
  }
  return <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">synced</span>;
}

export function Shell({ title, children }: { title: string; children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-semibold">{title}</h1>
        <SyncStatus />
      </header>

      <main className="flex-1 px-4 pt-4 pb-8">{children}</main>

      <nav className="sticky bottom-0 grid grid-cols-4 border-t border-line bg-surface">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "py-3 text-center text-sm font-medium transition-colors",
                active ? "text-ink" : "text-muted",
              )}
            >
              {tab.label}
              <span
                aria-hidden
                className={cx("mx-auto mt-1 block h-0.5 w-8 rounded-full", active ? "bg-ink" : "bg-transparent")}
              />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * Gate every real page on being signed in and having finished setup.
 *
 * Both checks read local state, so they still work with no network — an
 * offline launch goes straight to the ledger rather than bouncing to a login
 * screen it cannot verify.
 */
export function Guard({ children }: { children: ReactNode }) {
  const { auth } = useApp();
  const snapshot = useSnapshot();
  const router = useRouter();

  const needsSetup = snapshot.ready && snapshot.accounts.length === 0;

  useEffect(() => {
    if (auth === "signed-out") router.replace("/login");
    else if (auth === "signed-in" && needsSetup) router.replace("/setup");
  }, [auth, needsSetup, router]);

  if (auth === "loading" || !snapshot.ready) {
    return <p className="px-4 py-10 text-center text-sm text-muted">Loading…</p>;
  }
  if (auth === "signed-out" || needsSetup) return null;

  return <>{children}</>;
}
