"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useApp } from "@/lib/sync/provider";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { IconLayoutGrid, IconPlus, IconUsers, IconWallet } from "@tabler/icons-react";
import { ThemeToggle } from "./ThemeToggle";
import { cx } from "./ui";

const TABS = [
  { href: "/accounts", label: "Accounts", icon: IconWallet },
  { href: "/log", label: "Log", icon: IconPlus },
  { href: "/boxes", label: "Boxes", icon: IconLayoutGrid },
  { href: "/people", label: "People", icon: IconUsers },
] as const;

function SyncStatus() {
  const { online, pending, blockedError } = useApp();

  const base = "t-label flex items-center gap-1.5";
  const dot = "size-1.5 rounded-full";

  if (blockedError) {
    return (
      <span className={cx(base, "text-danger")} title={blockedError}>
        <span className={cx(dot, "bg-danger")} /> sync blocked
      </span>
    );
  }
  if (!online) {
    return (
      <span className={cx(base, "text-muted")}>
        <span className={cx(dot, "bg-muted")} /> offline{pending > 0 ? ` · ${pending} queued` : ""}
      </span>
    );
  }
  if (pending > 0) {
    return (
      <span className={cx(base, "text-muted")}>
        <span className={cx(dot, "bg-muted")} /> saving
      </span>
    );
  }
  return (
    <span className={cx(base, "text-muted")}>
      <span className={cx(dot, "bg-accent")} /> synced
    </span>
  );
}

/** Height of the tab bar, shared with anything that has to sit above it. */
export const TABBAR = "calc(64px + env(safe-area-inset-bottom))";

export function Shell({ title, children }: { title: string; children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <header className="flex h-12 items-center justify-between px-4">
        <h1 className="t-label text-muted">{title}</h1>
        <div className="flex items-center gap-1">
          <SyncStatus />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 px-4" style={{ paddingBottom: TABBAR }}>
        {children}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 mx-auto grid max-w-lg grid-cols-4 bg-surface"
        style={{ height: TABBAR, paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          const centre = tab.href === "/log";
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex flex-col items-center justify-center text-xs transition-colors",
                active || centre ? "text-ink" : "text-muted",
              )}
            >
              {centre ? (
                <span
                  className={cx(
                    "flex size-9 items-center justify-center rounded-full",
                    active ? "bg-accent text-on-accent" : "bg-accent-soft text-accent",
                  )}
                >
                  <Icon size={22} stroke={2} />
                </span>
              ) : (
                <span className="flex size-9 items-center justify-center">
                  <Icon size={22} stroke={active ? 2 : 1.5} />
                </span>
              )}
              <span className={active ? "font-medium" : undefined}>{tab.label}</span>
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
    return <p className="px-4 py-10 text-center text-muted">Loading…</p>;
  }
  if (auth === "signed-out" || needsSetup) return null;

  return <>{children}</>;
}
