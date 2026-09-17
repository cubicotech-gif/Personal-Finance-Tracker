import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type {
  AccountRow,
  AccountType,
  CategoryRow,
  CounterpartyRow,
  EntryRow,
  RateRow,
  TransactionRow,
} from "@/lib/db/types";
import type { Currency } from "@/lib/money";
import { buildSnapshot } from "./snapshot";
import { accountBalances, summarise } from "./accounts";
import { debtPositions } from "./people";
import { composeEntries, decompose } from "./compose";
import { toLogRow } from "./log";

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const AT = "2026-01-01T00:00:00Z";
const base = { user_id: "u1", created_at: AT, updated_at: AT, deleted_at: null };

function account(
  id: string,
  name: string,
  type: AccountType,
  extra: { currency?: Currency; is_float?: boolean } = {},
): AccountRow {
  return {
    ...base,
    id,
    name,
    type,
    currency: extra.currency ?? "PKR",
    is_float: extra.is_float ?? false,
    archived: false,
    sort_order: 0,
  };
}

function txn(id: string, booked_on: string, payee: string | null = null): TransactionRow {
  return { ...base, id, booked_on, payee, note: null };
}

function entry(
  id: string,
  transaction_id: string,
  account_id: string,
  amount: bigint,
  extra: { counterparty_id?: string; category_id?: string; due_on?: string } = {},
): EntryRow {
  return {
    id,
    user_id: "u1",
    created_at: AT,
    updated_at: AT,
    transaction_id,
    account_id,
    counterparty_id: extra.counterparty_id ?? null,
    category_id: extra.category_id ?? null,
    amount_minor: amount.toString(),
    due_on: extra.due_on ?? null,
    position: 0,
  } as EntryRow;
}

function counterparty(id: string, name: string, kind: "person" | "float_client" = "person"): CounterpartyRow {
  return { ...base, id, name, kind, notes: null };
}

function category(id: string, name: string): CategoryRow {
  return { ...base, id, name, kind: "variable", target_minor: "0", icon: "•", sort_order: 0, archived: false };
}

function rate(currency: Currency, as_of: string, pkr_per_unit: string): RateRow {
  return { ...base, id: `rate-${currency}-${as_of}`, currency, as_of, pkr_per_unit };
}

// --------------------------------------------------------------------------

describe("summarise", () => {
  const accounts = [
    account("cash", "Cash", "asset"),
    account("floatcash", "Float cash", "asset", { is_float: true }),
    account("clientfloat", "Client float", "liability", { is_float: true }),
    account("card", "Credit card", "liability"),
    account("equity", "Equity:Opening", "equity"),
  ];

  // Rs 1,000 own cash; Rs 500 float cash held against Rs 800 owed to clients;
  // Rs 150 on a card. The float is Rs 300 short.
  const entries = [
    entry("e1", "t1", "cash", 100_000n),
    entry("e2", "t1", "floatcash", 50_000n),
    entry("e3", "t1", "clientfloat", -80_000n),
    entry("e4", "t1", "card", -15_000n),
    entry("e5", "t1", "equity", -55_000n),
  ];

  const snapshot = buildSnapshot(accounts, [], [], [txn("t1", "2026-01-01")], entries, []);
  const summary = summarise(accountBalances(snapshot));

  it("keeps float cash out of my own money", () => {
    assert.equal(summary.heldForOthers, 80_000n);
    assert.equal(summary.floatCash, 50_000n);
  });

  it("reports the float shortfall as a negative hole", () => {
    assert.equal(summary.floatShortfall, -30_000n);
  });

  it("takes the shortfall out of what is free to spend", () => {
    // Rs 1,000 of my own cash, less the Rs 300 of float already spent.
    assert.equal(summary.mine, 70_000n);
  });

  it("does not subtract a float surplus from my money", () => {
    const surplus = buildSnapshot(
      accounts,
      [],
      [],
      [txn("t1", "2026-01-01")],
      [
        entry("e1", "t1", "cash", 100_000n),
        entry("e2", "t1", "floatcash", 90_000n),
        entry("e3", "t1", "clientfloat", -80_000n),
        entry("e5", "t1", "equity", -110_000n),
      ],
      [],
    );
    const result = summarise(accountBalances(surplus));
    assert.equal(result.floatShortfall, 10_000n);
    assert.equal(result.mine, 100_000n, "a surplus is still not mine");
  });

  it("keeps receivables out of what is free to spend", () => {
    const withLoan = buildSnapshot(
      [...accounts, account("recv", "Receivables", "asset")],
      [counterparty("ali", "Ali")],
      [],
      [txn("t1", "2026-01-01"), txn("t2", "2026-02-01")],
      [
        ...entries,
        entry("e6", "t2", "recv", 5_000n, { counterparty_id: "ali" }),
        entry("e7", "t2", "cash", -5_000n),
      ],
      [],
    );
    const result = summarise(accountBalances(withLoan));
    // Cash went down by the Rs 50 lent, and the receivable does not replace it.
    assert.equal(result.mine, 65_000n);
    // It is still mine on paper, so net worth is unchanged by lending.
    assert.equal(result.netWorth, 55_000n);
  });

  it("computes net worth as assets minus liabilities", () => {
    assert.equal(summary.assets, 150_000n);
    assert.equal(summary.liabilities, 95_000n);
    assert.equal(summary.netWorth, 55_000n);
  });

  it("converts a foreign account at the latest rate", () => {
    const withUsd = buildSnapshot(
      [...accounts, account("usd", "USD Cash", "asset", { currency: "USD" })],
      [],
      [],
      [txn("t1", "2026-01-01")],
      [...entries, entry("e6", "t1", "usd", 10_000n)],
      [rate("USD", "2026-01-01", "270"), rate("USD", "2026-06-01", "278.5")],
    );
    const balances = accountBalances(withUsd);
    const usd = balances.find((b) => b.account.id === "usd");
    // $100.00 at the newer 278.50 rate is Rs 27,850.
    assert.equal(usd?.native, 10_000n);
    assert.equal(usd?.pkr, 2_785_000n);
  });
});

