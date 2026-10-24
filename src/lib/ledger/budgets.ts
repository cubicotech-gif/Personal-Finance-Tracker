"use client";

import type { CategoryRow } from "@/lib/db/types";
import type { Minor } from "@/lib/money";
import { type IsoDate, formatMonth, monthStart, monthEnd } from "@/lib/dates";
import { type Snapshot, entryAmount, pkr } from "./snapshot";
import { minor } from "@/lib/money";

/**
 * Spending boxes.
 *
 * A box is a monthly target and what has gone against it this month — nothing
 * more. It is NOT an account and holds no money: the figures here are read off
 * the expense entries that carry the category, so a box can never disagree with
 * a balance and no amount is ever counted twice.
 *
 * There is deliberately no "assign money to a box" step. That was tried and it
 * was the thing that made the app unusable: it asked for a budgeting decision
 * every month before it would show anything. A target is set once; the bar
 * fills itself.
 */

export interface Box {
  category: CategoryRow;
  /** The monthly limit, as set on the category. */
  target: Minor;
  /** Spent against it this month, in PKR. Positive. */
  spent: Minor;
  /** target − spent. Negative means overspent. */
  left: Minor;
  /** 0–100, clamped, for the bar. */
  percent: number;
  over: boolean;
}

export interface BoxesView {
  /** First day of the month being shown. */
  month: IsoDate;
  label: string;
  boxes: Box[];
  totalTarget: Minor;
  totalSpent: Minor;
}

export function monthBoxes(snapshot: Snapshot, on: IsoDate): BoxesView {
  const from = monthStart(on);
  const to = monthEnd(on);

  const spentByCategory = new Map<string, Minor>();

  for (const entry of snapshot.entries) {
    if (!entry.category_id) continue;

    const account = snapshot.accountsById.get(entry.account_id);
    // Only the expense leg counts. The same category never appears on the
    // money leg, but checking the account type means a stray tag on a bank
    // line can never inflate a box.
    if (account?.type !== "expense") continue;

    const bookedOn = snapshot.transactionsById.get(entry.transaction_id)?.booked_on;
    if (!bookedOn || bookedOn < from || bookedOn > to) continue;

    const value = pkr(snapshot, entryAmount(entry), account.currency);
    spentByCategory.set(entry.category_id, (spentByCategory.get(entry.category_id) ?? 0n) + value);
  }

  let totalTarget = 0n;
  let totalSpent = 0n;

  const boxes = snapshot.categories
    .filter((category) => !category.archived)
    .map((category) => {
      const target = minor(category.target_minor);
      const spent = spentByCategory.get(category.id) ?? 0n;
      totalTarget += target;
      totalSpent += spent;

      // A target of zero has no bar to fill: showing 100% on the first rupee
      // would say "full" about a box that was never given a size.
      const percent =
        target > 0n ? Number((spent * 100n) / target) : spent > 0n ? 100 : 0;

      return {
        category,
        target,
        spent,
        left: target - spent,
        percent: Math.max(0, Math.min(100, percent)),
        over: target > 0n && spent > target,
      };
    });

  return { month: from, label: formatMonth(from), boxes, totalTarget, totalSpent };
}
