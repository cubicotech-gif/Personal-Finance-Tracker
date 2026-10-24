"use client";

import {
  postTransaction,
  upsertAccount,
  upsertCategory,
  upsertCounterparty,
  type EntryDraft,
} from "@/lib/db/mutations";
import type { AccountRow, AccountType, CounterpartyKind } from "@/lib/db/types";
import { type Minor, parseAmount } from "@/lib/money";
import { type IsoDate, isIsoDate, today } from "@/lib/dates";
import type { Snapshot } from "@/lib/ledger/snapshot";
import {
  CLIENT_FLOAT,
  OPENING_EQUITY,
  PAYABLES,
  RECEIVABLES,
  SORT,
} from "@/lib/ledger/system-accounts";

/**
 * The one-time baseline.
 *
 * Everything entered here becomes a single balanced transaction against an
 * opening-equity account. That is what makes "starting balances" an ordinary
 * ledger fact rather than a special case every later query has to remember.
 *
 * The structure is pre-filled because the names, the monthly targets and the
 * debts are already known and typing them again is twenty minutes of work with
 * nothing gained. The account balances are deliberately NOT pre-filled: they
 * change every day, and a stale figure silently poisons every number in the
 * app. They get typed once, from the banking apps, today.
 */

export interface MoneyRow {
  name: string;
  /** As typed, in rupees. Empty means "skip this row". */
  amount: string;
}

export interface BoxRow {
  name: string;
  icon: string;
  /** Monthly target, as typed, in rupees. */
  target: string;
}

export interface DebtRow extends MoneyRow {
  /**
   * True when they can ask for it any day — client float, or money that landed
   * by mistake. This is per debt, not per person: the same person can hold a
   * callable amount and a term loan at the same time, and the two must not be
   * added together.
   */
  callable: boolean;
  /** YYYY-MM-DD, or empty. */
  due: string;
  note: string;
  /** Someone whose money I hold rather than someone I borrowed from. */
  floatClient?: boolean;
}

export interface SetupInput {
  asOf: IsoDate;
  wallets: MoneyRow[];
  boxes: BoxRow[];
  owed: DebtRow[];
  owedToMe: DebtRow[];
}

/**
 * The starting point, from figures already worked through by hand.
 *
 * Amounts that do not change day to day are filled in. The wallet balances are
 * blank on purpose — see above.
 */
export function defaultSetup(): SetupInput {
  return {
    asOf: today(),
    wallets: [
      "Meezan 9857",
      "Meezan 1032",
      "Meezan Baba",
      "BankIslami",
      "Bank AL Habib",
      "Samba",
      "MCB",
      "JazzCash",
      "NayaPay",
      "Cash in hand",
    ].map((name) => ({ name, amount: "" })),

    boxes: [
      { name: "Groceries (Mother)", icon: "🛒", target: "50000" },
      { name: "Committee", icon: "🤝", target: "30000" },
      { name: "Electricity", icon: "💡", target: "20000" },
      { name: "Room rent", icon: "🏠", target: "15000" },
      { name: "Bike petrol & repairs", icon: "🛵", target: "12000" },
      { name: "Wife's pocket money", icon: "💗", target: "10000" },
      { name: "Miscellaneous", icon: "📦", target: "10000" },
      { name: "Food outside", icon: "🍔", target: "6500" },
      { name: "Mobile (family)", icon: "📱", target: "3000" },
    ],

    owed: [
      {
        name: "Freelancers",
        amount: "828000",
        callable: true,
        floatClient: true,
        due: "",
        note: "Client money already spent",
      },
      {
        /*
          A separate name from the gold loan on purpose.

          These are two unrelated obligations that happen to involve the same
          person: one can be demanded tomorrow, the other has a date in
          December. A note belongs to a person, not to a debt, so filing both
          under "Danish" would put one debt's explanation on the other's card.
        */
        name: "Danish (mistaken payment)",
        amount: "354900",
        callable: true,
        due: "",
        note: "Landed by mistake, must go back",
      },
      { name: "Danish", amount: "723000", callable: false, due: "2026-12-30", note: "Gold loan" },
      { name: "Committee", amount: "60000", callable: false, due: "", note: "Nov–Dec, then it ends" },
      { name: "Shopkeepers", amount: "21300", callable: false, due: "", note: "Old trade debt" },
      { name: "Rafay", amount: "300000", callable: false, due: "", note: "Offsets what he owes you" },
    ],

    owedToMe: [
      { name: "Rafay", amount: "600600", callable: false, due: "", note: "You owe him 3,00,000 back" },
      { name: "Saud", amount: "584570", callable: false, due: "", note: "" },
      { name: "Arshad", amount: "100000", callable: false, due: "", note: "" },
      { name: "Uncles", amount: "3800", callable: false, due: "", note: "" },
    ],
  };
}

// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------

const filled = (rows: MoneyRow[]) => rows.filter((row) => row.name.trim() !== "" && row.amount.trim() !== "");

export function validateSetup(input: SetupInput): string[] {
  const errors: string[] = [];

  if (!isIsoDate(input.asOf)) errors.push("The as-of date must be a real YYYY-MM-DD date.");

  const named = input.wallets.filter((row) => row.name.trim() !== "");
  if (named.length === 0) errors.push("Add at least one account.");

  const seen = new Set<string>();
  for (const row of named) {
    const key = row.name.trim().toLowerCase();
    if (seen.has(key)) errors.push(`Two accounts are both called "${row.name.trim()}".`);
    seen.add(key);
    if (row.amount.trim() !== "" && parseAmount(row.amount, "PKR") === null) {
      errors.push(`"${row.name.trim()}" has a balance that is not a number: "${row.amount}".`);
    }
  }

  for (const row of input.boxes) {
    if (row.name.trim() === "") continue;
    if (row.target.trim() !== "" && parseAmount(row.target, "PKR") === null) {
      errors.push(`"${row.name.trim()}" has a target that is not a number: "${row.target}".`);
    }
  }

  for (const row of [...input.owed, ...input.owedToMe]) {
    if (row.name.trim() === "" && row.amount.trim() === "") continue;
    if (row.name.trim() === "") {
      errors.push("A debt row has an amount but no name.");
      continue;
    }
    const amount = parseAmount(row.amount, "PKR");
    if (row.amount.trim() !== "" && (amount === null || amount <= 0n)) {
      errors.push(`"${row.name.trim()}" has an amount that is not a positive number: "${row.amount}".`);
    }
    if (row.due.trim() !== "" && !isIsoDate(row.due.trim())) {
      errors.push(`"${row.name.trim()}" has a due date that is not YYYY-MM-DD: "${row.due}".`);
    }
  }

  return errors;
}

// --------------------------------------------------------------------------
// Commit
// --------------------------------------------------------------------------