describe("debtPositions", () => {
  const accounts = [
    account("cash", "Cash", "asset"),
    account("recv", "Receivables", "asset"),
    account("pay", "Payables", "liability"),
  ];
  const people = [counterparty("ali", "Ali"), counterparty("bilal", "Bilal Traders", "float_client")];

  it("ages from the oldest unpaid advance, not the last repayment", () => {
    const transactions = [
      txn("t1", "2026-01-01"),
      txn("t2", "2026-06-01"),
      txn("t3", "2026-07-01"),
    ];
    const entries = [
      entry("e1", "t1", "recv", 5_000n, { counterparty_id: "ali" }),
      entry("e1b", "t1", "cash", -5_000n),
      entry("e2", "t2", "recv", 3_000n, { counterparty_id: "ali" }),
      entry("e2b", "t2", "cash", -3_000n),
      // A partial repayment that does not clear the January advance.
      entry("e3", "t3", "recv", -4_000n, { counterparty_id: "ali" }),
      entry("e3b", "t3", "cash", 4_000n),
    ];
    const snapshot = buildSnapshot(accounts, people, [], transactions, entries, []);
    const [position] = debtPositions(snapshot);

    assert.equal(position?.direction, "owes_me");
    assert.equal(position?.amountPkr, 4_000n);
    assert.equal(position?.openedOn, "2026-01-01", "must still count from January");
  });

  it("moves to the next lot once the oldest is fully repaid", () => {
    const transactions = [txn("t1", "2026-01-01"), txn("t2", "2026-06-01"), txn("t3", "2026-07-01")];
    const entries = [
      entry("e1", "t1", "recv", 5_000n, { counterparty_id: "ali" }),
      entry("e1b", "t1", "cash", -5_000n),
      entry("e2", "t2", "recv", 3_000n, { counterparty_id: "ali" }),
      entry("e2b", "t2", "cash", -3_000n),
      entry("e3", "t3", "recv", -5_000n, { counterparty_id: "ali" }),
      entry("e3b", "t3", "cash", 5_000n),
    ];
    const snapshot = buildSnapshot(accounts, people, [], transactions, entries, []);
    const [position] = debtPositions(snapshot);
    assert.equal(position?.amountPkr, 3_000n);
    assert.equal(position?.openedOn, "2026-06-01");
  });

  it("drops a settled counterparty entirely", () => {
    const entries = [
      entry("e1", "t1", "recv", 5_000n, { counterparty_id: "ali" }),
      entry("e1b", "t1", "cash", -5_000n),
      entry("e2", "t2", "recv", -5_000n, { counterparty_id: "ali" }),
      entry("e2b", "t2", "cash", 5_000n),
    ];
    const snapshot = buildSnapshot(
      accounts,
      people,
      [],
      [txn("t1", "2026-01-01"), txn("t2", "2026-02-01")],
      entries,
      [],
    );
    assert.equal(debtPositions(snapshot).length, 0);
  });

  it("reads a payable as money I owe", () => {
    const entries = [
      entry("e1", "t1", "pay", -8_000n, { counterparty_id: "bilal", due_on: "2026-03-01" }),
      entry("e1b", "t1", "cash", 8_000n),
    ];
    const snapshot = buildSnapshot(accounts, people, [], [txn("t1", "2026-01-01")], entries, []);
    const [position] = debtPositions(snapshot);
    assert.equal(position?.direction, "i_owe");
    assert.equal(position?.amountPkr, 8_000n);
    assert.equal(position?.dueOn, "2026-03-01");
    assert.equal(position?.counterparty.kind, "float_client");
  });

  it("ignores a counterparty tagged on an expense", () => {
    const withExpense = [...accounts, account("exp", "Expenses", "expense")];
    const entries = [
      entry("e1", "t1", "exp", 1_000n, { counterparty_id: "ali" }),
      entry("e1b", "t1", "cash", -1_000n),
    ];
    const snapshot = buildSnapshot(withExpense, people, [], [txn("t1", "2026-01-01")], entries, []);
    assert.equal(debtPositions(snapshot).length, 0, "an expense note is not a debt");
  });

  it("never lets a soft-deleted transaction affect a balance", () => {
    const deleted: TransactionRow = { ...txn("t2", "2026-02-01"), deleted_at: AT };
    const entries = [
      entry("e1", "t1", "recv", 5_000n, { counterparty_id: "ali" }),
      entry("e1b", "t1", "cash", -5_000n),
      entry("e2", "t2", "recv", 9_000n, { counterparty_id: "ali" }),
      entry("e2b", "t2", "cash", -9_000n),
    ];
    const snapshot = buildSnapshot(accounts, people, [], [txn("t1", "2026-01-01"), deleted], entries, []);
    const [position] = debtPositions(snapshot);
    assert.equal(position?.amountPkr, 5_000n);
  });
});

