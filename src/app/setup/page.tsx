"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, Chip, ErrorNote, Input, Label, SectionTitle, Select, cx } from "@/components/ui";
import { useApp } from "@/lib/sync/provider";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { dropHeader, parseRows } from "@/lib/paste";
import { today } from "@/lib/dates";
import {
  ACCOUNT_TYPES,
  accountRowsFromPaste,
  blankAccount,
  blankCounterparty,
  blankDebt,
  commitSetup,
  counterpartyRowsFromPaste,
  debtRowsFromPaste,
  validateSetup,
  type AccountDraftRow,
  type CounterpartyDraftRow,
  type DebtDraftRow,
} from "@/lib/setup";

/** A paste target that appends parsed spreadsheet rows to a section. */
function PasteBox({
  hint,
  example,
  onRows,
  headerHints,
}: {
  hint: string;
  example: string;
  headerHints: string[];
  onRows: (rows: string[][]) => void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-accent underline">
        Paste from spreadsheet
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        {hint}
        <br />
        <code className="mt-1 inline-block whitespace-pre rounded bg-canvas px-1.5 py-1 text-[11px] leading-5">
          {example}
        </code>
      </p>
      <textarea
        autoFocus
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste cells here"
        className="w-full rounded-lg border border-line bg-surface p-3 font-mono text-sm focus:border-ink focus:outline-none"
      />
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() => {
            const rows = dropHeader(parseRows(text), headerHints);
            if (rows.length > 0) onRows(rows);
            setText("");
            setOpen(false);
          }}
          disabled={text.trim() === ""}
        >
          Add rows
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function RowShell({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <Card className="p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-2">{children}</div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove row"
          className="shrink-0 rounded-lg px-2 py-1 text-muted hover:bg-canvas hover:text-danger"
        >
          ✕
        </button>
      </div>
    </Card>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const { auth } = useApp();
  const snapshot = useSnapshot();

  const [asOf, setAsOf] = useState(today);
  const [usdRate, setUsdRate] = useState("");
  const [accounts, setAccounts] = useState<AccountDraftRow[]>([blankAccount()]);
  const [counterparties, setCounterparties] = useState<CounterpartyDraftRow[]>([]);
  const [debts, setDebts] = useState<DebtDraftRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (auth === "signed-out") router.replace("/login");
  }, [auth, router]);

  const input = useMemo(
    () => ({ asOf, accounts, counterparties, debts, usdRate }),
    [asOf, accounts, counterparties, debts, usdRate],
  );

  const usesUsd = accounts.some((row) => row.currency === "USD");

  function patch<T>(setter: (fn: (rows: T[]) => T[]) => void, index: number, change: Partial<T>) {
    setter((rows) => rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
  }

  async function onSubmit() {
    const found = validateSetup(input, snapshot);
    setErrors(found);
    if (found.length > 0) return;

    setBusy(true);
    try {
      await commitSetup(input, snapshot);
      router.replace("/log");
    } catch (cause) {
      setErrors([cause instanceof Error ? cause.message : "Could not save opening balances"]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-6 pb-24">
      <h1 className="text-xl font-semibold">Opening balances</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Everything below is written as one balanced transaction against Equity:Opening, dated the as-of
        date. You can re-run this later to add accounts; existing ones are matched by name.
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="asof">As of</Label>
          <Input id="asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
        {usesUsd && (
          <div>
            <Label htmlFor="rate">PKR per USD</Label>
            <Input
              id="rate"
              inputMode="decimal"
              placeholder="278.50"
              value={usdRate}
              onChange={(e) => setUsdRate(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Accounts ---------------------------------------------------------- */}
      <section className="mb-8">
        <SectionTitle>Accounts</SectionTitle>
        <div className="space-y-2">
          {accounts.map((row, index) => (
            <RowShell
              key={index}
              onRemove={() => setAccounts((rows) => rows.filter((_, i) => i !== index))}
            >
              <Input
                placeholder="Account name"
                value={row.name}
                onChange={(e) => patch(setAccounts, index, { name: e.target.value })}
              />
              <div className="grid grid-cols-3 gap-2">
                <Select
                  aria-label="Type"
                  value={row.type}
                  onChange={(e) => patch(setAccounts, index, { type: e.target.value })}
                >
                  {ACCOUNT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Currency"
                  value={row.currency}
                  onChange={(e) => patch(setAccounts, index, { currency: e.target.value })}
                >
                  <option value="PKR">PKR</option>
                  <option value="USD">USD</option>
                </Select>
                <Input
                  aria-label="Opening balance"
                  inputMode="decimal"
                  placeholder="Opening"
                  value={row.opening}
                  onChange={(e) => patch(setAccounts, index, { opening: e.target.value })}
                />
              </div>
              <Chip
                selected={row.isFloat}
                onClick={() => patch(setAccounts, index, { isFloat: !row.isFloat })}
              >
                {row.isFloat ? "✓ " : ""}Held for others (float)
              </Chip>
            </RowShell>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-4">
          <Button type="button" onClick={() => setAccounts((rows) => [...rows, blankAccount()])}>
            Add account
          </Button>
          <PasteBox
            hint="Columns: name, type, currency, float (yes/no), opening balance."
            example={"Cash\tasset\tPKR\tno\t25000\nMeezan\tasset\tPKR\tno\t310000\nClient float\tliability\tPKR\tyes\t80000"}
            headerHints={["name", "type", "currency", "opening"]}
            onRows={(rows) => setAccounts((current) => [...current.filter((r) => r.name.trim() !== ""), ...accountRowsFromPaste(rows)])}
          />
        </div>
      </section>

      {/* People ------------------------------------------------------------ */}
      <section className="mb-8">
        <SectionTitle>People and float clients</SectionTitle>
        <div className="space-y-2">
          {counterparties.map((row, index) => (
            <RowShell
              key={index}
              onRemove={() => setCounterparties((rows) => rows.filter((_, i) => i !== index))}
            >
              <Input
                placeholder="Name"
                value={row.name}
                onChange={(e) => patch(setCounterparties, index, { name: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-2">
                <Select
                  aria-label="Kind"
                  value={row.kind}
                  onChange={(e) => patch(setCounterparties, index, { kind: e.target.value })}
                >
                  <option value="person">Person</option>
                  <option value="float_client">Float client</option>
                </Select>
                <Input
                  placeholder="Notes"
                  value={row.notes}
                  onChange={(e) => patch(setCounterparties, index, { notes: e.target.value })}
                />
              </div>
            </RowShell>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-4">
          <Button type="button" onClick={() => setCounterparties((rows) => [...rows, blankCounterparty()])}>
            Add person
          </Button>
          <PasteBox
            hint="Columns: name, kind (person / float_client), notes."
            example={"Ali\tperson\nBilal Traders\tfloat_client\tweekly settle"}
            headerHints={["name", "kind", "notes"]}
            onRows={(rows) => setCounterparties((current) => [...current.filter((r) => r.name.trim() !== ""), ...counterpartyRowsFromPaste(rows)])}
          />
        </div>
      </section>

      {/* Debts ------------------------------------------------------------- */}
      <section className="mb-8">
        <SectionTitle>Money already owed</SectionTitle>
        <p className="mb-2 text-xs text-muted">
          Booked to Receivables / Payables, or to Client float for a float client. All PKR.
        </p>
        <div className="space-y-2">
          {debts.map((row, index) => (
            <RowShell key={index} onRemove={() => setDebts((rows) => rows.filter((_, i) => i !== index))}>
              <Input
                placeholder="Name (must match a person above)"
                value={row.name}
                onChange={(e) => patch(setDebts, index, { name: e.target.value })}
              />
              <div className="grid grid-cols-3 gap-2">
                <Select
                  aria-label="Direction"
                  value={row.direction}
                  onChange={(e) => patch(setDebts, index, { direction: e.target.value })}
                >
                  <option value="owes_me">Owes me</option>
                  <option value="i_owe">I owe</option>
                </Select>
                <Input
                  aria-label="Amount"
                  inputMode="decimal"
                  placeholder="Amount"
                  value={row.amount}
                  onChange={(e) => patch(setDebts, index, { amount: e.target.value })}
                />
                <Input
                  aria-label="Due date"
                  type="date"
                  value={row.due}
                  onChange={(e) => patch(setDebts, index, { due: e.target.value })}
                />
              </div>
            </RowShell>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-4">
          <Button type="button" onClick={() => setDebts((rows) => [...rows, blankDebt()])}>
            Add debt
          </Button>
          <PasteBox
            hint="Columns: name, direction (owes_me / i_owe), amount, due date."
            example={"Ali\towes_me\t5000\t2026-10-01\nBilal Traders\ti_owe\t80000"}
            headerHints={["name", "direction", "amount", "due"]}
            onRows={(rows) => setDebts((current) => [...current.filter((r) => r.name.trim() !== ""), ...debtRowsFromPaste(rows)])}
          />
        </div>
      </section>

      {errors.length > 0 && (
        <div className="mb-4 space-y-1">
          {errors.map((error) => (
            <ErrorNote key={error}>{error}</ErrorNote>
          ))}
        </div>
      )}

      <div className={cx("sticky bottom-0 -mx-4 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur")}>
        <Button type="button" variant="primary" className="w-full" onClick={onSubmit} disabled={busy}>
          {busy ? "Saving…" : "Save opening balances"}
        </Button>
      </div>
    </main>
  );
}
