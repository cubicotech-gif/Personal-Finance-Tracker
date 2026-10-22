"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { Money } from "@/components/Money";
import { PullToRefresh } from "@/components/PullToRefresh";
import { TABBAR } from "@/components/Shell";
import { Button, Card, Empty, ErrorNote, Input, SectionTitle, cx } from "@/components/ui";
import { useSnapshot } from "@/lib/ledger/snapshot";
import {
  GROUP_LABEL,
  GROUP_ORDER,
  accountBalances,
  groupOf,
  netWorthChange,
  realMoneyAccounts,
  summarise,
} from "@/lib/ledger/accounts";
import { upsertRate } from "@/lib/db/mutations";
import { HomeSections } from "./HomeSections";
import { WalletStrip } from "./WalletStrip";
import { useApp } from "@/lib/sync/provider";
import { formatAmount } from "@/lib/format";
import { formatRate, parseRate, type Minor } from "@/lib/money";
import { today } from "@/lib/dates";

/** Height reserved for the pinned action, so content never hides behind it. */
const ACTION_H = 76;

/** A long figure steps down a size so it stays on one line in a half-width tile. */
function tileSize(amount: Minor): string {
  return formatAmount(amount, "PKR").length > 10 ? "text-[20px]" : "t-section";
}

function StatTile({
  label,
  hint,
  amount,
  tone = "plain",
  alert = false,
  className,
}: {
  label: string;
  hint?: string;
  amount: Minor;
  tone?: "auto" | "plain" | "danger";
  alert?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("rounded-2xl p-4", alert ? "bg-danger-soft" : "bg-surface", className)}>
      <p className={cx("t-label truncate", alert ? "text-danger" : "text-muted")}>{label}</p>
      <Money amount={amount} tone={tone} className={cx("mt-2 block font-medium", tileSize(amount))} />
      {hint && <p className={cx("mt-1 text-xs", alert ? "text-danger" : "text-muted")}>{hint}</p>}
    </div>
  );
}