describe("composeEntries", () => {
  const accounts = [
    account("cash", "Cash", "asset"),
    account("exp", "Expenses", "expense"),
    account("inc", "Salary", "income"),
    account("recv", "Receivables", "asset"),
    account("pay", "Payables", "liability"),
  ];
  const snapshot = buildSnapshot(
    accounts,
    [counterparty("ali", "Ali")],
    [category("groceries", "Groceries")],
    [],
    [],
    [],
  );

  it("balances an expense and puts the envelope on the entry, not an account", async () => {
    const entries = await composeEntries(snapshot, {
        bookedOn: "2026-09-17",
        direction: "out",
      kind: "expense",
      amount: 45_000n,
      accountId: "cash",
      categoryId: "groceries",
    });
    assert.equal(entries.reduce((total, e) => total + e.amount_minor, 0n), 0n);
    const contra = entries.find((e) => e.account_id === "exp");
    assert.equal(contra?.amount_minor, 45_000n);
    assert.equal(contra?.category_id, "groceries");
    // The category is a dimension on the entry; there is no "Groceries" account.
    assert.equal(accounts.some((a) => a.name === "Groceries"), false);
  });

  it("treats lending as a move between assets, not an expense", async () => {
    const entries = await composeEntries(snapshot, {
      bookedOn: "2026-09-17",
      direction: "out",
      kind: "lend",
      amount: 5_000n,
      accountId: "cash",
      counterpartyId: "ali",
    });
    assert.equal(entries.reduce((total, e) => total + e.amount_minor, 0n), 0n);
    const contra = entries.find((e) => e.account_id === "recv");
    assert.equal(contra?.amount_minor, 5_000n);
    assert.equal(contra?.counterparty_id, "ali");
  });

  it("refuses a loan with nobody attached to it", async () => {
    await assert.rejects(
      composeEntries(snapshot, {
        bookedOn: "2026-09-17",
        direction: "out",
        kind: "lend",
        amount: 5_000n,
        accountId: "cash",
      }),
      /who this is with/,
    );
  });

  it("refuses a zero amount", async () => {
    await assert.rejects(
      composeEntries(snapshot, {
        bookedOn: "2026-09-17",
        direction: "out",
        kind: "expense",
        amount: 0n,
        accountId: "cash",
      }),
      /Enter an amount/,
    );
  });
});

