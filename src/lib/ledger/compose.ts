"use client";

import { db } from "@/lib/db/dexie";
import { upsertAccount, type EntryDraft } from "@/lib/db/mutations";
import type { AccountRow, AccountType } from "@/lib/db/types";
import type { Currency, Minor } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";
import type { Snapshot } from "./snapshot";
import { entryAmount } from "./snapshot";
import {
  CLIENT_FLOAT,
  EXPENSES,
  FLOAT_RECEIVABLE,
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
export type MoneyKind =
  | "expense"
  | "income"
  | "lend"
  | "borrow"
  | "repay_debt"
  | "receive_repayment"
  | "transfer";

/** Out of an account, into one, or between two of my own. */
export type Direction = "in" | "out" | "move";

export interface LogDraft {
  bookedOn: IsoDate;
  direction: Direction;
  kind: MoneyKind;
  /** Positive. Direction and kind decide the signs. */
  amount: Minor;
  accountId: string;
  /** Where a transfer lands. Ignored by every other kind. */
  toAccountId?: string | null;
  categoryId?: string | null;
  counterpartyId?: string | null;
  /**
   * Settle against this exact receivable/payable account.
   *
   * One person can owe in two buckets at once — a term loan and a payment that
   * landed by mistake and is callable — so "who" does not say which debt is
   * being paid. When the screen knows the debt, it names the account and the
   * repayment lands on the right one; without this, deriving the account from
   * the counterparty would quietly credit the wrong bucket and the callable
   * figure, the one that matters, would never come down.
   */
  debtAccountId?: string | null;
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
  isFloat = false,
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

  const created = await upsertAccount({
    name: wanted,
    type,
    currency,
    sort_order: sortOrder,
    is_float: isFloat,
  });
  return created.id;
}

/**
 * Which account a debt belongs on.
 *
 * Money owed to a float client is not an ordinary payable — it is money being
 * held for someone else, so it has to land on the float-flagged account or it
 * never reaches "held for others" and the float shortfall silently understates
 * how much of other people's money has been spent. Setup already routes this
 * way; everyday logging has to agree with it or the two disagree over time.
 */
function debtAccount(
  snapshot: Snapshot,
  counterpartyId: string,
  owedToMe: boolean,
): { name: string; type: AccountType; sort: number; isFloat: boolean } {
  const isFloatClient =
    snapshot.counterpartiesById.get(counterpartyId)?.kind === "float_client";

  if (owedToMe) {
    return isFloatClient
      ? { name: FLOAT_RECEIVABLE, type: "asset", sort: SORT.receivables, isFloat: true }
      : { name: RECEIVABLES, type: "asset", sort: SORT.receivables, isFloat: false };
  }
  return isFloatClient
    ? { name: CLIENT_FLOAT, type: "liability", sort: SORT.payables, isFloat: true }
    : { name: PAYABLES, type: "liability", sort: SORT.payables, isFloat: false };
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

  /*
    Moving money between my own accounts is not income and not an expense —
    nothing has been earned or consumed, it is in a different pocket. Both legs
    are real accounts, so it touches no category and no counterparty, and it
    leaves every spending figure alone. Recording it as an expense out of one
    account and income into another, which is what people do when an app has no
    transfer, inflates both sides of the month by the amount moved.
  */
  if (draft.kind === "transfer") {
    const to = draft.toAccountId ? snapshot.accountsById.get(draft.toAccountId) : undefined;
    if (!to) throw new Error("Pick an account to move to");
    if (to.id === account.id) throw new Error("Pick two different accounts");
    if (to.currency !== currency) {
      // The trigger balances per currency, so a cross-currency move needs a
      // rate and four legs. Until there is a screen for that, refuse clearly
      // rather than writing something that cannot balance.
      throw new Error(`Moving ${currency} to ${to.currency} is not supported yet`);
    }
    return [
      { account_id: account.id, amount_minor: -draft.amount, counterparty_id: null, category_id: null },
      { account_id: to.id, amount_minor: draft.amount, counterparty_id: null, category_id: null },
    ];
  }

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

    case "lend": {
      // Money out that I expect back: it stays an asset, just a different one.
      contraCounterparty = requireCounterparty(draft);
      const target = debtAccount(snapshot, contraCounterparty, true);
      contraId = await ensure(snapshot, target.name, target.type, currency, target.sort, target.isFloat);
      dueOn = draft.dueOn ?? null;
      break;
    }

    case "borrow": {
      contraCounterparty = requireCounterparty(draft);
      const target = debtAccount(snapshot, contraCounterparty, false);
      contraId = await ensure(snapshot, target.name, target.type, currency, target.sort, target.isFloat);
      dueOn = draft.dueOn ?? null;
      break;
    }

    case "repay_debt": {
      // Paying down what I owe: the liability shrinks, no expense is incurred.
      contraCounterparty = requireCounterparty(draft);
      contraId = await settlementAccount(snapshot, draft, contraCounterparty, false, currency);
      break;
    }

    case "receive_repayment": {
      contraCounterparty = requireCounterparty(draft);
      contraId = await settlementAccount(snapshot, draft, contraCounterparty, true, currency);
      break;
    }
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

/**
 * The account a settlement lands on: the one the screen named, or the bucket
 * the counterparty's kind implies.
 */
async function settlementAccount(
  snapshot: Snapshot,
  draft: LogDraft,
  counterpartyId: string,
  owedToMe: boolean,
  currency: Currency,
): Promise<string> {
  const named = draft.debtAccountId ? snapshot.accountsById.get(draft.debtAccountId) : undefined;
  if (named) {
    // Settling a rupee debt out of a dollar account cannot balance, and the
    // trigger would reject it after the fact. Say so now.
    if (named.currency !== currency) {
      throw new Error(`That debt is in ${named.currency}, not ${currency}`);
    }
    return named.id;
  }

  const target = debtAccount(snapshot, counterpartyId, owedToMe);
  return ensure(snapshot, target.name, target.type, currency, target.sort, target.isFloat);
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
export function kindsFor(direction: Direction, hasCounterparty: boolean): MoneyKind[] {
  if (direction === "move") return ["transfer"];
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
  transfer: "Moved",
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
    if (base === RECEIVABLES.toLowerCase() || base === FLOAT_RECEIVABLE.toLowerCase()) return "receivable";
    if (base === PAYABLES.toLowerCase() || base === CLIENT_FLOAT.toLowerCase()) return "payable";
    return null;
  };

  // Two money accounts and nothing else is a transfer, whichever way round.
  if (
    (accountA.type === "asset" || accountA.type === "liability") &&
    (accountB.type === "asset" || accountB.type === "liability") &&
    !a.category_id &&
    !b.category_id &&
    !a.counterparty_id &&
    !b.counterparty_id
  ) {
    const from = entryAmount(a) < 0n ? a : b;
    const to = from === a ? b : a;
    return {
      bookedOn: transaction.booked_on,
      direction: "move",
      kind: "transfer",
      amount: entryAmount(to),
      accountId: from.account_id,
      toAccountId: to.account_id,
      categoryId: null,
      counterpartyId: null,
      incomeAccountId: null,
      payee: transaction.payee,
      note: transaction.note,
      dueOn: null,
    };
  }

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
        !/^(receivables|payables|client float|float receivable)(\s|$)/i.test(account.name),
    )
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name));
}
