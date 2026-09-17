"use client";

import { db } from "@/lib/db/dexie";
import { upsertAccount, type EntryDraft } from "@/lib/db/mutations";
import type { AccountRow, AccountType } from "@/lib/db/types";
import type { Currency, Minor } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";
import type { Snapshot } from "./snapshot";
import { entryAmount } from "./snapshot";
import {
  EXPENSES,
  INCOME,
  PAYABLES,
  RECEIVABLES,
  SORT,
  UNACCOUNTED,
  baseName,
  forCurrency,
} from "./system-accounts";

/**
 * Turning one line on /log into a balanced pair of entries.
 *
 * The key decision here: there is ONE `Expenses` account and ONE `Income`
 * account per currency, and the budget category rides on the entry as
 * `category_id`. Giving every envelope its own expense account would make the
 * envelope a ledger object, which is the double-counting trap the whole design
 * is arranged to avoid. Categorisation and accounting stay orthogonal.
 */


/** What the money actually did, beyond simply arriving or leaving. */
export type MoneyKind = "expense" | "income" | "lend" | "borrow" | "repay_debt" | "receive_repayment";

export interface LogDraft {
  bookedOn: IsoDate;
  direction: "in" | "out";
  kind: MoneyKind;
  /** Positive. Direction and kind decide the signs. */
  amount: Minor;
  accountId: string;
  categoryId?: string | null;
  counterpartyId?: string | null;
  incomeAccountId?: string | null;
  payee?: string | null;
  note?: string | null;
  dueOn?: IsoDate | null;
}

/**
 * Find a working account by name, creating it if this is the first time that
 * currency has been used. The write is local-first, so this costs an IndexedDB
 * put, not a round trip — /log stays instant.
 */
async function ensure(
  snapshot: Snapshot,
  name: string,
  type: AccountType,
  currency: Currency,
  sortOrder: number,
): Promise<string> {
  const wanted = forCurrency(name, currency);
  const lower = wanted.toLowerCase();

  const fromSnapshot = snapshot.accounts.find((account) => account.name.toLowerCase() === lower);
  if (fromSnapshot) return fromSnapshot.id;

  // The snapshot is a live query and lags a write by a tick, so two quick
  // submissions could both miss and create the account twice. Ask the database
  // before creating anything.
  const fromDb = await db.accounts.filter((account) => account.name.toLowerCase() === lower).first();
  if (fromDb) return fromDb.id;

  const created = await upsertAccount({ name: wanted, type, currency, sort_order: sortOrder });
  return created.id;
}

function accountOrThrow(snapshot: Snapshot, id: string): AccountRow {
  const account = snapshot.accountsById.get(id);
  if (!account) throw new Error("Pick an account");
  return account;
}

export async function composeEntries(snapshot: Snapshot, draft: LogDraft): Promise<EntryDraft[]> {
  if (draft.amount <= 0n) throw new Error("Enter an amount");

  const account = accountOrThrow(snapshot, draft.accountId);
  const currency = account.currency;
  const outflow = draft.direction === "out";
  // The money leg: leaving my account is a credit, arriving is a debit.
  const moneyLeg: EntryDraft = {
    account_id: account.id,
    amount_minor: outflow ? -draft.amount : draft.amount,
    counterparty_id: null,
    category_id: null,
  };

  let contraId: string;
  let contraCounterparty: string | null = null;
  let contraCategory: string | null = null;
  let dueOn: IsoDate | null = null;

  switch (draft.kind) {
    case "expense":
      contraId = await ensure(snapshot, EXPENSES, "expense", currency, SORT.expenses);
      contraCategory = draft.categoryId ?? null;
      break;

    case "income":
      // Income sources are real income accounts, because /boxes has to show
      // which source money arrived from this period.
      contraId =
        draft.incomeAccountId ?? (await ensure(snapshot, INCOME, "income", currency, SORT.income));
      break;

    case "lend":
      // Money out that I expect back: it stays an asset, just a different one.
      contraId = await ensure(snapshot, RECEIVABLES, "asset", currency, SORT.receivables);
      contraCounterparty = requireCounterparty(draft);
      dueOn = draft.dueOn ?? null;
      break;

    case "borrow":
      contraId = await ensure(snapshot, PAYABLES, "liability", currency, SORT.payables);
      contraCounterparty = requireCounterparty(draft);
      dueOn = draft.dueOn ?? null;
      break;

    case "repay_debt":
      // Paying down what I owe: the liability shrinks, no expense is incurred.
      contraId = await ensure(snapshot, PAYABLES, "liability", currency, SORT.payables);
      contraCounterparty = requireCounterparty(draft);
      break;

    case "receive_repayment":
      contraId = await ensure(snapshot, RECEIVABLES, "asset", currency, SORT.receivables);
      contraCounterparty = requireCounterparty(draft);
      break;
  }

  const contraLeg: EntryDraft = {
    account_id: contraId,
    amount_minor: -moneyLeg.amount_minor,
    counterparty_id: contraCounterparty,
    category_id: contraCategory,
    due_on: dueOn,
  };

  return [moneyLeg, contraLeg];
}

