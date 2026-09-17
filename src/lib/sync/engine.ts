"use client";

import { db, getMeta, setMeta } from "@/lib/db/dexie";
import type { OutboxItem, OutboxOp } from "@/lib/db/types";
import { supabase } from "@/lib/supabase/client";

/**
 * Sync.
 *
 * Deliberately not a sync engine. This is a single user with an append-only
 * ledger, so the whole protocol is:
 *
 *   push  — drain an ordered outbox of idempotent RPC calls
 *   pull  — fetch rows whose updated_at moved since the last cursor
 *
 * Conflicts resolve last-write-wins, which for one person on two devices is
 * both correct enough and the only thing that can happen: every write is keyed
 * on a client-generated UUID, so a replay converges rather than duplicating.
 */

const PAGE = 500;

/**
 * Money columns are bigint (or numeric) in Postgres and PostgREST renders those
 * as JSON numbers, which silently truncates past 2^53. Casting to text in the
 * select keeps the minor-unit contract intact on the way back down.
 */
const SELECT: Record<string, string> = {
  accounts: "*",
  counterparties: "*",
  categories: "id,user_id,name,kind,target_minor::text,icon,sort_order,archived,created_at,updated_at,deleted_at",
  transactions: "*",
  rates: "id,user_id,currency,as_of,pkr_per_unit::text,created_at,updated_at,deleted_at",
  periods: "*",
  allocations: "id,user_id,period_id,category_id,amount_minor::text,created_at,updated_at,deleted_at",
  box_transfers:
    "id,user_id,from_category_id,to_category_id,amount_minor::text,kind,created_on,repaid_at,created_at,updated_at,deleted_at",
};

const ENTRY_SELECT =
  "id,user_id,transaction_id,account_id,counterparty_id,category_id,amount_minor::text,due_on,position,created_at,updated_at";

/** Pulled in this order so a row never lands before what it references. */
const PULL_ORDER = [
  "accounts",
  "counterparties",
  "categories",
  "rates",
  "periods",
  "allocations",
  "box_transfers",
  "transactions",
] as const;

const EPOCH = "1970-01-01T00:00:00Z";

export class SyncError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

function cursorKey(table: string): string {
  return `cursor:${table}`;
}

// --------------------------------------------------------------------------
// Push
// --------------------------------------------------------------------------

async function applyOp(op: OutboxOp): Promise<void> {
  const sb = supabase();

  switch (op.kind) {
    case "post_transaction": {
      const { error } = await sb.rpc("post_transaction", {
        p_id: op.transaction.id,
        p_booked_on: op.transaction.booked_on,
        p_payee: op.transaction.payee,
        p_note: op.transaction.note,
        p_entries: op.entries,
      });
      if (error) throw toSyncError(error);
      return;
    }
    case "delete_transaction":
    case "restore_transaction": {
      const { error } = await sb.rpc(op.kind, { p_id: op.id });
      if (error) throw toSyncError(error);
      return;
    }
    case "upsert": {
      const { error } = await sb.from(op.table).upsert(op.row, { onConflict: "id" });
      if (error) throw toSyncError(error);
      return;
    }
  }
}

function toSyncError(error: { message: string; code?: string }): SyncError {
  // 23xxx are integrity violations and 22xxx are data errors — replaying those
  // will fail forever, so they must not silently block the queue head.
  const permanent = Boolean(error.code && /^(22|23|42)/.test(error.code));
  return new SyncError(error.message, permanent);
}

export interface PushResult {
  pushed: number;
  blocked: OutboxItem | null;
}

/**
 * Drain the outbox in order. Order matters: an account has to exist before the
 * transaction that references it, so on the first failure we stop rather than
 * skipping ahead. A permanently-failing op is the one thing that can wedge the
 * queue, so it is surfaced to the UI instead of being retried forever.
 */
export async function push(): Promise<PushResult> {
  let pushed = 0;

  for (;;) {
    const item = await db.outbox.orderBy("seq").first();
    if (!item || item.seq === undefined) break;

    try {
      await applyOp(item.op);
      await db.outbox.delete(item.seq);
      pushed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const permanent = error instanceof SyncError && error.permanent;
      const updated: OutboxItem = {
        ...item,
        attempts: item.attempts + 1,
        last_error: message,
      };
      await db.outbox.put(updated);
      return { pushed, blocked: permanent || updated.attempts >= 5 ? updated : null };
    }
  }

  return { pushed, blocked: null };
}

// --------------------------------------------------------------------------
// Pull
// --------------------------------------------------------------------------

interface Row {
  id: string;
  updated_at: string;
  [key: string]: unknown;
}

async function pullTable(table: (typeof PULL_ORDER)[number]): Promise<string[]> {
  const sb = supabase();
  const since = (await getMeta(cursorKey(table))) ?? EPOCH;
  const touched: string[] = [];
  let high = since;
  let offset = 0;

  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select(SELECT[table] ?? "*")
      // gte, not gt: rows can share a timestamp to the microsecond, and a
      // strict cursor would skip the ones that lost the tie. Re-reading the
      // boundary is free because every write below is an idempotent put.
      .gte("updated_at", since)
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (error) throw toSyncError(error);
    const rows = (data ?? []) as unknown as Row[];
    if (rows.length === 0) break;

    await db.table(table).bulkPut(rows);
    for (const row of rows) {
      touched.push(row.id);
      if (row.updated_at > high) high = row.updated_at;
    }

    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  if (high !== since) await setMeta(cursorKey(table), high);
  return touched;
}

/**
 * Entries are pulled by transaction rather than by their own updated_at.
 *
 * Editing a transaction replaces its entry set, so old rows are hard-deleted
 * server-side and a delta feed keyed on updated_at would never mention them —
 * the deleted lines would live on locally and quietly unbalance the ledger.
 * Refetching the whole entry set for every transaction that moved makes the
 * local copy exact.
 */
async function pullEntriesFor(transactionIds: string[]): Promise<void> {
  const sb = supabase();
  for (let i = 0; i < transactionIds.length; i += 100) {
    const chunk = transactionIds.slice(i, i + 100);
    const { data, error } = await sb.from("entries").select(ENTRY_SELECT).in("transaction_id", chunk);
    if (error) throw toSyncError(error);

    await db.transaction("rw", db.entries, async () => {
      await db.entries.where("transaction_id").anyOf(chunk).delete();
      await db.entries.bulkPut((data ?? []) as unknown as never[]);
    });
  }
}

export async function pull(): Promise<void> {
  let transactionIds: string[] = [];
  for (const table of PULL_ORDER) {
    const touched = await pullTable(table);
    if (table === "transactions") transactionIds = touched;
  }
  if (transactionIds.length > 0) await pullEntriesFor(transactionIds);
}

// --------------------------------------------------------------------------

export interface SyncOutcome {
  pushed: number;
  blocked: OutboxItem | null;
}

/** Push first, then pull, so local work is never clobbered by a stale replica. */
export async function syncNow(): Promise<SyncOutcome> {
  const result = await push();
  if (result.blocked) return result;
  await pull();
  return result;
}
