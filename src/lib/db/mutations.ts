"use client";

import { db } from "./dexie";
import type {
  AccountRow,
  AccountType,
  AllocationRow,
  BoxTransferKind,
  BoxTransferRow,
  CategoryKind,
  CategoryRow,
  CounterpartyKind,
  CounterpartyRow,
  EntryInput,
  EntryRow,
  OutboxOp,
  PeriodRow,
  PeriodType,
  RateRow,
  TransactionRow,
  UpsertableTable,
} from "./types";
import { type Currency, type Minor, formatRate, minor, wire } from "@/lib/money";
import { type IsoDate, today } from "@/lib/dates";

/**
 * Every write lands in IndexedDB and in the outbox inside one Dexie
 * transaction. Either the user sees their change and it is queued for the
 * server, or neither happened. There is no state where the UI shows a
 * transaction that will never sync.
 *
 * IDs are generated on the client so an op is idempotent: replaying a queued
 * write after a flaky connection converges on the same row instead of creating
 * a second one.
 */

let currentUserId: string | null = null;

export function setCurrentUser(id: string | null): void {
  currentUserId = id;
}

function requireUser(): string {
  if (!currentUserId) throw new Error("Not signed in");
  return currentUserId;
}

export function newId(): string {
  return crypto.randomUUID();
}

function stamps(): { created_at: string; updated_at: string } {
  const now = new Date().toISOString();
  return { created_at: now, updated_at: now };
}

async function enqueue(op: OutboxOp): Promise<void> {
  await db.outbox.add({
    op,
    created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
  });
}

// --------------------------------------------------------------------------
// Ledger
// --------------------------------------------------------------------------

export interface EntryDraft {
  id?: string;
  account_id: string;
  counterparty_id?: string | null;
  category_id?: string | null;
  amount_minor: Minor;
  due_on?: IsoDate | null;
}

export interface TransactionDraft {
  id?: string;
  booked_on?: IsoDate;
  payee?: string | null;
  note?: string | null;
  entries: EntryDraft[];
}

/**
 * The same rule the Postgres trigger enforces, checked locally first.
 *
 * The database is still the authority — this exists so an unbalanced draft
 * fails immediately in the UI rather than sitting in the outbox and wedging the
 * queue the next time the device is online.
 */
export async function assertBalanced(entries: EntryDraft[]): Promise<void> {
  if (entries.length < 2) {
    throw new Error("A transaction needs at least 2 entries");
  }

  const accountIds = [...new Set(entries.map((e) => e.account_id))];
  const accounts = await db.accounts.bulkGet(accountIds);
  const currencyOf = new Map<string, Currency>();
  accounts.forEach((account, index) => {
    if (!account) throw new Error(`Unknown account ${accountIds[index]}`);
    currencyOf.set(account.id, account.currency);
  });

  const totals = new Map<Currency, Minor>();
  for (const entry of entries) {
    const currency = currencyOf.get(entry.account_id);
    if (!currency) throw new Error(`Unknown account ${entry.account_id}`);
    totals.set(currency, (totals.get(currency) ?? 0n) + entry.amount_minor);
  }

  for (const [currency, total] of totals) {
    if (total !== 0n) {
      throw new Error(`Entries do not balance in ${currency} (off by ${total})`);
    }
  }
}

export async function postTransaction(draft: TransactionDraft): Promise<string> {
  const user_id = requireUser();
  await assertBalanced(draft.entries);

  const id = draft.id ?? newId();
  const booked_on = draft.booked_on ?? today();
  const payee = draft.payee?.trim() || null;
  const note = draft.note?.trim() || null;
  const at = stamps();

  const entryRows: EntryRow[] = draft.entries.map((entry, position) => ({
    id: entry.id ?? newId(),
    user_id,
    transaction_id: id,
    account_id: entry.account_id,
    counterparty_id: entry.counterparty_id ?? null,
    category_id: entry.category_id ?? null,
    amount_minor: wire(entry.amount_minor),
    due_on: entry.due_on ?? null,
    position,
    ...at,
  }));

  const transactionRow: TransactionRow = {
    id,
    user_id,
    booked_on,
    payee,
    note,
    deleted_at: null,
    ...at,
  };

  const entryInputs: EntryInput[] = entryRows.map((row) => ({
    id: row.id,
    account_id: row.account_id,
    counterparty_id: row.counterparty_id,
    category_id: row.category_id,
    amount_minor: row.amount_minor,
    due_on: row.due_on,
    position: row.position,
  }));

  await db.transaction("rw", [db.transactions, db.entries, db.outbox], async () => {
    await db.transactions.put(transactionRow);
    // Editing replaces the entry set wholesale, exactly as the RPC does.
    await db.entries.where("transaction_id").equals(id).delete();
    await db.entries.bulkPut(entryRows);
    await enqueue({
      kind: "post_transaction",
      transaction: { id, booked_on, payee, note },
      entries: entryInputs,
    });
  });

  return id;
}

