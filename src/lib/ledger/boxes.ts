"use client";

import type { AccountRow, BoxTransferRow, CategoryRow, PeriodType } from "@/lib/db/types";
import type { Minor } from "@/lib/money";
import { type IsoDate, addDays, addMonths, daysSince, formatDay, formatMonth, monthEnd, monthStart, today, weekStart } from "@/lib/dates";
import { type Snapshot, entryAmount, pkr } from "./snapshot";
import { accountBalances, summarise } from "./accounts";

/**
 * Budget envelopes.
 *
 * Envelopes are an allocation layer, not accounts. Nothing in this file writes
 * to or reads a balance: a box is a claim on cash that already exists in an
 * asset account, and the ledger is untouched by assigning, reallocating or
 * borrowing. That is what stops the same rupee being counted twice.
 *
 * The governing identity is:
 *
 *     spendable cash  =  sum of all box balances  +  available to assign
 *
 * Everything below falls out of keeping that true.
 */

export interface PeriodWindow {
  start: IsoDate;
  /** Inclusive. */
  end: IsoDate;
  type: PeriodType;
  label: string;
  isCurrent: boolean;
}

export function periodWindow(start: IsoDate, type: PeriodType = "monthly"): PeriodWindow {
  const normalised = type === "monthly" ? monthStart(start) : weekStart(start);
  const end = type === "monthly" ? monthEnd(normalised) : addDays(normalised, 6);
  const now = today();
  return {
    start: normalised,
    end,
    type,
    label: type === "monthly" ? formatMonth(normalised) : `Week of ${formatDay(normalised)}`,
    isCurrent: normalised <= now && now <= end,
  };
}

export function currentPeriod(type: PeriodType = "monthly"): PeriodWindow {
  return periodWindow(today(), type);
}

export function shiftPeriod(window: PeriodWindow, delta: number): PeriodWindow {
  return window.type === "monthly"
    ? periodWindow(addMonths(window.start, delta), "monthly")
    : periodWindow(addDays(window.start, delta * 7), "weekly");
}

// --------------------------------------------------------------------------

export interface BoxBorrow {
  transfer: BoxTransferRow;
  from: CategoryRow;
  to: CategoryRow;
  amount: Minor;
  daysOutstanding: number;
}

export interface Box {
  category: CategoryRow;
  /** Assigned to this box in this period. */
  assigned: Minor;
  /** Spent from this box in this period. */
  spent: Minor;
  /** Balance carried in from before this period — negative if overspent. */
  carriedIn: Minor;
  /** Net effect of reallocations and open borrows dated inside this period. */
  transferred: Minor;
  /** What is left. Carries forward; never resets. */
  available: Minor;
  /** Open borrows sourced from this box, as a positive number. */
  borrowedOut: Minor;
  /** Open borrows received into this box, as a positive number. */
  borrowedIn: Minor;
  lentTo: BoxBorrow[];
  isOverspent: boolean;
}

export interface IncomeLine {
  account: AccountRow;
  /** Received in this period, in PKR. */
  amount: Minor;
}

export interface BoxesView {
  window: PeriodWindow;
  /** Income actually received this period, per source. Never expected income. */
  income: IncomeLine[];
  incomeTotal: Minor;
  /**
   * Cash that is mine and not already claimed by a box.
   * Derived from posted entries, so only received money can ever be assigned.
   */
  availableToAssign: Minor;
  spendableCash: Minor;
  claimedByBoxes: Minor;
  /**
   * Never a box and never budgetable — a hole to be returned, shown on its own.
   */
  floatShortfall: Minor;
  boxes: Box[];
  openBorrows: BoxBorrow[];
  assignedThisPeriod: Minor;
  spentThisPeriod: Minor;
}

/** A borrow counts while it is unrepaid; a reallocation counts forever. */
function transferEffectAt(transfer: BoxTransferRow, asOf: IsoDate): boolean {
  if (transfer.created_on > asOf) return false;
  if (transfer.kind === "reallocate") return true;
  // Repaid on or before the cutoff means the money had already gone back.
  return transfer.repaid_at === null || transfer.repaid_at > asOf;
}

/**
 * Box balances as they stood at a point in time.
 *
 * `allocationsBefore` is exclusive of the period starting on that date, so the
 * same function gives both the carried-in balance (before this period) and the
 * current balance (including it).
 */
function balancesAt(
  snapshot: Snapshot,
  spendCutoff: IsoDate,
  allocationsThrough: IsoDate,
  includeAllocationsOn: boolean,
  type: PeriodType,
): Map<string, Minor> {
  const totals = new Map<string, Minor>();
  const add = (categoryId: string, amount: Minor) =>
    totals.set(categoryId, (totals.get(categoryId) ?? 0n) + amount);

  const periodStart = new Map(snapshot.periods.map((period) => [period.id, period]));

  for (const allocation of snapshot.allocations) {
    const period = periodStart.get(allocation.period_id);
    // Weekly and monthly envelopes would otherwise be summed together.
    if (!period || period.type !== type) continue;
    const inRange = includeAllocationsOn
      ? period.start_date <= allocationsThrough
      : period.start_date < allocationsThrough;
    if (!inRange) continue;
    add(allocation.category_id, BigInt(allocation.amount_minor));
  }

  for (const entry of snapshot.entries) {
    if (!entry.category_id) continue;
    const account = snapshot.accountsById.get(entry.account_id);
    if (account?.type !== "expense") continue;
    const bookedOn = snapshot.transactionsById.get(entry.transaction_id)?.booked_on;
    if (!bookedOn || bookedOn > spendCutoff) continue;
    // Expense entries are debit-positive, so spending reduces the box.
    add(entry.category_id, -pkr(snapshot, entryAmount(entry), account.currency));
  }

  for (const transfer of snapshot.boxTransfers) {
    if (!transferEffectAt(transfer, spendCutoff)) continue;
    const amount = BigInt(transfer.amount_minor);
    add(transfer.from_category_id, -amount);
    add(transfer.to_category_id, amount);
  }

  return totals;
}

