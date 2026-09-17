"use client";

import Dexie, { type EntityTable } from "dexie";
import type {
  AccountRow,
  AllocationRow,
  BoxTransferRow,
  CategoryRow,
  CounterpartyRow,
  EntryRow,
  MetaRow,
  OutboxItem,
  PeriodRow,
  RateRow,
  TransactionRow,
} from "./types";

/**
 * The local database is the source of truth the UI reads from. Every screen
 * renders from IndexedDB, never from a network response, so the app is fast and
 * identical online and offline. Supabase is a replica that the outbox pushes to
 * and the puller pulls from.
 *
 * Note that no index is declared on a money column. IndexedDB keys cannot be
 * BigInt, and indexing a minor-unit string sorts lexicographically, which is
 * wrong. Amounts are summed in memory instead — for a single user's ledger that
 * is thousands of rows, not millions.
 */
class LocalDb extends Dexie {
  accounts!: EntityTable<AccountRow, "id">;
  counterparties!: EntityTable<CounterpartyRow, "id">;
  categories!: EntityTable<CategoryRow, "id">;
  transactions!: EntityTable<TransactionRow, "id">;
  entries!: EntityTable<EntryRow, "id">;
  rates!: EntityTable<RateRow, "id">;
  periods!: EntityTable<PeriodRow, "id">;
  allocations!: EntityTable<AllocationRow, "id">;
  box_transfers!: EntityTable<BoxTransferRow, "id">;
  outbox!: EntityTable<OutboxItem, "seq">;
  meta!: EntityTable<MetaRow, "key">;

  constructor() {
    super("pft");
    this.version(1).stores({
      accounts: "id, updated_at, name, type, archived",
      counterparties: "id, updated_at, name, kind",
      categories: "id, updated_at, name, sort_order",
      transactions: "id, updated_at, booked_on, created_at",
      entries: "id, updated_at, transaction_id, account_id, counterparty_id, category_id",
      rates: "id, updated_at, currency, [currency+as_of]",
      periods: "id, updated_at, start_date, [type+start_date]",
      allocations: "id, updated_at, period_id, category_id, [period_id+category_id]",
      box_transfers: "id, updated_at, from_category_id, to_category_id",
      outbox: "++seq, created_at",
      meta: "key",
    });
  }
}

export const db = new LocalDb();

export async function getMeta(key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}

/**
 * Drop every replicated row but keep the outbox: used on sign-out, and when the
 * signed-in user changes, so one user's cache can never be read as another's.
 */
export async function clearReplica(): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.accounts,
      db.counterparties,
      db.categories,
      db.transactions,
      db.entries,
      db.rates,
      db.periods,
      db.allocations,
      db.box_transfers,
      db.meta,
    ],
    async () => {
      await Promise.all([
        db.accounts.clear(),
        db.counterparties.clear(),
        db.categories.clear(),
        db.transactions.clear(),
        db.entries.clear(),
        db.rates.clear(),
        db.periods.clear(),
        db.allocations.clear(),
        db.box_transfers.clear(),
        db.meta.clear(),
      ]);
    },
  );
}
