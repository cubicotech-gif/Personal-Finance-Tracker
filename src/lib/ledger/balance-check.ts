"use client";

import type { AccountRow } from "@/lib/db/types";
import type { Currency, Minor } from "@/lib/money";
import { type IsoDate, daysSince } from "@/lib/dates";
import type { Snapshot } from "./snapshot";
import { accountBalances } from "./accounts";

/**
 * Keeping the app's idea of a balance honest against the real one.
 *
 * Balances drift: a bank charge, an auto-debit, a transfer made outside the
 * app. Nothing in the ledger can notice that on its own — only a person
 * looking at their bank can. So the app's job is to say when it last had its
 * figures confirmed, and to stop pretending a number is current when nobody
 * has checked it in weeks.
 */

/** Payee written on the transaction a reconcile posts. */
export const RECONCILE_PAYEE = "Reconcile";

/** Local meta key holding the last time an account was confirmed correct. */
export function checkedKey(accountId: string): string {
  return `checked:${accountId}`;
}

export interface AccountCheck {
  account: AccountRow;
  /** What the app currently thinks, in the account's own currency. */
  balance: Minor;
  currency: Currency;
  lastCheckedOn: IsoDate | null;
  /** Null when it has never been checked. */
  daysSinceCheck: number | null;
  stale: boolean;
}

/**
 * When each account was last confirmed.
 *
 * Two sources, because neither is enough alone. A reconcile that found a
 * difference leaves a transaction, which syncs and survives a new device. A
 * reconcile that found nothing wrong posts nothing at all — and "I checked and
 * it was right" is the most common outcome and the one most worth recording —
 * so that case is kept in local meta. The later of the two wins.
 */
export function buildBalanceChecks(
  snapshot: Snapshot,
  checkedLocally: Map<string, IsoDate>,
  staleAfterDays = 7,
): AccountCheck[] {
  const fromLedger = new Map<string, IsoDate>();

  for (const transaction of snapshot.transactions) {
    if (transaction.payee !== RECONCILE_PAYEE) continue;
    for (const entry of snapshot.entriesByTransaction.get(transaction.id) ?? []) {
      const previous = fromLedger.get(entry.account_id);
      if (!previous || transaction.booked_on > previous) {
        fromLedger.set(entry.account_id, transaction.booked_on);
      }
    }
  }

  return accountBalances(snapshot)
    .filter(
      ({ account, isReceivable }) =>
        account.type === "asset" && !account.archived && !isReceivable,
    )
    .map(({ account, native, currency }) => {
      const ledger = fromLedger.get(account.id) ?? null;
      const local = checkedLocally.get(account.id) ?? null;
      const lastCheckedOn =
        ledger && local ? (ledger > local ? ledger : local) : (ledger ?? local);
      const days = lastCheckedOn === null ? null : daysSince(lastCheckedOn);

      return {
        account,
        balance: native,
        currency,
        lastCheckedOn,
        daysSinceCheck: days,
        stale: days === null || days >= staleAfterDays,
      };
    })
    .sort((a, b) => {
      // Never checked is the most overdue thing there is, so it leads.
      if (a.daysSinceCheck === null && b.daysSinceCheck !== null) return -1;
      if (b.daysSinceCheck === null && a.daysSinceCheck !== null) return 1;
      return (b.daysSinceCheck ?? 0) - (a.daysSinceCheck ?? 0);
    });
}

export function staleCount(checks: AccountCheck[]): number {
  return checks.filter((check) => check.stale).length;
}
