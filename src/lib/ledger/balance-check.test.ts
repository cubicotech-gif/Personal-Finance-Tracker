import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { AccountRow, AccountType, CounterpartyRow, EntryRow, TransactionRow } from "@/lib/db/types";
import type { Minor } from "@/lib/money";
import { addDays, today } from "@/lib/dates";
import { buildSnapshot } from "./snapshot";
import { buildBalanceChecks, staleCount } from "./balance-check";

const AT = "2026-01-01T00:00:00Z";
const base = { user_id: "u1", created_at: AT, updated_at: AT, deleted_at: null };
const account = (id: string, name: string, type: AccountType, isFloat = false): AccountRow => ({
  ...base, id, name, type, currency: "PKR", is_float: isFloat, archived: false, sort_order: 0,
});
const person = (id: string, name: string): CounterpartyRow => ({ ...base, id, name, kind: "person", notes: null });
const txn = (id: string, booked_on: string, payee: string | null = null): TransactionRow => ({
  ...base, id, booked_on, payee, note: null,
});
const entry = (
  id: string, transaction_id: string, account_id: string, amount: Minor,
  extra: { counterparty_id?: string } = {},
): EntryRow => ({
  id, user_id: "u1", created_at: AT, updated_at: AT, transaction_id, account_id,
  counterparty_id: extra.counterparty_id ?? null, category_id: null,
  amount_minor: amount.toString(), due_on: null, position: 0,
});

const TODAY = today();
const ACCOUNTS = [
  account("samba", "Samba", "asset"),
  account("cash", "Cash", "asset"),
  account("floatcash", "Float cash", "asset", true),
  account("recv", "Receivables", "asset"),
  account("pay", "Payables", "liability"),
  account("exp", "Expenses", "expense"),
  account("eq", "Equity:Opening", "equity"),
];

function snap(transactions: TransactionRow[], entries: EntryRow[]) {
  return buildSnapshot({
    accounts: ACCOUNTS,
    counterparties: [person("ali", "Ali")],
    transactions: [txn("open", addDays(TODAY, -30)), ...transactions],
    entries: [
      entry("o1", "open", "samba", 50_000_00n),
      entry("o2", "open", "cash", 1_000_00n),
      entry("o3", "open", "floatcash", 5_000_00n),
      entry("o4", "open", "recv", 10_000_00n, { counterparty_id: "ali" }),
      entry("o5", "open", "eq", -66_000_00n),
      ...entries,
    ],
  });
}

describe("buildBalanceChecks", () => {
  it("covers cash accounts only — not receivables, debts or categories", () => {
    const checks = buildBalanceChecks(snap([], []), new Map());
    assert.deepEqual(checks.map((c) => c.account.name).sort(), ["Cash", "Float cash", "Samba"]);
  });

  it("treats never-checked as the most overdue thing there is", () => {
    const checks = buildBalanceChecks(snap([], []), new Map());
    for (const check of checks) {
      assert.equal(check.daysSinceCheck, null);
      assert.equal(check.stale, true);
    }
    assert.equal(staleCount(checks), 3);
  });

  it("reads the date off a reconcile that found a difference", () => {
    const on = addDays(TODAY, -2);
    const checks = buildBalanceChecks(
      snap(
        [txn("r1", on, "Reconcile")],
        [entry("r1a", "r1", "samba", -500_00n), entry("r1b", "r1", "exp", 500_00n)],
      ),
      new Map(),
    );
    const samba = checks.find((c) => c.account.id === "samba");
    assert.equal(samba?.lastCheckedOn, on);
    assert.equal(samba?.daysSinceCheck, 2);
    assert.equal(samba?.stale, false);
  });

  it("records a check that found nothing wrong, which posts no transaction", () => {
    // The common case, and the one the ledger cannot see on its own.
    const checks = buildBalanceChecks(snap([], []), new Map([["cash", addDays(TODAY, -1)]]));
    const cash = checks.find((c) => c.account.id === "cash");
    assert.equal(cash?.daysSinceCheck, 1);
    assert.equal(cash?.stale, false);
  });

  it("takes whichever source is more recent", () => {
    const older = addDays(TODAY, -9);
    const newer = addDays(TODAY, -3);
    const withLedgerOlder = buildBalanceChecks(
      snap(
        [txn("r1", older, "Reconcile")],
        [entry("r1a", "r1", "samba", -100n), entry("r1b", "r1", "exp", 100n)],
      ),
      new Map([["samba", newer]]),
    );
    assert.equal(withLedgerOlder.find((c) => c.account.id === "samba")?.lastCheckedOn, newer);

    const withLedgerNewer = buildBalanceChecks(
      snap(
        [txn("r1", newer, "Reconcile")],
        [entry("r1a", "r1", "samba", -100n), entry("r1b", "r1", "exp", 100n)],
      ),
      new Map([["samba", older]]),
    );
    assert.equal(withLedgerNewer.find((c) => c.account.id === "samba")?.lastCheckedOn, newer);
  });

  it("goes stale again after the threshold", () => {
    const checks = buildBalanceChecks(
      snap([], []),
      new Map([["samba", addDays(TODAY, -7)], ["cash", addDays(TODAY, -6)]]),
    );
    assert.equal(checks.find((c) => c.account.id === "samba")?.stale, true, "7 days is stale");
    assert.equal(checks.find((c) => c.account.id === "cash")?.stale, false, "6 days is not");
  });

  it("puts the most overdue first", () => {
    const checks = buildBalanceChecks(
      snap([], []),
      new Map([["samba", addDays(TODAY, -2)], ["floatcash", addDays(TODAY, -10)]]),
    );
    // Cash has never been checked, so it leads; then by days outstanding.
    assert.deepEqual(checks.map((c) => c.account.id), ["cash", "floatcash", "samba"]);
  });

  it("reports the balance the app currently believes", () => {
    const checks = buildBalanceChecks(snap([], []), new Map());
    assert.equal(checks.find((c) => c.account.id === "samba")?.balance, 50_000_00n);
  });
});
