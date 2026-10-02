import type { BoxBorrow } from "./boxes";

export interface BorrowBadge {
  /** Days the longest open borrow touching this box has been out. */
  days: number;
  /** "lent" if the box is the source of that borrow, "owes" if it received it. */
  role: "lent" | "owes";
}

/**
 * One badge per box that has an open borrow, for the card. When a box is on
 * several, the oldest wins — that is the one that needs attention first.
 */
export function borrowBadges(borrows: BoxBorrow[]): Map<string, BorrowBadge> {
  const badges = new Map<string, BorrowBadge>();
  const note = (categoryId: string, days: number, role: BorrowBadge["role"]) => {
    const current = badges.get(categoryId);
    if (!current || days > current.days) badges.set(categoryId, { days, role });
  };
  for (const borrow of borrows) {
    note(borrow.from.id, borrow.daysOutstanding, "lent");
    note(borrow.to.id, borrow.daysOutstanding, "owes");
  }
  return badges;
}