export async function deleteTransaction(id: string): Promise<void> {
  requireUser();
  await db.transaction("rw", [db.transactions, db.outbox], async () => {
    const existing = await db.transactions.get(id);
    if (!existing) return;
    await db.transactions.put({ ...existing, deleted_at: new Date().toISOString() });
    await enqueue({ kind: "delete_transaction", id });
  });
}

export async function restoreTransaction(id: string): Promise<void> {
  requireUser();
  await db.transaction("rw", [db.transactions, db.outbox], async () => {
    const existing = await db.transactions.get(id);
    if (!existing) return;
    await db.transactions.put({ ...existing, deleted_at: null });
    await enqueue({ kind: "restore_transaction", id });
  });
}

// --------------------------------------------------------------------------
// Reference data
// --------------------------------------------------------------------------

async function upsert<T extends { id: string }>(
  table: UpsertableTable,
  row: T,
  wireRow: Record<string, unknown>,
): Promise<T> {
  await db.transaction("rw", [db.table(table), db.outbox], async () => {
    await db.table(table).put(row);
    await enqueue({ kind: "upsert", table, row: wireRow });
  });
  return row;
}

export interface AccountDraft {
  id?: string;
  name: string;
  type: AccountType;
  currency?: Currency;
  is_float?: boolean;
  archived?: boolean;
  sort_order?: number;
}

