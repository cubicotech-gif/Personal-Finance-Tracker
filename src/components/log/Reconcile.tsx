"use client";

import { useMemo, useState } from "react";
import { Button, Card, Chip, ChipRow, ErrorNote, Input, SectionTitle } from "@/components/ui";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { postTransaction } from "@/lib/db/mutations";
import { accountsByUsage, composeReconcile } from "@/lib/ledger/compose";
import { RECONCILE_PAYEE, checkedKey } from "@/lib/ledger/balance-check";
import { setMeta } from "@/lib/db/dexie";
import { today } from "@/lib/dates";
import { parseAmount, type Currency } from "@/lib/money";

/**
 * "I have this much cash in hand." Anything the ledger cannot explain goes to
 * Expense:Unaccounted rather than quietly adjusting a balance.
 */
export function Reconcile({
  open,
  onOpenChange,
  /** Preselect an account, so /accounts can send you straight to one. */
  accountId: requested,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId?: string;
}) {
  const snapshot = useSnapshot();
  const accounts = useMemo(() => accountsByUsage(snapshot).filter((a) => a.type === "asset"), [snapshot]);
  const [chosenId, setChosenId] = useState("");
  const [actual, setActual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Derived, so the default survives the snapshot arriving after first render.
  const accountId = chosenId || requested || accounts[0]?.id || "";

  if (!open) {
    return (
      <button type="button" onClick={() => onOpenChange(true)} className="min-h-11 text-muted underline">
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

      // Record the check either way. A reconcile that finds a difference
      // leaves a transaction, but "I looked and it was right" posts nothing —
      // and that is the usual outcome, and exactly what the balance-check
      // prompt needs to know in order to stop nagging.
      await setMeta(checkedKey(accountId), today());

      if (result) {
        await postTransaction({
          booked_on: today(),
          payee: RECONCILE_PAYEE,
          note: "Counted cash in hand",
          entries: result.entries,
        });
      }
      onOpenChange(false);
      setChosenId("");
      setActual("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reconcile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
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
      <p className="text-muted">
        Any difference is booked to Expense:Unaccounted. If it already matches, nothing is
        recorded except that you checked.
      </p>
      <ErrorNote>{error}</ErrorNote>
      <div className="flex gap-2">
        <Button type="button" variant="primary" onClick={submit} className="flex-1" disabled={busy}>
          Confirm balance
        </Button>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
