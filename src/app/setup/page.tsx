"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { IconX } from "@tabler/icons-react";
import { Button, Card, Chip, ChipRow, ErrorNote, Input, Label, SectionTitle, Segmented } from "@/components/ui";
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

const CURRENCY_OPTIONS = [
  { value: "PKR", label: "PKR" },
  { value: "USD", label: "USD" },
] as const;
const KIND_OPTIONS = [
  { value: "person", label: "Person" },
  { value: "float_client", label: "Float client" },
] as const;
const DIRECTION_OPTIONS = [
  { value: "owes_me", label: "Owes me" },
  { value: "i_owe", label: "I owe" },
] as const;

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
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 text-accent underline">
        Paste from spreadsheet
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">
        {hint}
        <br />
        <code className="mt-1 inline-block whitespace-pre rounded-xl bg-raised px-2 py-1.5 text-[11px] leading-5">
          {example}
        </code>
      </p>
      <textarea
        autoFocus
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste cells here"
        className="w-full rounded-2xl bg-surface p-4 font-mono text-sm focus:outline-2 focus:outline-accent"
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
    <Card className="p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-3">{children}</div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove row"
          className="-mr-2 -mt-2 flex size-11 shrink-0 items-center justify-center rounded-2xl text-muted hover:text-danger"
        >
          <IconX size={20} stroke={1.75} />
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
    <main className="mx-auto max-w-lg px-4 pt-8">
      <h1 className="t-section">Opening balances</h1>
      <p className="mt-2 mb-6 text-muted">
        Everything below is written as one balanced transaction against Equity:Opening, dated the as-of
        date. You can re-run this later to add accounts; existing ones are matched by name.
      </p>

      <div className="mb-8 grid grid-cols-2 gap-3">
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
      <section className="mb-10">
        <SectionTitle>Accounts</SectionTitle>
        <div className="space-y-2">
          {accounts.map((row, index) => (
            <RowShell
              key={index}
              onRemove={() => setAccounts((rows) => rows.filter((_, i) => i !== index))}
            >
              <Input
                placeholder="Account name"
                className="bg-raised"
                value={row.name}
                onChange={(e) => patch(setAccounts, index, { name: e.target.value })}
              />
              <ChipRow label="Type">
                {ACCOUNT_TYPES.map((type) => (
                  <Chip
                    key={type}
                    className={row.type === type ? undefined : "bg-raised"}
                    selected={row.type === type}
                    onClick={() => patch(setAccounts, index, { type })}
                  >
                    {type}
                  </Chip>
                ))}
              </ChipRow>
              <div className="grid grid-cols-2 gap-2">
                <Segmented
                  label="Currency"
                  options={CURRENCY_OPTIONS}
                  value={row.currency === "USD" ? "USD" : "PKR"}
                  onChange={(currency) => patch(setAccounts, index, { currency })}
                />
                <Input
                  aria-label="Opening balance"
                  inputMode="decimal"
                  placeholder="Opening"
                  className="bg-raised"
                  value={row.opening}
                  onChange={(e) => patch(setAccounts, index, { opening: e.target.value })}
                />
              </div>
              <Chip
                className={row.isFloat ? undefined : "bg-raised"}
                selected={row.isFloat}
                onClick={() => patch(setAccounts, index, { isFloat: !row.isFloat })}
              >
                {row.isFloat ? "✓ " : ""}Held for others (float)
              </Chip>
            </RowShell>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
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
      <section className="mb-10">
        <SectionTitle>People and float clients</SectionTitle>
        <div className="space-y-2">
          {counterparties.map((row, index) => (
            <RowShell
              key={index}
              onRemove={() => setCounterparties((rows) => rows.filter((_, i) => i !== index))}
            >
              <Input
                placeholder="Name"
                className="bg-raised"
                value={row.name}
                onChange={(e) => patch(setCounterparties, index, { name: e.target.value })}
              />
              <Segmented
                label="Kind"
                options={KIND_OPTIONS}
                value={row.kind === "float_client" ? "float_client" : "person"}
                onChange={(kind) => patch(setCounterparties, index, { kind })}
              />
              <Input
                placeholder="Notes"
                className="bg-raised"
                value={row.notes}
                onChange={(e) => patch(setCounterparties, index, { notes: e.target.value })}
              />
            </RowShell>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
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
      <section className="mb-10">
        <SectionTitle>Money already owed</SectionTitle>
        <p className="mb-3 text-xs text-muted">
          Booked to Receivables / Payables, or to Client float for a float client. All PKR.
        </p>
        <div className="space-y-2">
          {debts.map((row, index) => (
            <RowShell key={index} onRemove={() => setDebts((rows) => rows.filter((_, i) => i !== index))}>
              <Input
                placeholder="Name (must match a person above)"
                className="bg-raised"
                value={row.name}
                onChange={(e) => patch(setDebts, index, { name: e.target.value })}
              />
              <Segmented
                label="Direction"
                options={DIRECTION_OPTIONS}
                value={row.direction === "i_owe" ? "i_owe" : "owes_me"}
                onChange={(direction) => patch(setDebts, index, { direction })}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  aria-label="Amount"
                  inputMode="decimal"
                  placeholder="Amount"
                  className="bg-raised"
                  value={row.amount}
                  onChange={(e) => patch(setDebts, index, { amount: e.target.value })}
                />
                <Input
                  aria-label="Due date"
                  type="date"
                  className="bg-raised"
                  value={row.due}
                  onChange={(e) => patch(setDebts, index, { due: e.target.value })}
                />
              </div>
            </RowShell>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
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

      <div
        className="sticky bottom-0 -mx-4 bg-canvas px-4 pt-2"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        <Button type="button" variant="primary" className="h-14 w-full" onClick={onSubmit} disabled={busy}>
          {busy ? "Saving…" : "Save opening balances"}
        </Button>
      </div>
    </main>
  );
}
