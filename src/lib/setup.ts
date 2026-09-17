"use client";

import {
  postTransaction,
  upsertAccount,
  upsertCategory,
  upsertCounterparty,
  upsertRate,
  type EntryDraft,
} from "@/lib/db/mutations";
import type { AccountRow, AccountType, CategoryKind, CounterpartyKind } from "@/lib/db/types";
import { type Currency, type Minor, parseAmount, parseRate } from "@/lib/money";
import { type IsoDate, isIsoDate, today } from "@/lib/dates";
import type { Snapshot } from "@/lib/ledger/snapshot";
import { matchOption, parseBoolean } from "@/lib/paste";
import {
  CLIENT_FLOAT,
  FLOAT_RECEIVABLE,
  OPENING_EQUITY,
  PAYABLES,
  RECEIVABLES,
  SORT,
  forCurrency,
} from "@/lib/ledger/system-accounts";

/**
 * One-time opening balances.
 *
 * Everything the user types here becomes a single balanced transaction against
 * an opening-equity account, which is what makes "starting balances" an
 * ordinary ledger fact rather than a special case that every later query has to
 * remember to include.
 */


export const ACCOUNT_TYPES: readonly AccountType[] = ["asset", "liability", "income", "expense", "equity"];

/** Eight, and no more — the spec caps this and an envelope list grows weeds. */
const DEFAULT_CATEGORIES: { name: string; kind: CategoryKind; icon: string }[] = [
  { name: "Rent", kind: "fixed", icon: "🏠" },
  { name: "Utilities", kind: "fixed", icon: "💡" },
  { name: "Groceries", kind: "variable", icon: "🛒" },
  { name: "Transport", kind: "variable", icon: "🛵" },
  { name: "Eating out", kind: "variable", icon: "🍽" },
  { name: "Health", kind: "variable", icon: "💊" },
  { name: "Family", kind: "variable", icon: "👪" },
  { name: "Savings", kind: "goal", icon: "🎯" },
];

export interface AccountDraftRow {
  name: string;
  type: string;
  currency: string;
  isFloat: boolean;
  opening: string;
}

export interface CounterpartyDraftRow {
  name: string;
  kind: string;
  notes: string;
}

export interface DebtDraftRow {
  name: string;
  direction: string;
  amount: string;
  due: string;
}

export const blankAccount = (): AccountDraftRow => ({
  name: "",
  type: "asset",
  currency: "PKR",
  isFloat: false,
  opening: "",
});

export const blankCounterparty = (): CounterpartyDraftRow => ({ name: "", kind: "person", notes: "" });

export const blankDebt = (): DebtDraftRow => ({ name: "", direction: "owes_me", amount: "", due: "" });

// --------------------------------------------------------------------------
// Paste
// --------------------------------------------------------------------------

export function accountRowsFromPaste(rows: string[][]): AccountDraftRow[] {
  return rows.map((cells) => ({
    name: cells[0] ?? "",
    type: matchOption(cells[1], ACCOUNT_TYPES, { cash: "asset", bank: "asset", debt: "liability", loan: "liability" }) ?? "asset",
    currency: matchOption(cells[2], ["PKR", "USD"] as const, { rs: "PKR", "$": "USD" }) ?? "PKR",
    isFloat: parseBoolean(cells[3]),
    opening: cells[4] ?? "",
  }));
}

export function counterpartyRowsFromPaste(rows: string[][]): CounterpartyDraftRow[] {
  return rows.map((cells) => ({
    name: cells[0] ?? "",
    kind:
      matchOption(cells[1], ["person", "float_client"] as const, {
        client: "float_client",
        float: "float_client",
      }) ?? "person",
    notes: cells[2] ?? "",
  }));
}

export function debtRowsFromPaste(rows: string[][]): DebtDraftRow[] {
  return rows.map((cells) => ({
    name: cells[0] ?? "",
    direction:
      matchOption(cells[1], ["owes_me", "i_owe"] as const, {
        owesme: "owes_me",
        owes: "owes_me",
        in: "owes_me",
        receivable: "owes_me",
        iowe: "i_owe",
        out: "i_owe",
        payable: "i_owe",
      }) ?? "owes_me",
    amount: cells[2] ?? "",
    due: cells[3] ?? "",
  }));
}

// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------

