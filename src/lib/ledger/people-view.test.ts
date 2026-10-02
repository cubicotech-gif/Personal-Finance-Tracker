import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { AccountRow, AccountType, CounterpartyRow, EntryRow, TransactionRow } from "@/lib/db/types";
import { buildSnapshot } from "./snapshot";
import { ageTone, counterpartyHistory, dueCountdown } from "./people-view";

describe("ageTone", () => {
  it("is grey under 30, amber to 90, red beyond", () => {
    assert.equal(ageTone(null), "calm");
    assert.equal(ageTone(0), "calm");
    assert.equal(ageTone(29), "calm");
    assert.equal(ageTone(30), "warn");
    assert.equal(ageTone(90), "warn");
    assert.equal(ageTone(91), "alert");
    assert.equal(ageTone(400), "alert");
  });
});

describe("dueCountdown", () => {
  it("counts down, and then counts overdue", () => {
    assert.deepEqual(dueCountdown("2026-12-30", "2026-10-01"), { text: "90 days to 30 Dec", overdue: false });
    assert.deepEqual(dueCountdown("2026-10-02", "2026-10-01"), { text: "1 day to 2 Oct", overdue: false });
    assert.deepEqual(dueCountdown("2026-10-01", "2026-10-01"), { text: "Due today", overdue: false });
    assert.deepEqual(dueCountdown("2026-09-26", "2026-10-01"), { text: "5 days overdue", overdue: true });
    assert.deepEqual(dueCountdown("2026-09-30", "2026-10-01"), { text: "1 day overdue", overdue: true });
  });
});

const AT = "2026-01-01T00:00:00Z";
const base = { user_id: "u1", created_at: AT, updated_at: AT, deleted_at: null };
const acct = (id: string, name: string, type: AccountType): AccountRow => ({
  ...base, id, name, type, currency: "PKR", is_float: false, archived: false, sort_order: 0,
});
const txn = (id: string, booked_on: string, payee: string | null = null): TransactionRow => ({
  ...base, id, booked_on, payee, note: null,
});
const line = (id: string, transaction_id: string, account_id: string, amount: bigint, cp: string | null, at = AT): EntryRow => ({
  id, user_id: "u1", created_at: at, updated_at: at, transaction_id, account_id,
  counterparty_id: cp, category_id: null, amount_minor: amount.toString(), due_on: null, position: 0,
});
const ali: CounterpartyRow = { ...base, id: "ali", name: "Ali", kind: "person", notes: null };

describe("counterpartyHistory", () => {
  const accounts = [acct("cash", "Cash", "asset"), acct("rec", "Receivables", "asset"), acct("pay", "Payables", "liability")];

  it("lists advances and repayments, newest first", () => {
    const snapshot = buildSnapshot({
      accounts,
      counterparties: [ali],
      transactions: [txn("t1", "2026-08-01"), txn("t2", "2026-09-01", "Ali")],
      entries: [
        line("e1", "t1", "cash", -500_000n, null), line("e2", "t1", "rec", 500_000n, "ali"),
        line("e3", "t2", "cash", 200_000n, null), line("e4", "t2", "rec", -200_000n, "ali"),
      ],
    });
    const rows = counterpartyHistory(snapshot, "ali", "owes_me");
    assert.deepEqual(rows.map((r) => [r.on, r.kind, r.amountPkr, r.label]), [
      ["2026-09-01", "repayment", 200_000n, "Ali"],
      ["2026-08-01", "advance", 500_000n, "Lent"],
    ]);
  });

  it("reads a payable the other way round", () => {
    const snapshot = buildSnapshot({
      accounts,
      counterparties: [ali],
      transactions: [txn("t1", "2026-08-01"), txn("t2", "2026-09-01")],
      entries: [
        line("e1", "t1", "cash", 300_000n, null), line("e2", "t1", "pay", -300_000n, "ali"),
        line("e3", "t2", "cash", -100_000n, null), line("e4", "t2", "pay", 100_000n, "ali"),
      ],
    });
    const rows = counterpartyHistory(snapshot, "ali", "i_owe");
    assert.deepEqual(rows.map((r) => [r.kind, r.label]), [["repayment", "Repayment"], ["advance", "Borrowed"]]);
  });

  it("ignores lines that are not a debt, and other people", () => {
    const exp = acct("exp", "Expenses", "expense");
    const snapshot = buildSnapshot({
      accounts: [...accounts, exp],
      counterparties: [ali],
      transactions: [txn("t1", "2026-08-01")],
      entries: [line("e1", "t1", "cash", -50_000n, null), line("e2", "t1", "exp", 50_000n, "ali")],
    });
    assert.equal(counterpartyHistory(snapshot, "ali", "owes_me").length, 0);
  });
});