export function buildBoxes(snapshot: Snapshot, window: PeriodWindow): BoxesView {
  const { start, end, type } = window;

  const available = balancesAt(snapshot, end, start, true, type);
  const carriedIn = balancesAt(snapshot, addDays(start, -1), start, false, type);

  // This period's own numbers.
  const periodRow = snapshot.periods.find(
    (period) => period.start_date === start && period.type === type,
  );
  const assigned = new Map<string, Minor>();
  if (periodRow) {
    for (const allocation of snapshot.allocations) {
      if (allocation.period_id !== periodRow.id) continue;
      assigned.set(
        allocation.category_id,
        (assigned.get(allocation.category_id) ?? 0n) + BigInt(allocation.amount_minor),
      );
    }
  }

  const spent = new Map<string, Minor>();
  const income = new Map<string, Minor>();

  for (const entry of snapshot.entries) {
    const account = snapshot.accountsById.get(entry.account_id);
    if (!account) continue;
    const bookedOn = snapshot.transactionsById.get(entry.transaction_id)?.booked_on;
    if (!bookedOn || bookedOn < start || bookedOn > end) continue;
    const amount = pkr(snapshot, entryAmount(entry), account.currency);

    if (account.type === "expense" && entry.category_id) {
      spent.set(entry.category_id, (spent.get(entry.category_id) ?? 0n) + amount);
    } else if (account.type === "income") {
      // Income accounts carry a credit balance; negate to get what arrived.
      income.set(account.id, (income.get(account.id) ?? 0n) - amount);
    }
  }

  const openBorrows: BoxBorrow[] = [];
  const lentByCategory = new Map<string, BoxBorrow[]>();
  const borrowedOut = new Map<string, Minor>();
  const borrowedIn = new Map<string, Minor>();

  for (const transfer of snapshot.boxTransfers) {
    if (transfer.kind !== "borrow" || transfer.repaid_at !== null) continue;
    const from = snapshot.categoriesById.get(transfer.from_category_id);
    const to = snapshot.categoriesById.get(transfer.to_category_id);
    if (!from || !to) continue;

    const borrow: BoxBorrow = {
      transfer,
      from,
      to,
      amount: BigInt(transfer.amount_minor),
      daysOutstanding: daysSince(transfer.created_on),
    };
    openBorrows.push(borrow);
    const bucket = lentByCategory.get(from.id);
    if (bucket) bucket.push(borrow);
    else lentByCategory.set(from.id, [borrow]);
    borrowedOut.set(from.id, (borrowedOut.get(from.id) ?? 0n) + borrow.amount);
    borrowedIn.set(to.id, (borrowedIn.get(to.id) ?? 0n) + borrow.amount);
  }

  openBorrows.sort((a, b) => b.daysOutstanding - a.daysOutstanding);

  const boxes: Box[] = snapshot.categories
    .filter((category) => !category.archived)
    .map((category) => {
      const boxAvailable = available.get(category.id) ?? 0n;
      const boxCarried = carriedIn.get(category.id) ?? 0n;
      const boxAssigned = assigned.get(category.id) ?? 0n;
      const boxSpent = spent.get(category.id) ?? 0n;
      return {
        category,
        assigned: boxAssigned,
        spent: boxSpent,
        carriedIn: boxCarried,
        // Whatever the period's movement does not explain came from a transfer.
        transferred: boxAvailable - (boxCarried + boxAssigned - boxSpent),
        available: boxAvailable,
        borrowedOut: borrowedOut.get(category.id) ?? 0n,
        borrowedIn: borrowedIn.get(category.id) ?? 0n,
        lentTo: lentByCategory.get(category.id) ?? [],
        isOverspent: boxAvailable < 0n,
      };
    });

  const summary = summarise(accountBalances(snapshot));

  // Claimed against the ledger as it stands now, not as of the viewed period:
  // "available to assign" is a live statement about cash in hand.
  const nowWindow = currentPeriod(type);
  const claimedNow = balancesAt(snapshot, nowWindow.end, nowWindow.start, true, type);
  let claimedByBoxes = 0n;
  for (const value of claimedNow.values()) claimedByBoxes += value;

  const incomeLines: IncomeLine[] = [...income.entries()]
    .map(([accountId, amount]) => ({ account: snapshot.accountsById.get(accountId)!, amount }))
    .filter((line) => line.account !== undefined && line.amount !== 0n)
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));

  return {
    window,
    income: incomeLines,
    incomeTotal: incomeLines.reduce((total, line) => total + line.amount, 0n),
    availableToAssign: summary.mine - claimedByBoxes,
    spendableCash: summary.mine,
    claimedByBoxes,
    floatShortfall: summary.floatShortfall,
    boxes,
    openBorrows,
    assignedThisPeriod: boxes.reduce((total, box) => total + box.assigned, 0n),
    spentThisPeriod: boxes.reduce((total, box) => total + box.spent, 0n),
  };
}

/**
 * How much of this period is used up, 0..1, for the progress bar.
 * Based on what the box had available to spend, including anything carried in.
 */
export function boxProgress(box: Box): number {
  const budget = box.spent + box.available;
  if (budget <= 0n) return box.spent > 0n ? 1 : 0;
  if (box.spent <= 0n) return 0;
  if (box.spent >= budget) return 1;
  // Percent needs a number; the ratio is bounded and only drives a pixel width.
  return Number((box.spent * 1000n) / budget) / 1000;
}