export async function upsertAccount(draft: AccountDraft): Promise<AccountRow> {
  const user_id = requireUser();
  const id = draft.id ?? newId();
  const existing = draft.id ? await db.accounts.get(draft.id) : undefined;
  const row: AccountRow = {
    id,
    user_id,
    name: draft.name.trim(),
    type: draft.type,
    currency: draft.currency ?? existing?.currency ?? "PKR",
    is_float: draft.is_float ?? existing?.is_float ?? false,
    archived: draft.archived ?? existing?.archived ?? false,
    sort_order: draft.sort_order ?? existing?.sort_order ?? 0,
    deleted_at: null,
    created_at: existing?.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return upsert("accounts", row, {
    id: row.id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    is_float: row.is_float,
    archived: row.archived,
    sort_order: row.sort_order,
    deleted_at: null,
  });
}

export interface CounterpartyDraft {
  id?: string;
  name: string;
  kind?: CounterpartyKind;
  notes?: string | null;
}

export async function upsertCounterparty(draft: CounterpartyDraft): Promise<CounterpartyRow> {
  const user_id = requireUser();
  const id = draft.id ?? newId();
  const existing = draft.id ? await db.counterparties.get(draft.id) : undefined;
  const row: CounterpartyRow = {
    id,
    user_id,
    name: draft.name.trim(),
    kind: draft.kind ?? existing?.kind ?? "person",
    notes: draft.notes?.trim() || null,
    deleted_at: null,
    created_at: existing?.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return upsert("counterparties", row, {
    id: row.id,
    name: row.name,
    kind: row.kind,
    notes: row.notes,
    deleted_at: null,
  });
}

export interface CategoryDraft {
  id?: string;
  name: string;
  kind?: CategoryKind;
  target_minor?: Minor;
  icon?: string;
  sort_order?: number;
  archived?: boolean;
}

export async function upsertCategory(draft: CategoryDraft): Promise<CategoryRow> {
  const user_id = requireUser();
  const id = draft.id ?? newId();
  const existing = draft.id ? await db.categories.get(draft.id) : undefined;
  const row: CategoryRow = {
    id,
    user_id,
    name: draft.name.trim(),
    kind: draft.kind ?? existing?.kind ?? "variable",
    target_minor: draft.target_minor !== undefined ? wire(draft.target_minor) : (existing?.target_minor ?? "0"),
    icon: draft.icon ?? existing?.icon ?? "•",
    sort_order: draft.sort_order ?? existing?.sort_order ?? 0,
    archived: draft.archived ?? existing?.archived ?? false,
    deleted_at: null,
    created_at: existing?.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return upsert("categories", row, {
    id: row.id,
    name: row.name,
    kind: row.kind,
    target_minor: row.target_minor,
    icon: row.icon,
    sort_order: row.sort_order,
    archived: row.archived,
    deleted_at: null,
  });
}

export async function upsertRate(currency: Currency, as_of: IsoDate, rateScaled: bigint): Promise<RateRow> {
  const user_id = requireUser();
  const existing = await db.rates.where("[currency+as_of]").equals([currency, as_of]).first();
  const row: RateRow = {
    id: existing?.id ?? newId(),
    user_id,
    currency,
    as_of,
    pkr_per_unit: formatRate(rateScaled),
    deleted_at: null,
    created_at: existing?.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return upsert("rates", row, {
    id: row.id,
    currency: row.currency,
    as_of: row.as_of,
    pkr_per_unit: row.pkr_per_unit,
    deleted_at: null,
  });
}

export async function upsertPeriod(start_date: IsoDate, type: PeriodType): Promise<PeriodRow> {
  const user_id = requireUser();
  const existing = await db.periods.where("[type+start_date]").equals([type, start_date]).first();
  const row: PeriodRow = {
    id: existing?.id ?? newId(),
    user_id,
    start_date,
    type,
    deleted_at: null,
    created_at: existing?.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return upsert("periods", row, {
    id: row.id,
    start_date: row.start_date,
    type: row.type,
    deleted_at: null,
  });
}

export async function upsertAllocation(
  period_id: string,
  category_id: string,
  amount: Minor,
): Promise<AllocationRow> {
  const user_id = requireUser();
  const existing = await db.allocations.where("[period_id+category_id]").equals([period_id, category_id]).first();
  const row: AllocationRow = {
    id: existing?.id ?? newId(),
    user_id,
    period_id,
    category_id,
    amount_minor: wire(amount),
    deleted_at: null,
    created_at: existing?.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return upsert("allocations", row, {
    id: row.id,
    period_id: row.period_id,
    category_id: row.category_id,
    amount_minor: row.amount_minor,
    deleted_at: null,
  });
}

/**
 * Add to (or subtract from) what is assigned to a box this period.
 *
 * Reads the current figure from the database rather than from a rendered
 * snapshot, so two quick taps on "assign" add up instead of the second
 * overwriting the first with a stale base.
 */
export async function adjustAllocation(
  period_id: string,
  category_id: string,
  delta: Minor,
): Promise<AllocationRow> {
  const existing = await db.allocations.where("[period_id+category_id]").equals([period_id, category_id]).first();
  const current = existing ? minor(existing.amount_minor) : 0n;
  return upsertAllocation(period_id, category_id, current + delta);
}

export async function createBoxTransfer(input: {
  from_category_id: string;
  to_category_id: string;
  amount: Minor;
  kind: BoxTransferKind;
  created_on?: IsoDate;
}): Promise<BoxTransferRow> {
  const user_id = requireUser();
  const row: BoxTransferRow = {
    id: newId(),
    user_id,
    from_category_id: input.from_category_id,
    to_category_id: input.to_category_id,
    amount_minor: wire(input.amount),
    kind: input.kind,
    created_on: input.created_on ?? today(),
    repaid_at: null,
    deleted_at: null,
    ...stamps(),
  };
  return upsert("box_transfers", row, {
    id: row.id,
    from_category_id: row.from_category_id,
    to_category_id: row.to_category_id,
    amount_minor: row.amount_minor,
    kind: row.kind,
    created_on: row.created_on,
    repaid_at: null,
    deleted_at: null,
  });
}

export async function repayBoxBorrow(id: string, repaid_at: IsoDate = today()): Promise<void> {
  requireUser();
  const existing = await db.box_transfers.get(id);
  if (!existing) return;
  const row: BoxTransferRow = { ...existing, repaid_at, updated_at: new Date().toISOString() };
  await upsert("box_transfers", row, {
    id: row.id,
    from_category_id: row.from_category_id,
    to_category_id: row.to_category_id,
    amount_minor: row.amount_minor,
    kind: row.kind,
    created_on: row.created_on,
    repaid_at: row.repaid_at,
    deleted_at: null,
  });
}
