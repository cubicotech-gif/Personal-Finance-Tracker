"use client";

import {
  adjustAllocation,
  createBoxTransfer,
  repayBoxBorrow,
  upsertPeriod,
} from "@/lib/db/mutations";
import type { BoxTransferKind } from "@/lib/db/types";
import type { Minor } from "@/lib/money";
import type { Box, BoxesView, PeriodWindow } from "./boxes";

/**
 * The three things a person can do to a budget, and the rules that guard them.
 *
 * None of these touch the ledger. Assigning money does not move it, and
 * borrowing between boxes is not a transaction — it is a note about intent
 * sitting on top of cash that has not gone anywhere.
 */

export class BudgetRuleError extends Error {}

/**
 * Assign (positive) or take back (negative) money for this period's box.
 *
 * Refuses to assign more than is actually in hand: "available to assign" is
 * derived from posted entries, so this is what enforces "only received money
 * can be assigned" — there is no way to budget income that has not arrived.
 */
export async function assignToBox(
  view: BoxesView,
  window: PeriodWindow,
  categoryId: string,
  delta: Minor,
): Promise<void> {
  if (delta === 0n) throw new BudgetRuleError("Enter an amount");
  if (!window.isCurrent) throw new BudgetRuleError("You can only assign in the current period");

  if (delta > 0n && delta > view.availableToAssign) {
    throw new BudgetRuleError("That is more than you have available to assign");
  }

  if (delta < 0n) {
    const box = view.boxes.find((candidate) => candidate.category.id === categoryId);
    const available = box?.available ?? 0n;
    if (-delta > available) {
      throw new BudgetRuleError("That box does not have that much left to take back");
    }
  }

  const period = await upsertPeriod(window.start, window.type);
  await adjustAllocation(period.id, categoryId, delta);
}

export async function moveBetweenBoxes(
  view: BoxesView,
  window: PeriodWindow,
  fromCategoryId: string,
  toCategoryId: string,
  amount: Minor,
  kind: BoxTransferKind,
): Promise<void> {
  if (!window.isCurrent) throw new BudgetRuleError("You can only move money in the current period");
  if (amount <= 0n) throw new BudgetRuleError("Enter an amount");
  if (fromCategoryId === toCategoryId) throw new BudgetRuleError("Pick two different boxes");

  const from: Box | undefined = view.boxes.find((box) => box.category.id === fromCategoryId);
  if (!from) throw new BudgetRuleError("Pick a box to take from");
  if (amount > from.available) {
    throw new BudgetRuleError(`${from.category.name} does not have that much left`);
  }

  await createBoxTransfer({
    from_category_id: fromCategoryId,
    to_category_id: toCategoryId,
    amount,
    kind,
  });
}

export async function settleBorrow(id: string): Promise<void> {
  await repayBoxBorrow(id);
}