function requireCounterparty(draft: LogDraft): string {
  if (!draft.counterpartyId) throw new Error("Pick who this is with");
  return draft.counterpartyId;
}

/**
 * Reconcile: the user states how much cash is actually in hand and the
 * difference is booked to Expense:Unaccounted. Cash disappears in real life and
 * pretending otherwise silently corrupts every number downstream.
 */
export async function composeReconcile(
  snapshot: Snapshot,
  accountId: string,
  actual: Minor,
): Promise<{ entries: EntryDraft[]; delta: Minor } | null> {
  const account = accountOrThrow(snapshot, accountId);

  let balance = 0n;
  for (const entry of snapshot.entries) {
    if (entry.account_id === accountId) balance += entryAmount(entry);
  }

  const delta = actual - balance;
  if (delta === 0n) return null;

  const unaccountedId = await ensure(snapshot, UNACCOUNTED, "expense", account.currency, SORT.unaccounted);

  return {
    delta,
    entries: [
      { account_id: accountId, amount_minor: delta },
      { account_id: unaccountedId, amount_minor: -delta },
    ],
  };
}

/** The two special chips that appear on /log once a counterparty is picked. */
export function kindsFor(direction: "in" | "out", hasCounterparty: boolean): MoneyKind[] {
  if (direction === "out") {
    return hasCounterparty ? ["expense", "lend", "repay_debt"] : ["expense"];
  }
  return hasCounterparty ? ["income", "borrow", "receive_repayment"] : ["income"];
}

export const KIND_LABEL: Record<MoneyKind, string> = {
  expense: "Spent",
  income: "Received",
  lend: "Lent out",
  borrow: "Borrowed",
  repay_debt: "Paid them back",
  receive_repayment: "They paid back",
};

/**
 * The inverse of `composeEntries`, so tapping a recent row reopens it in the
 * same fast form rather than a separate edit screen.
 *
 * Returns null for anything the quick form cannot faithfully represent — a
 * split, a transfer, the opening-balances transaction. Those stay deletable but
 * are not silently flattened into something they are not.
 */
export function decompose(snapshot: Snapshot, transactionId: string): LogDraft | null {
  const entries = snapshot.entriesByTransaction.get(transactionId) ?? [];
  const transaction = snapshot.transactionsById.get(transactionId);
  if (!transaction || entries.length !== 2) return null;

  const [a, b] = entries;
  if (!a || !b) return null;

  const accountA = snapshot.accountsById.get(a.account_id);
  const accountB = snapshot.accountsById.get(b.account_id);
  if (!accountA || !accountB) return null;

  const classify = (name: string): "receivable" | "payable" | null => {
    const base = baseName(name);
    if (base === RECEIVABLES.toLowerCase()) return "receivable";
    if (base === PAYABLES.toLowerCase()) return "payable";
    return null;
  };

  const pairs: [typeof a, AccountRow, typeof b, AccountRow][] = [
    [a, accountA, b, accountB],
    [b, accountB, a, accountA],
  ];

  for (const [money, moneyAccount, contra, contraAccount] of pairs) {
    const amount = entryAmount(money);
    if (amount === 0n) continue;
    const direction = amount < 0n ? "out" : "in";
    const role = classify(contraAccount.name);

    let kind: MoneyKind | null = null;
    if (contraAccount.type === "expense" && baseName(contraAccount.name) === EXPENSES.toLowerCase()) {
      kind = direction === "out" ? "expense" : null;
    } else if (contraAccount.type === "income") {
      kind = direction === "in" ? "income" : null;
    } else if (role === "receivable" && contra.counterparty_id) {
      kind = direction === "out" ? "lend" : "receive_repayment";
    } else if (role === "payable" && contra.counterparty_id) {
      kind = direction === "in" ? "borrow" : "repay_debt";
    }

    if (!kind) continue;
    // The money leg must be somewhere real money sits.
    if (moneyAccount.type !== "asset" && moneyAccount.type !== "liability") continue;

    return {
      bookedOn: transaction.booked_on,
      direction,
      kind,
      amount: amount < 0n ? -amount : amount,
      accountId: moneyAccount.id,
      categoryId: contra.category_id,
      counterpartyId: contra.counterparty_id,
      incomeAccountId: kind === "income" ? contraAccount.id : null,
      payee: transaction.payee,
      note: transaction.note,
      dueOn: contra.due_on,
    };
  }

  return null;
}

/** Money accounts ordered by how often they are used — fastest tap first. */
export function accountsByUsage(snapshot: Snapshot): AccountRow[] {
  const counts = new Map<string, number>();
  for (const entry of snapshot.entries) {
    counts.set(entry.account_id, (counts.get(entry.account_id) ?? 0) + 1);
  }
  return snapshot.accounts
    .filter(
      (account) =>
        !account.archived &&
        (account.type === "asset" || account.type === "liability") &&
        // Receivables and payables are reached through a counterparty, not by
        // picking them as "the account the money came out of".
        !/^(receivables|payables)(\s|$)/i.test(account.name),
    )
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name));
}