export async function commitSetup(input: SetupInput, snapshot: Snapshot): Promise<void> {
  const accountsByName = new Map<string, AccountRow>(
    snapshot.accounts.map((account) => [account.name.toLowerCase(), account]),
  );

  /** Create or reuse by name, so a second run tops up rather than duplicating. */
  async function ensureAccount(
    name: string,
    type: AccountType,
    isFloat = false,
    sortOrder = 0,
  ): Promise<string> {
    const existing = accountsByName.get(name.toLowerCase());
    const row = await upsertAccount({
      id: existing?.id,
      name,
      type,
      currency: "PKR",
      is_float: isFloat,
      sort_order: sortOrder,
    });
    accountsByName.set(name.toLowerCase(), row);
    return row.id;
  }

  const counterpartyIds = new Map<string, string>(
    snapshot.counterparties.map((cp) => [cp.name.toLowerCase(), cp.id]),
  );

  async function ensureCounterparty(
    name: string,
    kind: CounterpartyKind,
    notes: string,
  ): Promise<string> {
    const key = name.toLowerCase();
    const row = await upsertCounterparty({
      id: counterpartyIds.get(key),
      name,
      kind,
      notes: notes || null,
    });
    counterpartyIds.set(key, row.id);
    return row.id;
  }

  const entries: EntryDraft[] = [];

  // --- the accounts, and what is in them -----------------------------------
  for (const [index, row] of input.wallets.entries()) {
    const name = row.name.trim();
    if (name === "") continue;

    const accountId = await ensureAccount(name, "asset", false, index);
    const amount = row.amount.trim() === "" ? 0n : (parseAmount(row.amount, "PKR") ?? 0n);
    if (amount !== 0n) entries.push({ account_id: accountId, amount_minor: amount });
  }

  // --- what I owe, and what is owed to me ----------------------------------
  for (const row of filled(input.owed)) {
    const debt = row as DebtRow;
    const amount = parseAmount(debt.amount, "PKR");
    if (amount === null || amount === 0n) continue;

    const counterpartyId = await ensureCounterparty(
      debt.name.trim(),
      debt.floatClient ? "float_client" : "person",
      debt.note,
    );

    // The bucket is the account. Callable money lands on the float-flagged
    // liability, which is what makes it show up as held-for-others and drives
    // the shortfall; a term loan lands on ordinary payables.
    const accountId = await ensureAccount(
      debt.callable ? CLIENT_FLOAT : PAYABLES,
      "liability",
      debt.callable,
      SORT.payables,
    );

    entries.push({
      account_id: accountId,
      counterparty_id: counterpartyId,
      amount_minor: -amount,
      due_on: debt.due.trim() === "" ? null : debt.due.trim(),
    });
  }

  for (const row of filled(input.owedToMe)) {
    const debt = row as DebtRow;
    const amount = parseAmount(debt.amount, "PKR");
    if (amount === null || amount === 0n) continue;

    const counterpartyId = await ensureCounterparty(debt.name.trim(), "person", debt.note);
    const accountId = await ensureAccount(RECEIVABLES, "asset", false, SORT.receivables);

    entries.push({
      account_id: accountId,
      counterparty_id: counterpartyId,
      amount_minor: amount,
      due_on: debt.due.trim() === "" ? null : debt.due.trim(),
    });
  }

  // --- the spending boxes --------------------------------------------------
  for (const [index, box] of input.boxes.entries()) {
    const name = box.name.trim();
    if (name === "") continue;

    const existing = snapshot.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    await upsertCategory({
      id: existing?.id,
      name,
      kind: "fixed",
      icon: box.icon,
      target_minor: parseAmount(box.target, "PKR") ?? 0n,
      sort_order: index,
    });
  }

  if (entries.length === 0) return;

  // --- the balancing equity leg -------------------------------------------
  // Everything above is PKR, so one leg closes the whole transaction. The
  // trigger checks each currency separately; adding a currency here means
  // adding a leg per currency.
  const total = entries.reduce((sum, entry) => sum + entry.amount_minor, 0n);
  if (total !== 0n) {
    const equityId = await ensureAccount(OPENING_EQUITY, "equity", false, SORT.openingEquity);
    entries.push({ account_id: equityId, amount_minor: -total });
  }

  if (entries.length < 2) return;

  await postTransaction({
    booked_on: input.asOf || today(),
    payee: "Opening balances",
    entries,
  });
}

/** Totals for the summary line, so a wrong figure is visible before committing. */
export function previewTotals(input: SetupInput): {
  cash: Minor;
  callable: Minor;
  term: Minor;
  owedToMe: Minor;
  targets: Minor;
} {
  const add = (rows: MoneyRow[], pick: (row: MoneyRow) => string = (row) => row.amount) =>
    rows.reduce((sum, row) => sum + (parseAmount(pick(row), "PKR") ?? 0n), 0n);

  return {
    cash: add(input.wallets),
    callable: add(input.owed.filter((row) => row.callable)),
    term: add(input.owed.filter((row) => !row.callable)),
    owedToMe: add(input.owedToMe),
    targets: input.boxes.reduce((sum, box) => sum + (parseAmount(box.target, "PKR") ?? 0n), 0n),
  };
}
