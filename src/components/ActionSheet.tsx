"use client";

import { useEffect, useMemo, useState } from "react";
import { postTransaction } from "@/lib/db/mutations";
import { parseAmount } from "@/lib/money";
import { today } from "@/lib/dates";
import { accountsByUsage, composeEntries, type LogDraft } from "@/lib/ledger/compose";
import { debtPositions, type DebtPosition } from "@/lib/ledger/people";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { Amount } from "./Amount";
import { Button, Input, Label, Select, cx } from "./ui";

/**
 * The one way money gets into the app.
 *
 * Four actions, which between them cover everything that actually happens:
 * money left, money arrived, money moved between my own pockets, or a debt was
 * settled. Anything more exotic is rare enough to be worth doing by hand later,
 * and a fifth option on this screen would cost a decision every single time.
 *
 * Whatever is chosen, the write goes through composeEntries, so what lands in
 * the database is always a balanced pair of entries. There is no path from this
 * screen to a half-recorded transaction.
 */

export type Action = "expense" | "income" | "transfer" | "settle";

export const ACTION_TITLE: Record<Action, string> = {
  expense: "💸  Money out",
  income: "📥  Money in",
  transfer: "🔄  Move between accounts",
  settle: "🤝  Settle a debt",
};

export function ActionSheet({
  action,
  onClose,
  onDone,
}: {
  action: Action;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const snapshot = useSnapshot();

  const wallets = useMemo(() => accountsByUsage(snapshot), [snapshot]);
  const boxes = useMemo(() => snapshot.categories.filter((c) => !c.archived), [snapshot]);
  const debts = useMemo(() => debtPositions(snapshot, true), [snapshot]);

  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /*
    The pickers hold a choice, not a default.

    The lists come from a live query, so the first render can see none of them.
    Rather than filling the state in from an effect — which costs an extra
    render and goes wrong the moment the list changes underneath — each picker
    keeps whatever was chosen and falls back to the first available option.
    Nothing has to be synchronised, and the form is usable on the very first
    paint.
  */
  const [chosenWallet, setChosenWallet] = useState("");
  const [chosenTarget, setChosenTarget] = useState("");
  const [chosenBox, setChosenBox] = useState("");
  const [chosenDebt, setChosenDebt] = useState("");

  const has = (id: string, list: { id: string }[]) => list.some((item) => item.id === id);

  const walletId = has(chosenWallet, wallets) ? chosenWallet : (wallets[0]?.id ?? "");
  // Moving money needs two different accounts, so the destination never
  // defaults to wherever the money is coming from.
  const targetId =
    has(chosenTarget, wallets) && chosenTarget !== walletId
      ? chosenTarget
      : (wallets.find((wallet) => wallet.id !== walletId)?.id ?? "");
  const boxId = has(chosenBox, boxes) ? chosenBox : (boxes[0]?.id ?? "");

  // Escape closes, as it would on anything modal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const keyOf = (position: DebtPosition) =>
    `${position.counterparty.id}|${position.settlementAccountId ?? ""}|${position.direction}`;
  const selectedDebt = debts.find((position) => keyOf(position) === chosenDebt) ?? debts[0];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const amount = parseAmount(amountText, "PKR");
    if (amount === null || amount <= 0n) {
      setError("Enter an amount");
      return;
    }

    const draft: LogDraft = {
      bookedOn: today(),
      direction: "out",
      kind: "expense",
      amount,
      accountId: walletId,
      payee: note || null,
    };

    if (action === "expense") {
      draft.categoryId = boxId || null;
    } else if (action === "income") {
      draft.direction = "in";
      draft.kind = "income";
    } else if (action === "transfer") {
      draft.direction = "move";
      draft.kind = "transfer";
      draft.toAccountId = targetId;
    } else {
      if (!selectedDebt) {
        setError("Nothing to settle yet");
        return;
      }
      const theyOweMe = selectedDebt.direction === "owes_me";
      draft.direction = theyOweMe ? "in" : "out";
      draft.kind = theyOweMe ? "receive_repayment" : "repay_debt";
      draft.counterpartyId = selectedDebt.counterparty.id;
      draft.debtAccountId = selectedDebt.settlementAccountId;
      draft.payee = draft.payee ?? selectedDebt.counterparty.name;
    }

    setSaving(true);
    try {
      const entries = await composeEntries(snapshot, draft);
      await postTransaction({
        booked_on: draft.bookedOn,
        payee: draft.payee,
        entries,
      });
      onDone(messageFor(action, amountText));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save that");
    } finally {
      setSaving(false);
    }
  }

  const walletLabel =
    action === "income" ? "Received into" : action === "settle" ? "Money through" : "Paid from";

  return (
    <div
      className="fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="rise max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-header p-5 sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={ACTION_TITLE[action]}
      >
        <div className="flex items-center justify-between border-b border-line pb-3">
          <h3 className="text-base font-bold text-white">{ACTION_TITLE[action]}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-9 items-center justify-center rounded-full bg-raised font-bold text-muted hover:text-ink"
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 pt-4">
          <div>
            <Label htmlFor="amount">Amount (PKR)</Label>
            <Input
              id="amount"
              /*
                Not type="number": a number input hands back a float, and money
                here is never a float. This takes the digits as typed and parses
                them into minor units exactly.
              */
              inputMode="decimal"
              autoFocus
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              placeholder="e.g. 5000"
              className="num text-lg"
            />
          </div>

          {action === "expense" && (
            <div>
              <Label htmlFor="box">Which box</Label>
              <Select id="box" value={boxId} onChange={(event) => setChosenBox(event.target.value)}>
                {boxes.map((box) => (
                  <option key={box.id} value={box.id}>
                    {box.icon} {box.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {action === "settle" && (
            <div>
              <Label htmlFor="debt">Which debt</Label>
              <Select
                id="debt"
                value={selectedDebt ? keyOf(selectedDebt) : ""}
                onChange={(event) => setChosenDebt(event.target.value)}
              >
                {debts.length === 0 && <option value="">No debts recorded</option>}
                {debts.map((position) => (
                  <option key={keyOf(position)} value={keyOf(position)}>
                    {position.direction === "owes_me" ? "← " : "→ "}
                    {position.counterparty.name}
                    {position.klass === "callable" ? " (callable)" : ""}
                  </option>
                ))}
              </Select>
              {selectedDebt && (
                <p className="mt-1.5 text-xs text-muted">
                  {selectedDebt.direction === "owes_me" ? "They owe you " : "You owe "}
                  <Amount amount={selectedDebt.amountPkr} tone="ink" />
                  {" — this will "}
                  {selectedDebt.direction === "owes_me" ? "reduce it" : "pay it down"}.
                </p>
              )}
            </div>
          )}

          {action === "transfer" ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="from">From</Label>
                <Select id="from" value={walletId} onChange={(event) => setChosenWallet(event.target.value)}>
                  {wallets.map((wallet) => (
                    <option key={wallet.id} value={wallet.id}>
                      {wallet.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="to">To</Label>
                <Select id="to" value={targetId} onChange={(event) => setChosenTarget(event.target.value)}>
                  {wallets.map((wallet) => (
                    <option key={wallet.id} value={wallet.id}>
                      {wallet.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          ) : (
            <div>
              <Label htmlFor="wallet">{walletLabel}</Label>
              <Select id="wallet" value={walletId} onChange={(event) => setChosenWallet(event.target.value)}>
                {wallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {(action === "income" || action === "expense") && (
            <div>
              <Label htmlFor="note">{action === "income" ? "Where from" : "What for"}</Label>
              <Input
                id="note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={action === "income" ? "e.g. Billoo salary" : "e.g. mother's tests"}
                className="text-sm"
              />
            </div>
          )}

          {error && (
            <p className="rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" disabled={saving} className="w-full py-3.5">
            {saving ? "Saving…" : "Confirm"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function messageFor(action: Action, amount: string): string {
  const what = {
    expense: "Spent",
    income: "Received",
    transfer: "Moved",
    settle: "Settled",
  }[action];
  return `${what} Rs ${amount}`;
}

/** The four buttons that open the sheet, as the reference design arranges them. */
export function QuickActions({ onPick }: { onPick: (action: Action) => void }) {
  const buttons: { action: Action; icon: string; label: string; className: string }[] = [
    {
      action: "expense",
      icon: "💸",
      label: "Out",
      className: "bg-accent text-on-accent font-bold shadow-lg shadow-accent-soft",
    },
    { action: "income", icon: "📥", label: "In", className: "border border-line bg-raised text-accent-bright" },
    { action: "transfer", icon: "🔄", label: "Move", className: "border border-line bg-raised text-move" },
    { action: "settle", icon: "🤝", label: "Settle", className: "border border-line bg-raised text-muted" },
  ];

  return (
    <div className="grid grid-cols-4 gap-2">
      {buttons.map((button) => (
        <button
          key={button.action}
          type="button"
          onClick={() => onPick(button.action)}
          className={cx(
            "flex min-h-16 flex-col items-center justify-center rounded-2xl p-2 transition-all active:scale-95",
            button.className,
          )}
        >
          <span className="text-lg leading-none" aria-hidden>
            {button.icon}
          </span>
          <span className="mt-1 text-xs font-semibold">{button.label}</span>
        </button>
      ))}
    </div>
  );
}
