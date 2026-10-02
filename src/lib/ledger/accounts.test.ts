import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { AccountRow, AccountType, EntryRow, TransactionRow } from "@/lib/db/types";
import type { Currency } from "@/lib/money";
import { buildSnapshot } from "./snapshot";
import { accountBalances, groupOf, netWorthChange } from "./accounts";

const AT = "2026-01-01T00:00:00Z";
const base = { user_id: "u1", created_at: AT, updated_at: AT, deleted_at: null };

function account(
  id: string,
  name: string,
  type: AccountType,
  extra: { currency?: Currency; is_float?: boolean } = {},
): AccountRow {
  return { ...base, id, name, type, currency: extra.currency ?? "PKR", is_float: extra.is_float ?? false, archived: false, sort_order: 0 };
}
const txn = (id: string, booked_on: string): TransactionRow => ({ ...base, id, booked_on, payee: null, note: null });
const entry = (id: string, transaction_id: string, account_id: string, amount: bigint, position = 0): EntryRow => ({
  id, user_id: "u1", created_at: AT, updated_at: AT, transaction_id, account_id,
  counterparty_id: null, category_id: null, amount_minor: amount.toString(), due_on: null, position,
});

const cash = account("cash", "Cash", "asset");
const equity = account("eq", "Equity:Opening", "equity");
const income = account("inc", "Income", "income");

describe("netWorthChange", () => {
  it("compares now with the close of last month", () => {
    const snapshot = buildSnapshot({
      accounts: [cash, equity, income],
      transactions: [txn("t1", "2026-08-15"), txn("t2", "2026-09-10")],
      entries: [
        entry("e1", "t1", "cash", 100_000n), entry("e2", "t1", "eq", -100_000n, 1),
        entry("e3", "t2", "cash", 25_000n), entry("e4", "t2", "inc", -25_000n, 1),
      ],
    });
    const change = netWorthChange(snapshot, "2026-09-20");
    assert.equal(change.current, 125_000n);
    assert.equal(change.previous, 100_000n);
    assert.equal(change.delta, 25_000n);
    assert.equal(change.hasPrevious, true);
  });

  it("goes negative when the month lost money", () => {
    const exp = account("exp", "Expenses", "expense");
    const snapshot = buildSnapshot({
      accounts: [cash, equity, exp],
      transactions: [txn("t1", "2026-08-01"), txn("t2", "2026-09-02")],
      entries: [
        entry("e1", "t1", "cash", 100_000n), entry("e2", "t1", "eq", -100_000n, 1),
        entry("e3", "t2", "cash", -40_000n), entry("e4", "t2", "exp", 40_000n, 1),
      ],
    });
    assert.equal(netWorthChange(snapshot, "2026-09-20").delta, -40_000n);
  });

  it("says there is nothing to compare with in the first month", () => {
    const snapshot = buildSnapshot({
      accounts: [cash, equity],
      transactions: [txn("t1", "2026-09-05")],
      entries: [entry("e1", "t1", "cash", 100_000n), entry("e2", "t1", "eq", -100_000n, 1)],
    });
    assert.equal(netWorthChange(snapshot, "2026-09-20").hasPrevious, false);
  });

  it("ignores transactions dated after the cutoff", () => {
    const snapshot = buildSnapshot({
      accounts: [cash, equity],
      transactions: [txn("t1", "2026-08-01"), txn("t2", "2026-09-05")],
      entries: [
        entry("e1", "t1", "cash", 100_000n), entry("e2", "t1", "eq", -100_000n, 1),
        entry("e3", "t2", "cash", 5_000n), entry("e4", "t2", "eq", -5_000n, 1),
      ],
    });
    const asOf = accountBalances(snapshot, "2026-08-31").find((b) => b.account.id === "cash");
    assert.equal(asOf?.native, 100_000n);
  });
});

describe("groupOf", () => {
  it("sorts accounts into the four lists", () => {
    assert.equal(groupOf(account("a", "Client float", "liability", { is_float: true })), "float");
    assert.equal(groupOf(account("b", "Wise", "asset", { currency: "USD" })), "usd");
    assert.equal(groupOf(account("c", "Emergency fund", "asset")), "buffer");
    assert.equal(groupOf(account("d", "Meezan", "asset")), "operating");
  });

  it("keeps a float account in float even when it is in dollars", () => {
    assert.equal(groupOf(account("e", "USD float", "asset", { currency: "USD", is_float: true })), "float");
  });
});
