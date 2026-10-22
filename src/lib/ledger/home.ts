"use client";

import type { Minor } from "@/lib/money";
import { type IsoDate, daysBetween, formatMonth, monthEnd, monthStart, today } from "@/lib/dates";
import { type Snapshot, entryAmount, pkr } from "./snapshot";
import { accountBalances, summarise } from "./accounts";
import { type DebtPosition, debtPositions } from "./people";

/**
 * "Where do I stand" — the one screen worth opening every morning.
 *
 * Everything here already exists on another tab. The point is ordering: the
 * hole you are in, the money you can actually touch, what falls due next, and
 * who to chase — in that order, because that is the order they can hurt you.
 */

export interface DueItem {
  position: DebtPosition;
  dueOn: IsoDate;
  /** Negative once the date has passed. */
  daysUntil: number;
  overdue: boolean;
}

export interface MonthFlow {
  label: string;
  received: Minor;
  spent: Minor;
  /** Positive means you earned more than you spent this month. */
  net: Minor;
}

export interface HomeView {
  /**
   * Other people's money that has already been spent, as a negative number.
   * Zero when nothing is held, or when float is still fully backed.
   */
  hole: Minor;
  /** Cash you can actually reach — excludes float and money owed to you. */
  cash: Minor;
  /** Cash less everything held for others; the honest "is any of this mine". */
  mine: Minor;
  netWorth: Minor;
  owedToMe: Minor;
  iOwe: Minor;
  /** Debts of mine that carry a date, soonest first. */
  dueSoon: DueItem[];
  /** People who owe me, biggest first — the chase list. */
  chase: DebtPosition[];
  month: MonthFlow;
}

export function buildHome(snapshot: Snapshot, asOf: IsoDate = today()): HomeView {
  const balances = accountBalances(snapshot);
  const summary = summarise(balances);

  let cash = 0n;
  for (const { account, pkr: value, isReceivable } of balances) {
    if (account.type !== "asset" || account.is_float || isReceivable) continue;
    cash += value;
  }

  const positions = debtPositions(snapshot);

  const dueSoon: DueItem[] = positions
    .filter((position) => position.direction === "i_owe" && position.dueOn !== null)
    .map((position) => {
      const dueOn = position.dueOn as IsoDate;
      const daysUntil = daysBetween(asOf, dueOn);
      return { position, dueOn, daysUntil, overdue: daysUntil < 0 };
    })
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  const chase = positions
    .filter((position) => position.direction === "owes_me")
    .sort((a, b) => (b.amountPkr > a.amountPkr ? 1 : b.amountPkr < a.amountPkr ? -1 : 0));

  const start = monthStart(asOf);
  const end = monthEnd(asOf);
  let received = 0n;
  let spent = 0n;

  for (const entry of snapshot.entries) {
    const account = snapshot.accountsById.get(entry.account_id);
    if (!account) continue;
    const bookedOn = snapshot.transactionsById.get(entry.transaction_id)?.booked_on;
    if (!bookedOn || bookedOn < start || bookedOn > end) continue;
    const amount = pkr(snapshot, entryAmount(entry), account.currency);
    // Income carries a credit balance, so negate it to read as money arriving.
    if (account.type === "income") received -= amount;
    else if (account.type === "expense") spent += amount;
  }

  return {
    hole: summary.floatShortfall < 0n ? summary.floatShortfall : 0n,
    cash,
    mine: summary.mine,
    netWorth: summary.netWorth,
    owedToMe: positions
      .filter((p) => p.direction === "owes_me")
      .reduce((total, p) => total + p.amountPkr, 0n),
    iOwe: positions.filter((p) => p.direction === "i_owe").reduce((total, p) => total + p.amountPkr, 0n),
    dueSoon,
    chase,
    month: { label: formatMonth(start), received, spent, net: received - spent },
  };
}
