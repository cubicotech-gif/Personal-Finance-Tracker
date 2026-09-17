import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type {
  AccountRow,
  AccountType,
  AllocationRow,
  BoxTransferKind,
  BoxTransferRow,
  CategoryRow,
  EntryRow,
  PeriodRow,
  TransactionRow,
} from "@/lib/db/types";
import type { Currency, Minor } from "@/lib/money";
import { today } from "@/lib/dates";
import { buildSnapshot } from "./snapshot";
import { buildBoxes, currentPeriod, shiftPeriod, type PeriodWindow } from "./boxes";

const AT = "2026-01-01T00:00:00Z";
const base = { user_id: "u1", created_at: AT, updated_at: AT, deleted_at: null };

const account = (id: string, name: string, type: AccountType, currency: Currency = "PKR"): AccountRow => ({
  ...base, id, name, type, currency, is_float: false, archived: false, sort_order: 0,
});
const floatAccount = (id: string, name: string, type: AccountType): AccountRow => ({
  ...base, id, name, type, currency: "PKR", is_float: true, archived: false, sort_order: 0,
});
const category = (id: string, name: string): CategoryRow => ({
  ...base, id, name, kind: "variable", target_minor: "0", icon: "•", sort_order: 0, archived: false,
});
const txn = (id: string, booked_on: string): TransactionRow => ({ ...base, id, booked_on, payee: null, note: null });
const entry = (
  id: string, transaction_id: string, account_id: string, amount: Minor,
  extra: { category_id?: string } = {},
): EntryRow => ({
  id, user_id: "u1", created_at: AT, updated_at: AT, transaction_id, account_id,
  counterparty_id: null, category_id: extra.category_id ?? null,
  amount_minor: amount.toString(), due_on: null, position: 0,
});
const period = (id: string, start_date: string): PeriodRow => ({ ...base, id, start_date, type: "monthly" });
const allocation = (id: string, period_id: string, category_id: string, amount: Minor): AllocationRow => ({
  ...base, id, period_id, category_id, amount_minor: amount.toString(),
});
const transfer = (
  id: string, from_category_id: string, to_category_id: string, amount: Minor,
  kind: BoxTransferKind, created_on: string, repaid_at: string | null = null,
): BoxTransferRow => ({
  ...base, id, from_category_id, to_category_id, amount_minor: amount.toString(), kind, created_on, repaid_at,
});

// Periods are anchored to the real current month so `isCurrent` behaves and
// booked dates always land inside the window under test.
const THIS: PeriodWindow = currentPeriod();
const LAST: PeriodWindow = shiftPeriod(THIS, -1);

const ACCOUNTS = [
  account("cash", "Cash", "asset"),
  account("exp", "Expenses", "expense"),
  account("salary", "Salary", "income"),
  account("freelance", "Freelance", "income"),
  account("equity", "Equity:Opening", "equity"),
];
const CATEGORIES = [category("groceries", "Groceries"), category("rent", "Rent")];
const PERIODS = [period("p-this", THIS.start), period("p-last", LAST.start)];

/** Rs 1,000 of opening cash, booked before every period under test. */
const OPENING = {
  transactions: [txn("t-open", LAST.start)],
  entries: [entry("e-open1", "t-open", "cash", 100_000n), entry("e-open2", "t-open", "equity", -100_000n)],
};

function view(extra: {
  transactions?: TransactionRow[];
  entries?: EntryRow[];
  allocations?: AllocationRow[];
  boxTransfers?: BoxTransferRow[];
  accounts?: AccountRow[];
}, window: PeriodWindow = THIS) {
  const snapshot = buildSnapshot({
    accounts: extra.accounts ?? ACCOUNTS,
    categories: CATEGORIES,
    periods: PERIODS,
    transactions: [...OPENING.transactions, ...(extra.transactions ?? [])],
    entries: [...OPENING.entries, ...(extra.entries ?? [])],
    allocations: extra.allocations ?? [],
    boxTransfers: extra.boxTransfers ?? [],
  });
  return buildBoxes(snapshot, window);
}

const box = (v: ReturnType<typeof view>, id: string) => v.boxes.find((b) => b.category.id === id);

