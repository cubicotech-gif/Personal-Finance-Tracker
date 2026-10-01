"use client";

import { useMemo, useState } from "react";
import { Button, Card, Chip, ChipRow, ErrorNote, Input, SectionTitle } from "@/components/ui";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { postTransaction } from "@/lib/db/mutations";
import { accountsByUsage, composeReconcile } from "@/lib/ledger/compose";
import { today } from "@/lib/dates";
import { parseAmount, type Currency } from "@/lib/money";

/**
 * "I have this much cash in hand." Anything the ledger cannot explain goes to
 * Expense:Unaccounted rather than quietly adjusting a balance.
 */
export function Reconcile({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
      <p className="text-muted">The difference is booked to Expense:Unaccounted.</p>
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
