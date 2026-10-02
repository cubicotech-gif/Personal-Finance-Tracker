import type { Minor } from "@/lib/money";
import { abs } from "@/lib/money";
import { type IsoDate, daysBetween, formatDay } from "@/lib/dates";
import { type Snapshot, entryAmount, pkr } from "./snapshot";
import type { DebtDirection } from "./people";

/**
 * Presentation helpers for /people: how old a debt looks, how long until it is
 * due, and a person's history. None of this changes how a debt is computed.
 */

export type AgeTone = "calm" | "warn" | "alert";

/** Grey under 30 days, amber 30 to 90, red beyond. */
export function ageTone(days: number | null): AgeTone {
  if (days === null || days < 30) return "calm";
  return days <= 90 ? "warn" : "alert";
}

export interface DueCountdown {
  text: string;
  overdue: boolean;
}

const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** "90 days to 30 Dec", "Due today", "5 days overdue". */
export function dueCountdown(dueOn: IsoDate, now: IsoDate): DueCountdown {
  const days = daysBetween(now, dueOn);
  if (days > 0) return { text: `${plural(days)} to ${formatDay(dueOn)}`, overdue: false };
  if (days === 0) return { text: "Due today", overdue: false };
  return { text: `${plural(-days)} overdue`, overdue: true };
}

export interface HistoryRow {
  transactionId: string;
  on: IsoDate;
  label: string;
  /** Always positive. */
  amountPkr: Minor;
  /** An advance grows the debt; a repayment shrinks it. */
  kind: "advance" | "repayment";
}

/**
 * Every line that moved this person's balance, newest first. A line grows the
 * debt when it points the same way as the debt itself (a receivable going up
 * when they owe me, a payable going up when I owe them) and shrinks it
 * otherwise.
 */
export function counterpartyHistory(
  snapshot: Snapshot,
  counterpartyId: string,
  direction: DebtDirection,
): HistoryRow[] {
  const rows: (HistoryRow & { createdAt: string })[] = [];

  for (const entry of snapshot.entries) {
    if (entry.counterparty_id !== counterpartyId) continue;
    const account = snapshot.accountsById.get(entry.account_id);
    if (account?.type !== "asset" && account?.type !== "liability") continue;
    const transaction = snapshot.transactionsById.get(entry.transaction_id);
    if (!transaction) continue;

    const value = pkr(snapshot, entryAmount(entry), account.currency);
    if (value === 0n) continue;
    const grows = direction === "owes_me" ? value > 0n : value < 0n;

    rows.push({
      transactionId: transaction.id,
      on: transaction.booked_on,
      label:
        transaction.payee ||
        transaction.note ||
        (grows ? (direction === "owes_me" ? "Lent" : "Borrowed") : "Repayment"),
      amountPkr: abs(value),
      kind: grows ? "advance" : "repayment",
      createdAt: entry.created_at,
    });
  }

  return rows
    .sort((a, b) => b.on.localeCompare(a.on) || b.createdAt.localeCompare(a.createdAt))
    .map(({ createdAt: _createdAt, ...row }) => row);
}
