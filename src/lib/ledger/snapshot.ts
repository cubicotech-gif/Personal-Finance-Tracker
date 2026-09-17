"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/dexie";
import type {
  AccountRow,
  AllocationRow,
  BoxTransferRow,
  CategoryRow,
  CounterpartyRow,
  EntryRow,
  PeriodRow,
  RateRow,
  TransactionRow,
} from "@/lib/db/types";
import { type Currency, type Minor, minor, parseRate, toPkr } from "@/lib/money";

/**
 * One in-memory snapshot of the ledger, rebuilt by Dexie whenever anything it
 * reads changes. Every page derives from this, so all four screens are always
 * looking at exactly the same numbers.
 *
 * Loading the whole ledger into memory is the right call at this size: one
 * person's transactions over years is tens of thousands of rows at most, and
 * it buys instant recomputation with no query round-trips — which is what makes
 * /log feel immediate.
 */
export interface Snapshot {
  ready: boolean;
  accounts: AccountRow[];
  accountsById: Map<string, AccountRow>;
  counterparties: CounterpartyRow[];
  counterpartiesById: Map<string, CounterpartyRow>;
  categories: CategoryRow[];
  categoriesById: Map<string, CategoryRow>;
  /** Live transactions only — soft-deleted ones are gone from every view. */
  transactions: TransactionRow[];
  transactionsById: Map<string, TransactionRow>;
  /** Entries belonging to live transactions only. */
  entries: EntryRow[];
  entriesByTransaction: Map<string, EntryRow[]>;
  /** Latest manually entered rate per currency, scaled by 1e8. */
  rates: Map<Currency, bigint>;

  // The budget allocation layer. These never touch a balance or net worth —
  // they are a second dimension sitting on top of the ledger, not part of it.
  periods: PeriodRow[];
  allocations: AllocationRow[];
  boxTransfers: BoxTransferRow[];
}

export const EMPTY_SNAPSHOT: Snapshot = {
  ready: false,
  accounts: [],
  accountsById: new Map(),
  counterparties: [],
  counterpartiesById: new Map(),
  categories: [],
  categoriesById: new Map(),
  transactions: [],
  transactionsById: new Map(),
  entries: [],
  entriesByTransaction: new Map(),
  rates: new Map(),
  periods: [],
  allocations: [],
  boxTransfers: [],
};

function live<T extends { deleted_at: string | null }>(rows: T[]): T[] {
  return rows.filter((row) => row.deleted_at === null);
}

function index<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

function latestRates(rows: RateRow[]): Map<Currency, bigint> {
  const newest = new Map<Currency, RateRow>();
  for (const row of live(rows)) {
    const current = newest.get(row.currency);
    if (!current || row.as_of > current.as_of) newest.set(row.currency, row);
  }
  const rates = new Map<Currency, bigint>();
  for (const [currency, row] of newest) {
    const scaled = parseRate(row.pkr_per_unit);
    if (scaled !== null) rates.set(currency, scaled);
  }
  return rates;
}

/**
 * Everything the snapshot is built from. An object rather than a positional
 * list: there are nine same-shaped array arguments, and getting two of them the
 * wrong way round would typecheck and silently produce wrong numbers.
 */
export interface SnapshotInput {
  accounts?: AccountRow[];
  counterparties?: CounterpartyRow[];
  categories?: CategoryRow[];
  transactions?: TransactionRow[];
  entries?: EntryRow[];
  rates?: RateRow[];
  periods?: PeriodRow[];
  allocations?: AllocationRow[];
  boxTransfers?: BoxTransferRow[];
}

/** Exported so the read model can be exercised without IndexedDB. */
export function buildSnapshot({
  accounts = [],
  counterparties = [],
  categories = [],
  transactions = [],
  entries = [],
  rates = [],
  periods = [],
  allocations = [],
  boxTransfers = [],
}: SnapshotInput): Snapshot {
  const liveAccounts = live(accounts).sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );
  const liveCategories = live(categories).sort(
    (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );
  const liveCounterparties = live(counterparties).sort((a, b) => a.name.localeCompare(b.name));

  const liveTransactions = live(transactions).sort(
    (a, b) =>
      b.booked_on.localeCompare(a.booked_on) || b.created_at.localeCompare(a.created_at),
  );
  const transactionsById = index(liveTransactions);

  // Entries whose transaction is deleted must not reach any balance.
  const liveEntries = entries.filter((entry) => transactionsById.has(entry.transaction_id));
  const entriesByTransaction = new Map<string, EntryRow[]>();
  for (const entry of liveEntries) {
    const bucket = entriesByTransaction.get(entry.transaction_id);
    if (bucket) bucket.push(entry);
    else entriesByTransaction.set(entry.transaction_id, [entry]);
  }
  for (const bucket of entriesByTransaction.values()) {
    bucket.sort((a, b) => a.position - b.position);
  }

  return {
    ready: true,
    accounts: liveAccounts,
    accountsById: index(liveAccounts),
    counterparties: liveCounterparties,
    counterpartiesById: index(liveCounterparties),
    categories: liveCategories,
    categoriesById: index(liveCategories),
    transactions: liveTransactions,
    transactionsById,
    entries: liveEntries,
    entriesByTransaction,
    rates: latestRates(rates),
    periods: live(periods).sort((a, b) => a.start_date.localeCompare(b.start_date)),
    allocations: live(allocations),
    boxTransfers: live(boxTransfers),
  };
}

export function useSnapshot(): Snapshot {
  return (
    useLiveQuery(async () => {
      const [accounts, counterparties, categories, transactions, entries, rates, periods, allocations, boxTransfers] =
        await Promise.all([
          db.accounts.toArray(),
          db.counterparties.toArray(),
          db.categories.toArray(),
          db.transactions.toArray(),
          db.entries.toArray(),
          db.rates.toArray(),
          db.periods.toArray(),
          db.allocations.toArray(),
          db.box_transfers.toArray(),
        ]);
      return buildSnapshot({
        accounts,
        counterparties,
        categories,
        transactions,
        entries,
        rates,
        periods,
        allocations,
        boxTransfers,
      });
    }, []) ?? EMPTY_SNAPSHOT
  );
}

/**
 * Convert to PKR using the latest rate.
 *
 * When no rate has been entered yet the native amount is passed through rather
 * than throwing, and `rateMissing` says so, so a USD account still renders
 * something truthful instead of blanking the page.
 */
export function pkr(snapshot: Snapshot, amount: Minor, currency: Currency): Minor {
  const rate = snapshot.rates.get(currency);
  if (currency === "PKR") return amount;
  if (rate === undefined) return amount;
  return toPkr(amount, currency, rate);
}

export function rateMissing(snapshot: Snapshot, currency: Currency): boolean {
  return currency !== "PKR" && !snapshot.rates.has(currency);
}

export function entryAmount(entry: EntryRow): Minor {
  return minor(entry.amount_minor);
}