export interface SetupInput {
  asOf: IsoDate;
  accounts: AccountDraftRow[];
  counterparties: CounterpartyDraftRow[];
  debts: DebtDraftRow[];
  usdRate: string;
}

export function validateSetup(input: SetupInput, snapshot: Snapshot): string[] {
  const errors: string[] = [];

  const accounts = input.accounts.filter((row) => row.name.trim() !== "");
  const counterparties = input.counterparties.filter((row) => row.name.trim() !== "");
  const debts = input.debts.filter((row) => row.name.trim() !== "" || row.amount.trim() !== "");

  if (!isIsoDate(input.asOf)) errors.push("As-of date must be a valid YYYY-MM-DD date.");
  if (accounts.length === 0) errors.push("Add at least one account.");

  const seen = new Set<string>();
  for (const row of accounts) {
    const key = row.name.trim().toLowerCase();
    if (seen.has(key)) errors.push(`Duplicate account name "${row.name.trim()}".`);
    seen.add(key);
    if (!ACCOUNT_TYPES.includes(row.type as AccountType)) {
      errors.push(`"${row.name}" has an unknown type "${row.type}".`);
    }
    if (row.currency !== "PKR" && row.currency !== "USD") {
      errors.push(`"${row.name}" has an unsupported currency "${row.currency}".`);
    }
    if (row.opening.trim() !== "" && parseAmount(row.opening, row.currency as Currency) === null) {
      errors.push(`"${row.name}" has an opening balance that is not a number: "${row.opening}".`);
    }
  }

  const cpSeen = new Set<string>();
  for (const row of counterparties) {
    const key = row.name.trim().toLowerCase();
    if (cpSeen.has(key)) errors.push(`Duplicate person "${row.name.trim()}".`);
    cpSeen.add(key);
  }

  const knownNames = new Set([
    ...cpSeen,
    ...snapshot.counterparties.map((cp) => cp.name.toLowerCase()),
  ]);

  for (const row of debts) {
    const name = row.name.trim();
    if (name === "") {
      errors.push("A debt row has an amount but no name.");
      continue;
    }
    if (!knownNames.has(name.toLowerCase())) {
      errors.push(`Debt row refers to "${name}", who is not in the people list.`);
    }
    const amount = parseAmount(row.amount, "PKR");
    if (amount === null || amount <= 0n) {
      errors.push(`"${name}" has an opening debt that is not a positive number: "${row.amount}".`);
    }
    if (row.due.trim() !== "" && !isIsoDate(row.due.trim())) {
      errors.push(`"${name}" has a due date that is not YYYY-MM-DD: "${row.due}".`);
    }
  }

  const usesUsd = accounts.some((row) => row.currency === "USD");
  if (usesUsd && parseRate(input.usdRate) === null) {
    errors.push("A USD account needs a PKR-per-USD rate.");
  }

  return errors;
}

// --------------------------------------------------------------------------
// Commit
// --------------------------------------------------------------------------

