"use client";

import type { AccountRow, CategoryRow, CounterpartyRow, EntryRow, TransactionRow } from "@/lib/db/types";
import type { Currency, Minor } from "@/lib/money";
import { abs } from "@/lib/money";
import { type Snapshot, entryAmount, pkr } from "./snapshot";

/**
 * Collapsing a balanced transaction back into the one line a human recognises:
 * "Rs 450 out of Cash, Groceries".
 */

export type Direction = "in" | "out" | "transfer" | "split";

export interface LogRow {
  transaction: TransactionRow;
  direction: Direction;
  account: AccountRow | null;
  /** Positive; the direction carries the sign. In the account's own currency. */
  amount: Minor;
  currency: Currency;
  amountPkr: Minor;
  category: CategoryRow | null;
  counterparty: CounterpartyRow | null;
  entries: EntryRow[];
  /** How many lines the transaction has; > 2 means it is a split. */
  lineCount: number;
}

export function toLogRow(snapshot: Snapshot, transaction: TransactionRow): LogRow {
  const entries = snapshot.entriesByTransaction.get(transaction.id) ?? [];

  const moneyLegs = entries.filter((entry) => {
    const type = snapshot.accountsById.get(entry.account_id)?.type;
    return type === "asset" || type === "liability";
  });
  const categoryLegs = entries.filter((entry) => {
    const type = snapshot.accountsById.get(entry.account_id)?.type;
    return type === "income" || type === "expense";
  });

  let primary: EntryRow | undefined;
  let direction: Direction;

  if (moneyLegs.length === 1) {
    primary = moneyLegs[0];
    direction = entryAmount(primary as EntryRow) > 0n ? "in" : "out";
  } else if (entries.length === 2 && moneyLegs.length === 2) {
    // A transfer is exactly two money legs and nothing else. Requiring that the
    // whole transaction is those two legs matters: an opening balance across
    // one asset account and equity also has two "non-category" legs, and is not
    // a transfer.
    primary = moneyLegs.find((entry) => entryAmount(entry) < 0n) ?? moneyLegs[0];
    direction = "transfer";
  } else {
    primary = moneyLegs[0] ?? entries[0];
    direction = "split";
  }

  const split = direction === "split";
  const account = !split && primary ? (snapshot.accountsById.get(primary.account_id) ?? null) : null;
  const currency = account?.currency ?? "PKR";

  // A split has no single account, category or counterparty that describes it,
  // and its net is zero by construction. Showing the money that moved in one
  // direction is the only figure that means anything, so show that and say how
  // many lines it took — rather than picking an arbitrary leg and implying it
  // is the whole story.
  const native = split
    ? moneyLegs.reduce((total, entry) => {
        const amount = entryAmount(entry);
        return amount > 0n ? total + amount : total;
      }, 0n)
    : primary
      ? abs(entryAmount(primary))
      : 0n;

  const categoryId = split
    ? undefined
    : (categoryLegs.find((e) => e.category_id)?.category_id ?? entries.find((e) => e.category_id)?.category_id);
  const counterpartyId = split ? undefined : entries.find((e) => e.counterparty_id)?.counterparty_id;

  return {
    transaction,
    direction,
    account,
    amount: native,
    currency,
    amountPkr: pkr(snapshot, native, currency),
    category: categoryId ? (snapshot.categoriesById.get(categoryId) ?? null) : null,
    counterparty: counterpartyId ? (snapshot.counterpartiesById.get(counterpartyId) ?? null) : null,
    entries,
    lineCount: entries.length,
  };
}

/** Reverse-chronological; `snapshot.transactions` is already in that order. */
export function recentLogRows(snapshot: Snapshot, limit = 50): LogRow[] {
  return snapshot.transactions.slice(0, limit).map((transaction) => toLogRow(snapshot, transaction));
}

export function describe(row: LogRow): string {
  if (row.transaction.payee) return row.transaction.payee;
  if (row.direction === "split") return "Split";
  if (row.direction === "transfer") return "Transfer";
  if (row.category) return row.category.name;
  if (row.counterparty) return row.counterparty.name;
  return row.direction === "in" ? "Money in" : "Money out";
}