describe("available to assign", () => {
  it("starts as all of my spendable cash", () => {
    const v = view({});
    assert.equal(v.spendableCash, 100_000n);
    assert.equal(v.availableToAssign, 100_000n);
  });

  it("falls by whatever has been assigned", () => {
    const v = view({ allocations: [allocation("a1", "p-this", "groceries", 60_000n)] });
    assert.equal(box(v, "groceries")?.available, 60_000n);
    assert.equal(v.availableToAssign, 40_000n);
  });

  it("is unchanged by spending inside a box", () => {
    const v = view({
      allocations: [allocation("a1", "p-this", "groceries", 60_000n)],
      transactions: [txn("t1", THIS.start)],
      entries: [
        entry("e1", "t1", "cash", -20_000n),
        entry("e2", "t1", "exp", 20_000n, { category_id: "groceries" }),
      ],
    });
    assert.equal(v.spendableCash, 80_000n);
    assert.equal(box(v, "groceries")?.available, 40_000n);
    assert.equal(v.availableToAssign, 40_000n, "spending from a box does not free up unassigned money");
  });

  it("falls when money is spent without a category", () => {
    const v = view({
      allocations: [allocation("a1", "p-this", "groceries", 60_000n)],
      transactions: [txn("t1", THIS.start)],
      entries: [entry("e1", "t1", "cash", -10_000n), entry("e2", "t1", "exp", 10_000n)],
    });
    assert.equal(box(v, "groceries")?.available, 60_000n);
    assert.equal(v.availableToAssign, 30_000n, "untagged spending comes out of unassigned money");
  });

  it("never counts money held for other people", () => {
    const withFloat = [
      ...ACCOUNTS,
      floatAccount("floatcash", "Float cash", "asset"),
      floatAccount("clientfloat", "Client float", "liability"),
    ];
    const v = view({
      accounts: withFloat,
      transactions: [txn("t-f", LAST.start)],
      entries: [
        entry("e-f1", "t-f", "floatcash", 50_000n),
        entry("e-f2", "t-f", "clientfloat", -80_000n),
        entry("e-f3", "t-f", "equity", 30_000n),
      ],
    });
    // Rs 800 owed against Rs 500 of float cash: Rs 300 of my own money is spoken for.
    assert.equal(v.floatShortfall, -30_000n);
    assert.equal(v.spendableCash, 70_000n);
    assert.equal(v.availableToAssign, 70_000n);
    assert.equal(v.boxes.some((b) => /float/i.test(b.category.name)), false, "float is never a box");
  });

  it("keeps cash = boxes + available to assign, whatever has happened", () => {
    const v = view({
      allocations: [
        allocation("a1", "p-last", "groceries", 60_000n),
        allocation("a2", "p-this", "rent", 25_000n),
      ],
      transactions: [txn("t1", LAST.start), txn("t2", THIS.start), txn("t3", THIS.start)],
      entries: [
        entry("e1", "t1", "cash", -20_000n),
        entry("e2", "t1", "exp", 20_000n, { category_id: "groceries" }),
        entry("e3", "t2", "cash", -30_000n),
        entry("e4", "t2", "exp", 30_000n, { category_id: "rent" }),
        entry("e5", "t3", "cash", -5_000n),
        entry("e6", "t3", "exp", 5_000n),
      ],
      boxTransfers: [transfer("b1", "groceries", "rent", 7_000n, "borrow", THIS.start)],
    });
    const boxesTotal = v.boxes.reduce((total, b) => total + b.available, 0n);
    assert.equal(boxesTotal + v.availableToAssign, v.spendableCash);
  });
});