export async function commitSetup(input: SetupInput, snapshot: Snapshot): Promise<void> {
  const byName = new Map<string, AccountRow>(
    snapshot.accounts.map((account) => [account.name.toLowerCase(), account]),
  );

  /** Create-or-reuse by name, so re-running setup tops up rather than duplicates. */
  async function ensureAccount(
    name: string,
    type: AccountType,
    currency: Currency,
    isFloat = false,
    sortOrder = 0,
  ): Promise<string> {
    const existing = byName.get(name.toLowerCase());
    const row = await upsertAccount({
      id: existing?.id,
      name,
      type,
      currency,
      is_float: isFloat,
      sort_order: sortOrder,
    });
    byName.set(name.toLowerCase(), row);
    return row.id;
  }

  const accountRows = input.accounts.filter((row) => row.name.trim() !== "");
  const counterpartyRows = input.counterparties.filter((row) => row.name.trim() !== "");
  const debtRows = input.debts.filter((row) => row.name.trim() !== "");

  if (input.usdRate.trim() !== "") {
    const scaled = parseRate(input.usdRate);
    if (scaled !== null) await upsertRate("USD", input.asOf, scaled);
  }

  // Expenses, Income and Expense:Unaccounted are created on first use by
  // composeEntries, in whatever currency is needed. Pre-creating them here only
  // produced empty accounts and cluttered the income-source picker.

  const openings: { accountId: string; currency: Currency; amount: Minor }[] = [];

  for (const [index, row] of accountRows.entries()) {
    const currency = row.currency as Currency;
    const type = row.type as AccountType;
    const id = await ensureAccount(row.name.trim(), type, currency, row.isFloat, index);

    const typed = row.opening.trim() === "" ? 0n : (parseAmount(row.opening, currency) ?? 0n);
    if (typed === 0n) continue;

    // Openings are entered the way a person thinks about them: how much is in
    // an asset, how much is owed on a liability. Convert to debit-positive here.
    const signed = type === "liability" || type === "income" || type === "equity" ? -typed : typed;
    openings.push({ accountId: id, currency, amount: signed });
  }

  const counterpartyIds = new Map<string, string>(
    snapshot.counterparties.map((cp) => [cp.name.toLowerCase(), cp.id]),
  );
  const counterpartyKinds = new Map<string, CounterpartyKind>(
    snapshot.counterparties.map((cp) => [cp.name.toLowerCase(), cp.kind]),
  );

  for (const row of counterpartyRows) {
    const key = row.name.trim().toLowerCase();
    const kind = row.kind as CounterpartyKind;
    const created = await upsertCounterparty({
      id: counterpartyIds.get(key),
      name: row.name.trim(),
      kind,
      notes: row.notes,
    });
    counterpartyIds.set(key, created.id);
    counterpartyKinds.set(key, kind);
  }

  const debtEntries: EntryDraft[] = [];

  for (const row of debtRows) {
    const key = row.name.trim().toLowerCase();
    const counterpartyId = counterpartyIds.get(key);
    const amount = parseAmount(row.amount, "PKR");
    if (!counterpartyId || amount === null || amount === 0n) continue;

    const isFloatClient = counterpartyKinds.get(key) === "float_client";
    const owesMe = row.direction === "owes_me";

    // Money owed to a float client is held-for-others, so it lands on a
    // float-flagged liability and shows up in the float numbers on /accounts.
    const accountName = owesMe
      ? isFloatClient
        ? FLOAT_RECEIVABLE
        : RECEIVABLES
      : isFloatClient
        ? CLIENT_FLOAT
        : PAYABLES;

    const accountId = await ensureAccount(
      accountName,
      owesMe ? "asset" : "liability",
      "PKR",
      isFloatClient,
      owesMe ? SORT.receivables : SORT.payables,
    );

    debtEntries.push({
      account_id: accountId,
      counterparty_id: counterpartyId,
      amount_minor: owesMe ? amount : -amount,
      due_on: row.due.trim() === "" ? null : row.due.trim(),
    });
  }

  for (const [index, category] of DEFAULT_CATEGORIES.entries()) {
    const existing = snapshot.categories.find(
      (c) => c.name.toLowerCase() === category.name.toLowerCase(),
    );
    await upsertCategory({
      id: existing?.id,
      name: category.name,
      kind: category.kind,
      icon: category.icon,
      sort_order: index,
    });
  }

  // Build the single opening transaction.
  const entries: EntryDraft[] = [
    ...openings.map(({ accountId, amount }) => ({ account_id: accountId, amount_minor: amount })),
    ...debtEntries,
  ];

  if (entries.length === 0) return;

  // One equity leg per currency: summing paisa and cents together would be
  // meaningless, and the balance trigger checks each currency separately.
  const perCurrency = new Map<Currency, Minor>();
  for (const opening of openings) {
    perCurrency.set(opening.currency, (perCurrency.get(opening.currency) ?? 0n) + opening.amount);
  }
  // Every debt account created above is PKR.
  const debtTotal = debtEntries.reduce((total, entry) => total + entry.amount_minor, 0n);
  if (debtTotal !== 0n) perCurrency.set("PKR", (perCurrency.get("PKR") ?? 0n) + debtTotal);

  for (const [currency, total] of perCurrency) {
    if (total === 0n) continue;
    const equityId = await ensureAccount(forCurrency(OPENING_EQUITY, currency), "equity", currency, false, SORT.openingEquity);
    entries.push({ account_id: equityId, amount_minor: -total });
  }

  if (entries.length < 2) return;

  await postTransaction({
    booked_on: input.asOf || today(),
    payee: "Opening balances",
    note: null,
    entries,
  });
}
