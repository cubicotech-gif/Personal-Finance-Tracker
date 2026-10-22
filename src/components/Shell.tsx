"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useApp } from "@/lib/sync/provider";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { IconLayoutGrid, IconPlus, IconUsers, IconWallet } from "@tabler/icons-react";
import { PrivacyToggle } from "./PrivacyToggle";
import { ThemeToggle } from "./ThemeToggle";
import { cx } from "./ui";

const TABS = [
  { href: "/accounts", label: "Home", icon: IconWallet },
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

/**
 * Height of the tab bar, shared with anything that has to sit above it.
 * Defined in CSS so it can collapse to zero on desktop, where the tab bar is
 * replaced by the sidebar — every pinned action follows automatically.
 */
export const TABBAR = "var(--tabbar)";

/**
 * Navigation as a sidebar, from `lg` up.
 *
 * The phone layout is a 512px column, which on a laptop leaves most of the
 * screen empty and forces scrolling past things that would otherwise fit side
 * by side. Above `lg` the tab bar becomes a sidebar and the content area
 * widens; below it, nothing changes.
 */
function Sidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-line px-3 py-4 lg:flex">
      <p className="px-3 pb-4 text-lg font-semibold">Finance</p>

      <nav className="flex flex-col gap-1">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                active ? "bg-raised font-medium text-ink" : "text-muted hover:bg-raised/60 hover:text-ink",
              )}
            >
              <Icon size={20} stroke={active ? 2 : 1.5} />
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex items-center justify-between px-3">
        <SyncStatus />
        <div className="flex items-center">
          <PrivacyToggle />
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}

export function Shell({ title, children }: { title: string; children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="lg:flex">
      <Sidebar pathname={pathname} />

      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col lg:max-w-5xl lg:px-6">
        {/* The sidebar carries the title and status on desktop. */}
        <header className="flex h-12 items-center justify-between px-4 lg:hidden">
          <h1 className="t-label text-muted">{title}</h1>
          <div className="flex items-center gap-1">
            <SyncStatus />
            <PrivacyToggle />
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 px-4 pb-[var(--tabbar)] lg:px-0 lg:pt-6 lg:pb-10">{children}</main>

        <nav
          className="fixed inset-x-0 bottom-0 z-20 mx-auto grid max-w-lg grid-cols-4 bg-surface lg:hidden"
          style={{
            height: "calc(64px + env(safe-area-inset-bottom))",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
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
  const { auth, syncedOnce, online } = useApp();
  const snapshot = useSnapshot();
  const router = useRouter();

  /**
   * An empty local database right after signing in means the download has not
   * run yet, NOT that there is nothing to download — Dexie answers instantly
   * while the pull is still in flight. Sending someone to /setup on that basis
   * invites them to enter their opening balances a second time, which silently
   * doubles every figure. So wait for one completed sync before concluding
   * that setup is needed.
   */
  const waitingForFirstSync = auth === "signed-in" && !syncedOnce && snapshot.accounts.length === 0;
  const needsSetup = snapshot.ready && !waitingForFirstSync && snapshot.accounts.length === 0;

  useEffect(() => {
    if (auth === "signed-out") router.replace("/login");
    else if (auth === "signed-in" && needsSetup) router.replace("/setup");
  }, [auth, needsSetup, router]);

  if (auth === "loading" || !snapshot.ready || waitingForFirstSync) {
    return (
      <p className="px-4 py-10 text-center text-muted">
        {waitingForFirstSync && !online ? "Offline — waiting to load your data…" : "Loading…"}
      </p>
    );
  }
  if (auth === "signed-out" || needsSetup) return null;

  return <>{children}</>;
}
