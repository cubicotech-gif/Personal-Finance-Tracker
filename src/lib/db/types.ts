import type { Currency } from "@/lib/money";
import type { IsoDate } from "@/lib/dates";

/**
 * Row shapes as they exist on the wire and in IndexedDB.
 *
 * Money fields are `string` here on purpose — they are minor-unit integers that
 * must survive JSON and structured-clone without ever becoming a float. Call
 * `minor()` at the point of use to get a bigint; nothing downstream of that
 * should ever see the string again.
 */

export type AccountType = "asset" | "liability" | "income" | "expense" | "equity";
export type CounterpartyKind = "person" | "float_client";
export type CategoryKind = "fixed" | "variable" | "goal";
export type PeriodType = "weekly" | "monthly";
export type BoxTransferKind = "reallocate" | "borrow";

interface Synced {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

interface SoftDeletable {
  deleted_at: string | null;
}

export interface AccountRow extends Synced, SoftDeletable {
  name: string;
  type: AccountType;
  currency: Currency;
  is_float: boolean;
  archived: boolean;
  sort_order: number;
}

export interface CounterpartyRow extends Synced, SoftDeletable {
  name: string;
  kind: CounterpartyKind;
  notes: string | null;
}

export interface CategoryRow extends Synced, SoftDeletable {
  name: string;
  kind: CategoryKind;
  target_minor: string;
  icon: string;
  sort_order: number;
  archived: boolean;
}

export interface TransactionRow extends Synced, SoftDeletable {
  booked_on: IsoDate;
  payee: string | null;
  note: string | null;
}

export interface EntryRow extends Synced {
  transaction_id: string;
  account_id: string;
  counterparty_id: string | null;
  category_id: string | null;
  amount_minor: string;
  due_on: IsoDate | null;
  position: number;
}

export interface RateRow extends Synced, SoftDeletable {
  currency: Currency;
  as_of: IsoDate;
  /** Decimal string, e.g. "278.50000000". Parsed with `parseRate`. */
  pkr_per_unit: string;
}

export interface PeriodRow extends Synced, SoftDeletable {
  start_date: IsoDate;
  type: PeriodType;
}

export interface AllocationRow extends Synced, SoftDeletable {
  period_id: string;
  category_id: string;
  amount_minor: string;
}

export interface BoxTransferRow extends Synced, SoftDeletable {
  from_category_id: string;
  to_category_id: string;
  amount_minor: string;
  kind: BoxTransferKind;
  created_on: IsoDate;
  repaid_at: IsoDate | null;
}

/** A draft entry as sent to the post_transaction RPC. */
export interface EntryInput {
  id?: string;
  account_id: string;
  counterparty_id?: string | null;
  category_id?: string | null;
  amount_minor: string;
  due_on?: IsoDate | null;
  position?: number;
}

/** Tables that participate in delta sync, in dependency order. */
export const SYNCED_TABLES = [
  "accounts",
  "counterparties",
  "categories",
  "transactions",
  "entries",
  "rates",
  "periods",
  "allocations",
  "box_transfers",
] as const;

export type SyncedTable = (typeof SYNCED_TABLES)[number];

/** Tables written with a plain upsert (everything except the ledger itself). */
export type UpsertableTable = Exclude<SyncedTable, "transactions" | "entries">;

export type OutboxOp =
  | {
      kind: "post_transaction";
      transaction: {
        id: string;
        booked_on: IsoDate;
        payee: string | null;
        note: string | null;
      };
      entries: EntryInput[];
    }
  | { kind: "delete_transaction"; id: string }
  | { kind: "restore_transaction"; id: string }
  | { kind: "upsert"; table: UpsertableTable; row: Record<string, unknown> };

export interface OutboxItem {
  seq?: number;
  op: OutboxOp;
  created_at: string;
  attempts: number;
  last_error: string | null;
}

export interface MetaRow {
  key: string;
  value: string;
}
