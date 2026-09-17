"use client";

import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import { Guard, Shell } from "@/components/Shell";
import { Money } from "@/components/Money";
import { Button, Card, Chip, ChipRow, Empty, ErrorNote, Input, Label, SectionTitle, cx } from "@/components/ui";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { deleteTransaction, postTransaction, restoreTransaction } from "@/lib/db/mutations";
import {
  KIND_LABEL,
  accountsByUsage,
  composeEntries,
  composeReconcile,
  decompose,
  kindsFor,
  type LogDraft,
  type MoneyKind,
} from "@/lib/ledger/compose";
import { describe, recentLogRows, type LogRow } from "@/lib/ledger/log";
import { mostUsedAccountId } from "@/lib/ledger/accounts";
import { formatRelativeDay, today } from "@/lib/dates";
import { formatMinor, parseAmount, type Currency } from "@/lib/money";

/**
 * /log is the screen that decides whether this app gets used. The target is
 * under five seconds from opening it to a saved transaction, so:
 *
 *  - the amount field is focused on arrival and takes the numeric keypad
 *  - account and category are chips, not selects: one tap, no picker sheet
 *  - the defaults (today, most-used account, last direction) are usually right
 *  - the save is a local IndexedDB write, so it returns immediately and the
 *    network is somebody else's problem
 *  - after saving, everything except the amount is kept, because the next
 *    transaction is usually a lot like the last one
 */

interface FormState {
  amount: string;
  direction: "in" | "out";
  kind: MoneyKind;
  accountId: string;
  categoryId: string | null;
  incomeAccountId: string | null;
  counterpartyId: string | null;
  payee: string;
  note: string;
  bookedOn: string;
  editingId: string | null;
}

function initialForm(): FormState {
  return {
    amount: "",
    direction: "out",
    kind: "expense",
    accountId: "",
    categoryId: null,
    incomeAccountId: null,
    counterpartyId: null,
    payee: "",
    note: "",
    bookedOn: today(),
    editingId: null,
  };
}

export default function LogPage() {
  return (
    <Guard>
      <Shell title="Log">
        <LogScreen />
      </Shell>
    </Guard>
  );
}

