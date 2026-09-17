"use client";

import type { CounterpartyRow, EntryRow } from "@/lib/db/types";
import type { Currency, Minor } from "@/lib/money";
import { abs } from "@/lib/money";
import { type IsoDate, daysSince } from "@/lib/dates";
import { type Snapshot, entryAmount, pkr } from "./snapshot";

/**
 * Who owes what.
 *
 * A debt is not a separate table: it is the balance of entries tagged with a
 * counterparty on a receivable (asset) or payable (liability) account. That
 * means a repayment is an ordinary transaction, partial repayments fall out for
 * free, and the balance sheet and /people can never disagree.
 */

export type DebtDirection = "owes_me" | "i_owe";

export interface DebtPosition {
  counterparty: CounterpartyRow;
  direction: DebtDirection;
  /** Always positive — the direction carries the sign. */
  amountPkr: Minor;
  /** Positive amounts per currency, for the mixed-currency case. */
  byCurrency: Map<Currency, Minor>;
  /** booked_on of the oldest still-unpaid lot, after FIFO netting. */
  openedOn: IsoDate | null;
  daysOutstanding: number | null;
  dueOn: IsoDate | null;
  /** The receivable/payable account to book a repayment against. */
  settlementAccountId: string | null;
}

interface Lot {
  on: IsoDate;
  due: IsoDate | null;
  accountId: string;
  /** Remaining unpaid amount in PKR, always positive. */
  remaining: Minor;
}

export function debtPositions(snapshot: Snapshot): DebtPosition[] {
  // Only receivable/payable lines count. A counterparty tagged on an expense is
  // a note about who the money went to, not a debt.
  const relevant = snapshot.entries.filter((entry) => {
    if (!entry.counterparty_id) return false;
    const account = snapshot.accountsById.get(entry.account_id);
    return account?.type === "asset" || account?.type === "liability";
  });

  const grouped = new Map<string, EntryRow[]>();
  for (const entry of relevant) {
    const key = entry.counterparty_id as string;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(entry);
    else grouped.set(key, [entry]);
  }

  const positions: DebtPosition[] = [];

  for (const [counterpartyId, entries] of grouped) {
    const counterparty = snapshot.counterpartiesById.get(counterpartyId);
    if (!counterparty) continue;

    const dated = entries
      .map((entry) => {
        const account = snapshot.accountsById.get(entry.account_id);
        const currency = account?.currency ?? "PKR";
        const native = entryAmount(entry);
        return {
          entry,
          on: snapshot.transactionsById.get(entry.transaction_id)?.booked_on ?? "",
          currency,
          native,
          value: pkr(snapshot, native, currency),
          accountId: entry.account_id,
        };
      })
      .sort(
        (a, b) =>
          a.on.localeCompare(b.on) || a.entry.created_at.localeCompare(b.entry.created_at),
      );

    const netPkr = dated.reduce((total, row) => total + row.value, 0n);
    if (netPkr === 0n) continue;

    const netSign: 1 | -1 = netPkr > 0n ? 1 : -1;

    const byCurrency = new Map<Currency, Minor>();
    for (const row of dated) {
      byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0n) + row.native);
    }
    for (const [currency, total] of byCurrency) {
      if (total === 0n) byCurrency.delete(currency);
      else byCurrency.set(currency, netSign === 1 ? total : -total);
    }

    // Age the position FIFO: the oldest advance is what a repayment pays off.
    // Without this, days-outstanding would reset on every partial repayment,
    // making an old debt look new — the exact thing this page exists to stop.
    // Netting runs on PKR-converted amounts so one timeline survives a
    // counterparty who has both PKR and USD lines.
    const open: Lot[] = [];
    for (const row of dated) {
      const sign = row.value > 0n ? 1 : row.value < 0n ? -1 : 0;
      if (sign === 0) continue;
      if (sign === netSign) {
        open.push({ on: row.on, due: row.entry.due_on, accountId: row.accountId, remaining: abs(row.value) });
        continue;
      }
      let toApply = abs(row.value);
      while (toApply > 0n && open.length > 0) {
        const head = open[0];
        if (!head) break;
        if (head.remaining > toApply) {
          head.remaining -= toApply;
          toApply = 0n;
        } else {
          toApply -= head.remaining;
          open.shift();
        }
      }
    }

    const oldest = open[0];
    positions.push({
      counterparty,
      direction: netSign === 1 ? "owes_me" : "i_owe",
      amountPkr: abs(netPkr),
      byCurrency,
      openedOn: oldest?.on ?? null,
      daysOutstanding: oldest?.on ? daysSince(oldest.on) : null,
      dueOn: oldest?.due ?? null,
      settlementAccountId: oldest?.accountId ?? dated[dated.length - 1]?.accountId ?? null,
    });
  }

  return positions.sort(
    (a, b) => (b.daysOutstanding ?? -1) - (a.daysOutstanding ?? -1) || a.counterparty.name.localeCompare(b.counterparty.name),
  );
}

export interface PeopleLists {
  owesMe: DebtPosition[];
  iOwe: DebtPosition[];
}

/** Float clients are kept apart from personal debts — different kind of money. */
export function splitByKind(positions: DebtPosition[]): {
  people: PeopleLists;
  floatClients: PeopleLists;
} {
  const pick = (kind: "person" | "float_client"): PeopleLists => ({
    owesMe: positions.filter((p) => p.counterparty.kind === kind && p.direction === "owes_me"),
    iOwe: positions.filter((p) => p.counterparty.kind === kind && p.direction === "i_owe"),
  });
  return { people: pick("person"), floatClients: pick("float_client") };
}

export function totalOf(positions: DebtPosition[]): Minor {
  return positions.reduce((total, position) => total + position.amountPkr, 0n);
}
