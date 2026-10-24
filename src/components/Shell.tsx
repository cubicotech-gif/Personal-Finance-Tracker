"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, type ReactNode } from "react";
import { useApp } from "@/lib/sync/provider";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { accountBalances, summarise } from "@/lib/ledger/accounts";
import { Lakh } from "./Amount";
import { cx } from "./ui";

/**
 * The frame: a sticky header carrying the one figure that is true on every
 * screen, and five tabs along the bottom, one per question this app answers.
 *
 * Five tabs is the whole app. There is no sixth screen, no settings page and
 * no menu — anything that cannot be reached in one tap from here does not
 * exist.
 */

const TABS = [
  { href: "/spend", label: "Spend", icon: "📊" },
  { href: "/owe", label: "Who I Owe", icon: "⚠️" },
  { href: "/owed", label: "Owed to Me", icon: "🤝" },
  { href: "/wallets", label: "Wallets", icon: "💳" },
  { href: "/ledger", label: "Ledger", icon: "📜" },
] as const;

/**
 * The header's callable figure.
 *
 * This is the total that can be demanded of me with no notice — client float
 * and anything that landed by mistake. It rides on every screen because it is
 * the number that decides whether a given rupee is actually mine to spend.
 */
function CallablePill() {
  const snapshot = useSnapshot();
  const callable = useMemo(
    () => summarise(accountBalances(snapshot)).heldForOthers,
    [snapshot],
  );

  if (!snapshot.ready || callable === 0n) return null;

  return (
    <span className="t-label inline-flex items-center gap-1.5 rounded-full border border-danger-line bg-danger-soft px-2.5 py-1 text-danger">
      Callable <Lakh amount={callable} />
    </span>
  );
}

function SyncDot() {
  const { online, pending, blockedError } = useApp();

  const tone = blockedError
    ? "bg-danger"
    : !online
      ? "bg-faint"
      : pending > 0
        ? "bg-move"
        : "bg-accent-bright pulse-dot";

  const title = blockedError
    ? blockedError
    : !online
      ? pending > 0
        ? `Offline — ${pending} waiting to save`
        : "Offline"
      : pending > 0
        ? "Saving…"
        : "Saved";

  return <span className={cx("inline-block size-2.5 rounded-full", tone)} title={title} />;
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh pb-[var(--tabbar)]">
      <header className="sticky top-0 z-30 border-b border-line bg-gradient-to-b from-header to-canvas px-5 pt-5 pb-4">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-white">
              <SyncDot />
              Float &amp; Cash
            </h1>
            <p className="text-xs text-muted">Control centre</p>
          </div>
          <CallablePill />
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-5 p-4">{children}</main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-md items-stretch justify-around border-t border-line bg-header/95 px-2 backdrop-blur-md"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "my-1.5 flex flex-1 flex-col items-center justify-center rounded-2xl py-1.5 transition-colors",
                active ? "bg-accent-soft text-accent-bright" : "text-faint hover:text-muted",
              )}
            >
              <span className="text-lg leading-none" aria-hidden>
                {tab.icon}
              </span>
              <span className="mt-1 text-[10px] leading-none font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * Gate every real screen on being signed in and set up.
 *
 * Both checks read local state, so they still work with no network: an offline
 * launch goes straight to the ledger rather than bouncing to a login screen it
 * cannot verify.
 */
export function Guard({ children }: { children: ReactNode }) {
  const { auth, syncedOnce, online } = useApp();
  const snapshot = useSnapshot();
  const router = useRouter();

  /*
    An empty local database right after signing in means the download has not
    run yet, NOT that there is nothing to download — Dexie answers instantly
    while the pull is still in flight. Sending someone to /setup on that basis
    invites them to enter their opening balances a second time, which silently
    doubles every figure. It has happened. So wait for one completed sync before
    concluding that setup is needed.
  */
  const waitingForFirstSync = auth === "signed-in" && !syncedOnce && snapshot.accounts.length === 0;
  const needsSetup = snapshot.ready && !waitingForFirstSync && snapshot.accounts.length === 0;

  useEffect(() => {
    if (auth === "signed-out") router.replace("/login");
    else if (auth === "signed-in" && needsSetup) router.replace("/setup");
  }, [auth, needsSetup, router]);

  if (auth === "loading" || !snapshot.ready || waitingForFirstSync) {
    return (
      <p className="px-4 py-16 text-center text-sm text-faint">
        {waitingForFirstSync && !online ? "Offline — waiting for your data…" : "Loading…"}
      </p>
    );
  }
  if (auth === "signed-out" || needsSetup) return null;

  return <>{children}</>;
}