describe("decompose", () => {
  const accounts = [
    account("cash", "Cash", "asset"),
    account("exp", "Expenses", "expense"),
    account("recv", "Receivables", "asset"),
    account("equity", "Equity:Opening", "equity"),
  ];

  it("reopens a simple expense in the same shape it was written", () => {
    const entries = [
      entry("e1", "t1", "cash", -45_000n),
      entry("e2", "t1", "exp", 45_000n, { category_id: "groceries" }),
    ];
    const snapshot = buildSnapshot(
      accounts,
      [],
      [category("groceries", "Groceries")],
      [txn("t1", "2026-09-17", "Bakery")],
      entries,
      [],
    );
    const draft = decompose(snapshot, "t1");
    assert.equal(draft?.direction, "out");
    assert.equal(draft?.kind, "expense");
    assert.equal(draft?.amount, 45_000n);
    assert.equal(draft?.accountId, "cash");
    assert.equal(draft?.categoryId, "groceries");
  });

  it("distinguishes a repayment received from ordinary income", () => {
    const entries = [
      entry("e1", "t1", "cash", 4_000n),
      entry("e2", "t1", "recv", -4_000n, { counterparty_id: "ali" }),
    ];
    const snapshot = buildSnapshot(accounts, [counterparty("ali", "Ali")], [], [txn("t1", "2026-09-17")], entries, []);
    const draft = decompose(snapshot, "t1");
    assert.equal(draft?.kind, "receive_repayment");
    assert.equal(draft?.counterpartyId, "ali");
  });

  it("declines anything the quick form cannot represent", () => {
    const entries = [
      entry("e1", "t1", "cash", 100_000n),
      entry("e2", "t1", "recv", 5_000n),
      entry("e3", "t1", "equity", -105_000n),
    ];
    const snapshot = buildSnapshot(accounts, [], [], [txn("t1", "2026-01-01", "Opening balances")], entries, []);
    assert.equal(decompose(snapshot, "t1"), null);
  });
});

describe("toLogRow", () => {
  const accounts = [
    account("cash", "Cash", "asset"),
    account("bank", "Meezan", "asset"),
    account("exp", "Expenses", "expense"),
  ];

  it("labels a two-account movement as a transfer", () => {
    const entries = [entry("e1", "t1", "cash", -10_000n), entry("e2", "t1", "bank", 10_000n)];
    const snapshot = buildSnapshot(accounts, [], [], [txn("t1", "2026-09-17")], entries, []);
    const row = toLogRow(snapshot, snapshot.transactions[0] as TransactionRow);
    assert.equal(row.direction, "transfer");
    assert.equal(row.account?.id, "cash", "shown leaving the source account");
    assert.equal(row.amount, 10_000n);
  });

  it("summarises a split without inventing a direction", () => {
    const withEquity = [...accounts, account("equity", "Equity:Opening", "equity")];
    const entries = [
      entry("e1", "t1", "cash", 25_000n),
      entry("e2", "t1", "bank", 310_000n),
      entry("e3", "t1", "equity", -335_000n),
    ];
    const snapshot = buildSnapshot(withEquity, [], [], [txn("t1", "2026-01-01", "Opening balances")], entries, []);
    const row = toLogRow(snapshot, snapshot.transactions[0] as TransactionRow);
    assert.equal(row.direction, "split");
    assert.equal(row.amount, 335_000n, "the money that moved, not one arbitrary leg");
    assert.equal(row.lineCount, 3);
    // No single account, category or counterparty can describe a split.
    assert.equal(row.account, null);
    assert.equal(row.category, null);
    assert.equal(row.counterparty, null);
  });

  it("reports an outflow with a positive amount and an out direction", () => {
    const entries = [entry("e1", "t1", "cash", -45_000n), entry("e2", "t1", "exp", 45_000n)];
    const snapshot = buildSnapshot(accounts, [], [], [txn("t1", "2026-09-17")], entries, []);
    const row = toLogRow(snapshot, snapshot.transactions[0] as TransactionRow);
    assert.equal(row.direction, "out");
    assert.equal(row.amount, 45_000n);
  });
});
