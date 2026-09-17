import type { Currency } from "@/lib/money";

/**
 * Accounts the app creates and relies on by name.
 *
 * They live in one place because two modules need them — setup writes opening
 * balances into them and compose posts everyday transactions against them — and
 * a name that drifted between the two would silently split a balance across two
 * accounts that look identical in the list.
 */
export const OPENING_EQUITY = "Equity:Opening";
export const UNACCOUNTED = "Expense:Unaccounted";
export const EXPENSES = "Expenses";
export const INCOME = "Income";
export const RECEIVABLES = "Receivables";
export const PAYABLES = "Payables";
export const CLIENT_FLOAT = "Client float";
export const FLOAT_RECEIVABLE = "Float receivable";

/** Sort keys that keep working accounts below the user's real ones. */
export const SORT = {
  receivables: 800,
  payables: 810,
  openingEquity: 900,
  unaccounted: 901,
  expenses: 902,
  income: 903,
} as const;

/**
 * One account per currency: an expense paid in dollars cannot balance against a
 * rupee-denominated Expenses account.
 */
export function forCurrency(name: string, currency: Currency): string {
  return currency === "PKR" ? name : `${name} (${currency})`;
}

/** Strip the currency suffix, to compare an account against a base name. */
export function baseName(name: string): string {
  return name.replace(/\s*\([A-Z]{3}\)$/, "").toLowerCase();
}