function LogScreen() {
  const snapshot = useSnapshot();
  const [form, setForm] = useState<FormState>(initialForm);
  const [showMore, setShowMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const accounts = useMemo(() => accountsByUsage(snapshot), [snapshot]);
  const incomeAccounts = useMemo(
    () => snapshot.accounts.filter((account) => account.type === "income" && !account.archived),
    [snapshot],
  );
  const rows = useMemo(() => recentLogRows(snapshot, 50), [snapshot]);

  // The account and the kind are DERIVED, not stored-then-corrected. The form
  // only remembers an explicit choice; the default account and the fallback
  // when a kind stops being applicable (because the counterparty was cleared)
  // are computed on render, so they can never be briefly out of step.
  const accountId = form.accountId || mostUsedAccountId(snapshot) || "";
  const account = snapshot.accountsById.get(accountId);
  const currency: Currency = account?.currency ?? "PKR";
  const kinds = kindsFor(form.direction, Boolean(form.counterpartyId));
  const kind = kinds.includes(form.kind) ? form.kind : (kinds[0] ?? "expense");

  const patch = useCallback((change: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...change }));
  }, []);

  function reset(keepContext = true) {
    // The next transaction is usually like the last one, so the account and
    // direction stay; the kind falls back through the derivation above.
    setForm((current) =>
      keepContext
        ? { ...initialForm(), accountId: current.accountId, direction: current.direction }
        : initialForm(),
    );
    setShowMore(false);
    amountRef.current?.focus();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    // A double tap on Add would otherwise post two transactions with different
    // ids, and the ledger has no way to tell them apart afterwards.
    if (saving) return;
    setError(null);

    const amount = parseAmount(form.amount, currency);
    if (amount === null || amount <= 0n) {
      setError("Enter an amount");
      amountRef.current?.focus();
      return;
    }

    const draft: LogDraft = {
      bookedOn: form.bookedOn,
      direction: form.direction,
      kind,
      amount,
      accountId,
      categoryId: kind === "expense" ? form.categoryId : null,
      counterpartyId: form.counterpartyId,
      incomeAccountId: form.incomeAccountId,
      payee: form.payee,
      note: form.note,
    };

    setSaving(true);
    try {
      const entries = await composeEntries(snapshot, draft);
      await postTransaction({
        id: form.editingId ?? undefined,
        booked_on: form.bookedOn,
        payee: form.payee,
        note: form.note,
        entries,
      });
      reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  function editRow(row: LogRow) {
    const draft = decompose(snapshot, row.transaction.id);
    if (!draft) {
      setError("This transaction has more than two lines — delete it and re-enter if it needs a change.");
      return;
    }
    setError(null);
    // Round-trip the amount as text, never through a JS number. formatMinor's
    // thousands separators are stripped again by parseAmount on save.
    const editCurrency = snapshot.accountsById.get(draft.accountId)?.currency ?? "PKR";
    setForm({
      amount: formatMinor(draft.amount, editCurrency, { symbol: false }),
      direction: draft.direction,
      kind: draft.kind,
      accountId: draft.accountId,
      categoryId: draft.categoryId ?? null,
      incomeAccountId: draft.incomeAccountId ?? null,
      counterpartyId: draft.counterpartyId ?? null,
      payee: draft.payee ?? "",
      note: draft.note ?? "",
      bookedOn: draft.bookedOn,
      editingId: row.transaction.id,
    });
    setShowMore(Boolean(draft.counterpartyId || draft.note || draft.payee));
    window.scrollTo({ top: 0, behavior: "smooth" });
    amountRef.current?.focus();
  }

  async function removeRow(row: LogRow) {
    await deleteTransaction(row.transaction.id);
    setUndoId(row.transaction.id);
    if (form.editingId === row.transaction.id) reset(false);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="space-y-4">
        {/* Amount ------------------------------------------------------- */}
        <div className="flex items-center gap-3">
          <span className="text-2xl text-muted">{currency === "PKR" ? "Rs" : "$"}</span>
          <input
            ref={amountRef}
            autoFocus
            inputMode="decimal"
            enterKeyHint="done"
            aria-label="Amount"
            placeholder="0"
            value={form.amount}
            onChange={(e) => patch({ amount: e.target.value })}
            className="tabular w-full bg-transparent text-4xl font-semibold tracking-tight outline-none placeholder:text-line"
          />
        </div>

        {/* Direction ---------------------------------------------------- */}
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Direction">
          {(["out", "in"] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              aria-pressed={form.direction === direction}
              onClick={() => patch({ direction })}
              className={cx(
                "min-h-11 rounded-lg border text-sm font-medium transition-colors",
                form.direction === direction
                  ? direction === "out"
                    ? "border-danger bg-danger-soft text-danger"
                    : "border-accent bg-accent-soft text-accent"
                  : "border-line bg-surface text-muted",
              )}
            >
              {direction === "out" ? "Money out" : "Money in"}
            </button>
          ))}
        </div>

        {/* Account ------------------------------------------------------ */}
        <div>
          <Label>Account</Label>
          <ChipRow label="Account">
            {accounts.map((option) => (
              <Chip
                key={option.id}
                selected={accountId === option.id}
                onClick={() => patch({ accountId: option.id })}
              >
                {option.name}
              </Chip>
            ))}
          </ChipRow>
        </div>

        {/* Kind, only when a counterparty makes it ambiguous ------------- */}
        {kinds.length > 1 && (
          <div>
            <Label>This is</Label>
            <ChipRow label="Kind">
              {kinds.map((option) => (
                <Chip key={option} selected={kind === option} onClick={() => patch({ kind: option })}>
                  {KIND_LABEL[option]}
                </Chip>
              ))}
            </ChipRow>
          </div>
        )}

        {/* Category (out) or source (in) -------------------------------- */}
        {kind === "expense" && (
          <div>
            <Label>Category</Label>
            <ChipRow label="Category">
              {snapshot.categories
                .filter((category) => !category.archived)
                .map((category) => (
                  <Chip
                    key={category.id}
                    selected={form.categoryId === category.id}
                    onClick={() =>
                      patch({ categoryId: form.categoryId === category.id ? null : category.id })
                    }
                  >
                    {category.icon} {category.name}
                  </Chip>
                ))}
            </ChipRow>
          </div>
        )}

        {kind === "income" && incomeAccounts.length > 0 && (
          <div>
            <Label>Source</Label>
            <ChipRow label="Source">
              {incomeAccounts.map((source) => (
                <Chip
                  key={source.id}
                  selected={form.incomeAccountId === source.id}
                  onClick={() =>
                    patch({ incomeAccountId: form.incomeAccountId === source.id ? null : source.id })
                  }
                >
                  {source.name}
                </Chip>
              ))}
            </ChipRow>
          </div>
        )}

        {/* Everything optional lives behind one tap ---------------------- */}
        {!showMore ? (
          <button type="button" onClick={() => setShowMore(true)} className="text-sm text-muted underline">
            Add who, note or date
          </button>
        ) : (
          <div className="space-y-3 rounded-lg border border-line bg-surface p-3">
            <div>
              <Label>Who</Label>
              <ChipRow label="Counterparty">
                {snapshot.counterparties.map((counterparty) => (
                  <Chip
                    key={counterparty.id}
                    selected={form.counterpartyId === counterparty.id}
                    onClick={() =>
                      patch({
                        counterpartyId:
                          form.counterpartyId === counterparty.id ? null : counterparty.id,
                      })
                    }
                  >
                    {counterparty.name}
                  </Chip>
                ))}
                {snapshot.counterparties.length === 0 && (
                  <span className="py-2 text-sm text-muted">Add people in setup</span>
                )}
              </ChipRow>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                aria-label="Payee"
                placeholder="Payee"
                value={form.payee}
                onChange={(e) => patch({ payee: e.target.value })}
              />
              <Input
                aria-label="Date"
                type="date"
                value={form.bookedOn}
                onChange={(e) => patch({ bookedOn: e.target.value })}
              />
            </div>
            <Input
              aria-label="Note"
              placeholder="Note"
              value={form.note}
              onChange={(e) => patch({ note: e.target.value })}
            />
          </div>
        )}

        <ErrorNote>{error}</ErrorNote>

        <div className="flex gap-2">
          <Button type="submit" variant="primary" className="flex-1" disabled={saving}>
            {form.editingId ? "Save changes" : "Add"}
          </Button>
          {form.editingId && (
            <Button type="button" variant="ghost" onClick={() => reset(false)}>
              Cancel
            </Button>
          )}
        </div>
      </form>

      {/* Reconcile -------------------------------------------------------- */}
      <Reconcile open={reconciling} onOpenChange={setReconciling} />

      {/* Recent ----------------------------------------------------------- */}
      <section>
        <SectionTitle>Recent</SectionTitle>
        {undoId && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-canvas px-3 py-2 text-sm">
            <span className="text-muted">Deleted.</span>
            <button
              type="button"
              className="font-medium text-accent underline"
              onClick={async () => {
                await restoreTransaction(undoId);
                setUndoId(null);
              }}
            >
              Undo
            </button>
          </div>
        )}
        {rows.length === 0 ? (
          <Empty>Nothing logged yet.</Empty>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {rows.map((row) => (
              <LogListRow key={row.transaction.id} row={row} onEdit={editRow} onDelete={removeRow} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function LogListRow({
  row,
  onEdit,
  onDelete,
}: {
  row: LogRow;
  onEdit: (row: LogRow) => void;
  onDelete: (row: LogRow) => void;
}) {
  // Only a plain in/out gets a sign. A transfer nets to zero across my own
  // accounts and a split has no single direction, so signing either would be
  // asserting something untrue.
  const signed = row.direction === "in" || row.direction === "out";
  const inbound = row.direction === "in";

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <button type="button" onClick={() => onEdit(row)} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium">{describe(row)}</span>
        <span className="block truncate text-xs text-muted">
          {formatRelativeDay(row.transaction.booked_on)}
          {row.direction === "split" ? ` · ${row.lineCount} lines` : ""}
          {row.account ? ` · ${row.account.name}` : ""}
          {row.category ? ` · ${row.category.name}` : ""}
          {row.counterparty ? ` · ${row.counterparty.name}` : ""}
        </span>
      </button>
      <Money
        amount={signed && !inbound ? -row.amount : row.amount}
        currency={row.currency}
        signed={signed}
        compact
        tone={signed ? (inbound ? "positive" : "auto") : "plain"}
        className="shrink-0 text-sm font-medium"
      />
      <button
        type="button"
        onClick={() => onDelete(row)}
        aria-label={`Delete ${describe(row)}`}
        className="shrink-0 rounded-lg px-2 py-1 text-muted hover:bg-canvas hover:text-danger"
      >
        ✕
      </button>
    </li>
  );
}

/**
 * "I have this much cash in hand." Anything the ledger cannot explain goes to
 * Expense:Unaccounted rather than quietly adjusting a balance.
 */
function Reconcile({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const snapshot = useSnapshot();
  const accounts = useMemo(() => accountsByUsage(snapshot).filter((a) => a.type === "asset"), [snapshot]);
  const [chosenId, setChosenId] = useState("");
  const [actual, setActual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Derived, so the default survives the snapshot arriving after first render.
  const accountId = chosenId || accounts[0]?.id || "";

  if (!open) {
    return (
      <button type="button" onClick={() => onOpenChange(true)} className="text-sm text-muted underline">
        Reconcile cash in hand
      </button>
    );
  }

  const currency: Currency = snapshot.accountsById.get(accountId)?.currency ?? "PKR";

  async function submit() {
    if (busy) return;
    setError(null);
    const amount = parseAmount(actual, currency);
    if (amount === null) {
      setError("Enter the amount you actually have");
      return;
    }
    setBusy(true);
    try {
      const result = await composeReconcile(snapshot, accountId, amount);
      if (!result) {
        onOpenChange(false);
        setActual("");
        return;
      }
      await postTransaction({
        booked_on: today(),
        payee: "Reconcile",
        note: "Counted cash in hand",
        entries: result.entries,
      });
      onOpenChange(false);
      setActual("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reconcile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-3">
      <SectionTitle>Reconcile</SectionTitle>
      <ChipRow label="Account to reconcile">
        {accounts.map((option) => (
          <Chip key={option.id} selected={accountId === option.id} onClick={() => setChosenId(option.id)}>
            {option.name}
          </Chip>
        ))}
      </ChipRow>
      <Input
        inputMode="decimal"
        aria-label="Actual amount in hand"
        placeholder="Actual amount in hand"
        value={actual}
        onChange={(e) => setActual(e.target.value)}
      />
      <p className="text-xs text-muted">The difference is booked to Expense:Unaccounted.</p>
      <ErrorNote>{error}</ErrorNote>
      <div className="flex gap-2">
        <Button type="button" variant="primary" onClick={submit} className="flex-1" disabled={busy}>
          Book difference
        </Button>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