export function AccountsScreen() {
  const snapshot = useSnapshot();
  const { sync } = useApp();
  const balances = useMemo(() => accountBalances(snapshot), [snapshot]);
  const summary = useMemo(() => summarise(balances), [balances]);
  const change = useMemo(() => netWorthChange(snapshot, today()), [snapshot]);
  const rows = useMemo(() => realMoneyAccounts(balances), [balances]);

  const groups = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        rows: rows.filter((row) => groupOf(row.account) === group),
      })).filter((entry) => entry.rows.length > 0),
    [rows],
  );
  const hasUsd = snapshot.accounts.some((account) => account.currency === "USD");

  // Everything on this screen is derived from the local database on every
  // render, so "recalculate" means: fetch what other devices changed, and the
  // live query does the rest.
  const refresh = useCallback(() => sync(), [sync]);

  const shortfall = summary.floatShortfall < 0n;

  return (
    <div className="flex flex-col" style={{ minHeight: `calc(100dvh - 48px - ${TABBAR})` }}>
      <div className="flex-1">
        <PullToRefresh onRefresh={refresh}>
          {/*
            One column on a phone, two from `lg` up. Placement is explicit so
            the reading order is right in both: on a phone the sections simply
            stack in order, while on a desktop the balances and account list
            take the main column and what-happens-next sits beside them, with
            no duplicated markup and no scrolling past accounts to reach it.
          */}
          <div className="flex flex-col gap-6 pb-6 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            <div className="space-y-6 lg:col-start-1 lg:row-start-1">
            {/* Hero ------------------------------------------------------
                The headline and the two figures that qualify it belong to one
                another, so they share a card: the big number says where you
                stand, the pair underneath says how much of it is actually
                yours. Split across separate blocks they read as three
                unrelated statistics. */}
            <section className="rounded-2xl bg-surface p-4">
              <p className="t-label text-muted">Net worth</p>
              <Money
                amount={summary.netWorth}
                tone="plain"
                countOnMount
                className="t-hero mt-1 block"
              />
              <p className="mt-2 text-muted">
                {change.hasPrevious ? (
                  <>
                    <Money
                      amount={change.delta}
                      signed
                      tone={change.delta > 0n ? "positive" : change.delta < 0n ? "danger" : "plain"}
                    />{" "}
                    vs last month
                  </>
                ) : (
                  "Nothing to compare with yet"
                )}
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3">
                <div>
                  <p className="t-label text-muted">Mine</p>
                  <Money amount={summary.mine} tone="auto" className="mt-0.5 block font-semibold" />
                  <p className="t-label text-muted">free to spend</p>
                </div>
                <div>
                  <p className="t-label text-muted">Held for others</p>
                  <Money amount={summary.heldForOthers} tone="plain" className="mt-0.5 block font-semibold" />
                  <p className="t-label text-muted">float owed to clients</p>
                </div>
              </div>
            </section>

            {/* The shortfall is a warning, not a statistic — it keeps its own
                card so it can shout when it needs to. */}
            <section>
              <StatTile
                label="Float shortfall"
                hint={shortfall ? "float money already spent. Must be returned." : "float is fully backed"}
                amount={summary.floatShortfall}
                tone={shortfall ? "danger" : "plain"}
                alert={shortfall}
              />
            </section>

            </div>

            {/* What happens next: due dates, the chase list, this month. */}
            <div className="space-y-6 lg:col-start-2 lg:row-start-1 lg:row-span-2">
              <HomeSections />
            </div>

            <div className="space-y-6 lg:col-start-1 lg:row-start-2">
            {hasUsd && <RateCard />}

            {/* Accounts, by kind ---------------------------------------- */}
            {groups.length === 0 ? (
              <Empty>No accounts yet.</Empty>
            ) : (
              groups.map(({ group, rows: groupRows }) => (
                <section key={group}>
                  <SectionTitle>{GROUP_LABEL[group]}</SectionTitle>
                  <WalletStrip rows={groupRows} />
                </section>
              ))
            )}

            <SignOut />
            </div>
          </div>
        </PullToRefresh>
      </div>

      {/* Primary action, under the thumb -------------------------------- */}
      <div
        className="sticky z-10 -mx-4 bg-canvas px-4 pt-2 pb-3 lg:static lg:mx-0 lg:px-0 lg:pb-0"
        style={{ bottom: TABBAR, minHeight: ACTION_H }}
      >
        <Link
          href="/setup"
          className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent font-medium text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:h-11 lg:w-fit lg:rounded-xl lg:px-6"
        >
          <IconPlus size={20} stroke={2} aria-hidden />
          Add account
        </Link>
      </div>
    </div>
  );
}

/**
 * Rates are entered by hand and dated — there is no rate API and no FX gain or
 * loss accounting. Every conversion on every screen uses the latest one.
 */
function RateCard() {
  const snapshot = useSnapshot();
  const current = snapshot.rates.get("USD");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function save() {
    const scaled = parseRate(value);
    if (scaled === null) {
      setError("Enter a rate greater than zero");
      return;
    }
    await upsertRate("USD", today(), scaled);
    setValue("");
    setError(null);
    setOpen(false);
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">PKR per USD</p>
          <p className="text-xs text-muted">
            {current ? `${formatRate(current)}, used for all conversions` : "not set yet"}
          </p>
        </div>
        {!open && (
          <Button type="button" onClick={() => setOpen(true)}>
            Update
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          <Input
            autoFocus
            inputMode="decimal"
            placeholder="278.50"
            className="bg-raised"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <ErrorNote>{error}</ErrorNote>
          <div className="flex gap-2">
            <Button type="button" variant="primary" onClick={save} className="flex-1">
              Save rate
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * The only account-level control in the app. There is no settings page, but
 * signing out has to be reachable from somewhere, and this is the page that is
 * already about the account rather than about the ledger.
 */
function SignOut() {
  const { email, signOut, pending, online } = useApp();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="pt-4 text-center">
      <p className="text-xs text-muted">{email}</p>
      {confirming ? (
        <div className="mt-2 space-y-2">
          {pending > 0 && (
            <p className="text-xs text-danger">
              {pending} change{pending === 1 ? "" : "s"} still waiting to sync.
              {online
                ? " They will be sent before signing out."
                : " You are offline, so signing out now discards them."}
            </p>
          )}
          <div className="flex justify-center gap-2">
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await signOut();
              }}
            >
              {busy ? "Signing out…" : "Sign out"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="mt-1 min-h-11 px-3 text-muted underline">
          Sign out
        </button>
      )}
    </div>
  );
}
