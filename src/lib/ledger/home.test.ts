import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { AccountRow, AccountType, CounterpartyRow, EntryRow, TransactionRow } from "@/lib/db/types";
import type { Minor } from "@/lib/money";
import { addDays, monthStart, today } from "@/lib/dates";
import { buildSnapshot } from "./snapshot";
import { buildHome } from "./home";

const AT = "2026-01-01T00:00:00Z";
const base = { user_id: "u1", created_at: AT, updated_at: AT, deleted_at: null };
const account = (id: string, name: string, type: AccountType, isFloat = false): AccountRow => ({
  ...base, id, name, type, currency: "PKR", is_float: isFloat, archived: false, sort_order: 0,
});
const person = (id: string, name: string): CounterpartyRow => ({ ...base, id, name, kind: "person", notes: null });
const txn = (id: string, booked_on: string): TransactionRow => ({ ...base, id, booked_on, payee: null, note: null });
const entry = (
  id: string, transaction_id: string, account_id: string, amount: Minor,
  extra: { counterparty_id?: string; due_on?: string } = {},
): EntryRow => ({
  id, user_id: "u1", created_at: AT, updated_at: AT, transaction_id, account_id,
  counterparty_id: extra.counterparty_id ?? null, category_id: null,
  amount_minor: amount.toString(), due_on: extra.due_on ?? null, position: 0,
});

const TODAY = today();
const THIS_MONTH = monthStart(TODAY);

const ACCOUNTS = [
  account("cash", "Samba", "asset"),
  account("recv", "Receivables", "asset"),
  account("pay", "Payables", "liability"),
  account("cfloat", "Client float", "liability", true),
  account("exp", "Expenses", "expense"),
  account("inc", "Salary", "income"),
  account("eq", "Equity:Opening", "equity"),
];
const PEOPLE = [person("danish", "Danish"), person("saud", "Saud"), person("uncles", "Uncles")];

/** Mirrors the real ledger: a little cash, a big float obligation, debts both ways. */
function view(extra: { transactions?: TransactionRow[]; entries?: EntryRow[] } = {}) {
  const snapshot = buildSnapshot({
    accounts: ACCOUNTS,
    counterparties: PEOPLE,
    transactions: [txn("open", THIS_MONTH), ...(extra.transactions ?? [])],
    entries: [
      entry("e1", "open", "cash", 61_073_00n),
      entry("e2", "open", "cfloat", -1_182_900_00n),
      entry("e3", "open", "recv", 584_570_00n, { counterparty_id: "saud" }),
      entry("e4", "open", "recv", 3_800_00n, { counterparty_id: "uncles" }),
      entry("e5", "open", "pay", -723_000_00n, { counterparty_id: "danish", due_on: addDays(TODAY, 69) }),
      entry("e6", "open", "eq", 1_256_457_00n),
      ...(extra.entries ?? []),
    ],
  });
  return buildHome(snapshot, TODAY);
}

describe("buildHome", () => {
  it("leads with the hole — other people's money already spent", () => {
    assert.equal(view().hole, -1_182_900_00n);
  });

  it("reports cash you can actually reach, not money owed to you", () => {
    const v = view();
    assert.equal(v.cash, 61_073_00n, "receivables are not cash");
    assert.equal(v.mine, 61_073_00n - 1_182_900_00n, "and none of it is really mine");
  });

  it("orders what falls due by date and counts the days", () => {
    const v = view();
    assert.equal(v.dueSoon.length, 1);
    assert.equal(v.dueSoon[0]?.position.counterparty.name, "Danish");
    assert.equal(v.dueSoon[0]?.daysUntil, 69);
    assert.equal(v.dueSoon[0]?.overdue, false);
  });

  it("flags a date that has already passed", () => {
    const v = view({
      transactions: [txn("late", THIS_MONTH)],
      entries: [
        entry("l1", "late", "pay", -50_000_00n, { counterparty_id: "uncles", due_on: addDays(TODAY, -5) }),
        entry("l2", "late", "cash", 50_000_00n),
      ],
    });
    const overdue = v.dueSoon.find((d) => d.position.counterparty.name === "Uncles");
    assert.equal(overdue?.overdue, true);
    assert.equal(overdue?.daysUntil, -5);
    assert.equal(v.dueSoon[0]?.position.counterparty.name, "Uncles", "soonest first, overdue at the top");
  });

  it("puts the biggest debtor at the top of the chase list", () => {
    const v = view();
    assert.deepEqual(
      v.chase.map((p) => [p.counterparty.name, p.amountPkr]),
      [["Saud", 584_570_00n], ["Uncles", 3_800_00n]],
    );
    assert.equal(v.owedToMe, 588_370_00n);
  });

  it("totals this month's income and spending", () => {
    const v = view({
      transactions: [txn("in", TODAY), txn("out", TODAY)],
      entries: [
        entry("i1", "in", "cash", 56_000_00n),
        entry("i2", "in", "inc", -56_000_00n),
        entry("o1", "out", "cash", -430_00n),
        entry("o2", "out", "exp", 430_00n),
      ],
    });
    assert.equal(v.month.received, 56_000_00n);
    assert.equal(v.month.spent, 430_00n);
    assert.equal(v.month.net, 55_570_00n);
  });

  it("ignores movements from other months", () => {
    const lastMonth = addDays(THIS_MONTH, -1);
    const v = view({
      transactions: [txn("old", lastMonth)],
      entries: [entry("x1", "old", "cash", 90_000_00n), entry("x2", "old", "inc", -90_000_00n)],
    });
    assert.equal(v.month.received, 0n);
  });

  it("shows no hole when float is fully backed", () => {
    const snapshot = buildSnapshot({
      accounts: ACCOUNTS,
      transactions: [txn("open", THIS_MONTH)],
      entries: [
        entry("f1", "open", "cash", 100_000_00n),
        entry("f2", "open", "eq", -100_000_00n),
      ],
    });
    assert.equal(buildHome(snapshot, TODAY).hole, 0n);
  });
});
