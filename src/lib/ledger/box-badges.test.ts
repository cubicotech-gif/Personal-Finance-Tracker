import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { BoxBorrow } from "./boxes";
import { borrowBadges } from "./box-badges";

const borrow = (from: string, to: string, days: number): BoxBorrow =>
  ({ from: { id: from }, to: { id: to }, daysOutstanding: days, amount: 1n }) as unknown as BoxBorrow;

describe("borrowBadges", () => {
  it("marks both ends of an open borrow", () => {
    const badges = borrowBadges([borrow("a", "b", 12)]);
    assert.deepEqual(badges.get("a"), { days: 12, role: "lent" });
    assert.deepEqual(badges.get("b"), { days: 12, role: "owes" });
    assert.equal(badges.get("c"), undefined);
  });

  it("keeps the oldest borrow when a box is on several", () => {
    const badges = borrowBadges([borrow("a", "b", 3), borrow("c", "a", 40)]);
    assert.deepEqual(badges.get("a"), { days: 40, role: "owes" });
  });

  it("is empty with no borrows", () => {
    assert.equal(borrowBadges([]).size, 0);
  });
});