describe("carry forward", () => {
  it("carries a leftover into the next period", () => {
    const v = view({
      allocations: [allocation("a1", "p-last", "groceries", 60_000n)],
      transactions: [txn("t1", LAST.start)],
      entries: [
        entry("e1", "t1", "cash", -20_000n),
        entry("e2", "t1", "exp", 20_000n, { category_id: "groceries" }),
      ],
    });
    const groceries = box(v, "groceries");
    assert.equal(groceries?.carriedIn, 40_000n);
    assert.equal(groceries?.assigned, 0n, "nothing new was assigned this period");
    assert.equal(groceries?.spent, 0n);
    assert.equal(groceries?.available, 40_000n);
  });

  it("carries an overspend forward as a negative, never resetting to zero", () => {
    const v = view({
      allocations: [allocation("a1", "p-last", "groceries", 10_000n)],
      transactions: [txn("t1", LAST.start)],
      entries: [
        entry("e1", "t1", "cash", -15_000n),
        entry("e2", "t1", "exp", 15_000n, { category_id: "groceries" }),
      ],
    });
    const groceries = box(v, "groceries");
    assert.equal(groceries?.carriedIn, -5_000n);
    assert.equal(groceries?.available, -5_000n);
    assert.equal(groceries?.isOverspent, true);
  });

  it("shows the period it happened in on its own terms", () => {
    const v = view(
      {
        allocations: [allocation("a1", "p-last", "groceries", 10_000n)],
        transactions: [txn("t1", LAST.start)],
        entries: [
          entry("e1", "t1", "cash", -15_000n),
          entry("e2", "t1", "exp", 15_000n, { category_id: "groceries" }),
        ],
      },
      LAST,
    );
    const groceries = box(v, "groceries");
    assert.equal(groceries?.carriedIn, 0n);
    assert.equal(groceries?.assigned, 10_000n);
    assert.equal(groceries?.spent, 15_000n);
    assert.equal(groceries?.available, -5_000n);
  });
});

describe("moving money between boxes", () => {
  const assigned = [
    allocation("a1", "p-this", "groceries", 30_000n),
    allocation("a2", "p-this", "rent", 10_000n),
  ];

  it("reallocates permanently and creates no debt", () => {
    const v = view({
      allocations: assigned,
      boxTransfers: [transfer("b1", "groceries", "rent", 8_000n, "reallocate", THIS.start)],
    });
    assert.equal(box(v, "groceries")?.available, 22_000n);
    assert.equal(box(v, "rent")?.available, 18_000n);
    assert.equal(v.openBorrows.length, 0);
    assert.equal(box(v, "groceries")?.borrowedOut, 0n);
  });

  it("tracks a borrow as an open IOU against the source box", () => {
    const v = view({
      allocations: assigned,
      boxTransfers: [transfer("b1", "groceries", "rent", 8_000n, "borrow", today())],
    });
    assert.equal(box(v, "groceries")?.available, 22_000n);
    assert.equal(box(v, "rent")?.available, 18_000n);
    assert.equal(box(v, "groceries")?.borrowedOut, 8_000n);
    assert.equal(box(v, "rent")?.borrowedIn, 8_000n);
    assert.equal(v.openBorrows.length, 1);
    assert.equal(v.openBorrows[0]?.daysOutstanding, 0);
    assert.equal(box(v, "groceries")?.lentTo[0]?.to.name, "Rent");
  });

  it("returns the money once the borrow is marked repaid", () => {
    const v = view({
      allocations: assigned,
      boxTransfers: [transfer("b1", "groceries", "rent", 8_000n, "borrow", THIS.start, today())],
    });
    assert.equal(box(v, "groceries")?.available, 30_000n);
    assert.equal(box(v, "rent")?.available, 10_000n);
    assert.equal(v.openBorrows.length, 0);
  });

  it("does not let a transfer change the total claimed by boxes", () => {
    const plain = view({ allocations: assigned });
    const moved = view({
      allocations: assigned,
      boxTransfers: [transfer("b1", "groceries", "rent", 8_000n, "borrow", THIS.start)],
    });
    assert.equal(moved.availableToAssign, plain.availableToAssign);
  });
});

describe("income strip", () => {
  it("shows what each source actually paid this period", () => {
    const v = view({
      transactions: [txn("t1", THIS.start), txn("t2", THIS.start), txn("t3", LAST.start)],
      entries: [
        entry("e1", "t1", "cash", 120_000n),
        entry("e2", "t1", "salary", -120_000n),
        entry("e3", "t2", "cash", 40_000n),
        entry("e4", "t2", "freelance", -40_000n),
        // Last period's salary must not appear in this period's strip.
        entry("e5", "t3", "cash", 90_000n),
        entry("e6", "t3", "salary", -90_000n),
      ],
    });
    assert.deepEqual(
      v.income.map((line) => [line.account.name, line.amount]),
      [
        ["Salary", 120_000n],
        ["Freelance", 40_000n],
      ],
    );
    assert.equal(v.incomeTotal, 160_000n);
  });

  it("lists nothing when no income has been received", () => {
    const v = view({});
    assert.deepEqual(v.income, []);
    assert.equal(v.incomeTotal, 0n);
  });
});
