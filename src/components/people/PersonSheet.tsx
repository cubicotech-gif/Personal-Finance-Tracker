"use client";

import { useCallback, useMemo, useState } from "react";
import { AmountReadout } from "@/components/AmountReadout";
import { Money } from "@/components/Money";
import { NumberPad } from "@/components/NumberPad";
import { Chip, ChipRow, cx } from "@/components/ui";
import { useSnapshot, pkr } from "@/lib/ledger/snapshot";
import type { DebtPosition } from "@/lib/ledger/people";
import { counterpartyHistory, dueCountdown } from "@/lib/ledger/people-view";
import { accountsByUsage, composeEntries } from "@/lib/ledger/compose";
import { postTransaction } from "@/lib/db/mutations";
import { padInput, minorToTyped, type PadKey } from "@/lib/pad";
import { usePadKeyboard } from "@/lib/usePadKeyboard";
import { formatAmount } from "@/lib/format";
import { parseAmount, type Currency } from "@/lib/money";
import { formatRelativeDay, today } from "@/lib/dates";
import { DaysCounter } from "./PersonRow";

type Tab = "repay" | "history";

function buzz() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
}

/**
 * One person: what they owe, a repayment on the shared number pad, and the
 * full history behind the balance.
 *
 * A repayment is an ordinary transaction, not a special kind of row. Partial
 * amounts therefore work without any extra machinery, and the FIFO ageing on
 * the position keeps counting from the oldest unpaid advance.
 */
export function PersonSheetBody({ position, onDone }: { position: DebtPosition; onDone: () => void }) {
  const snapshot = useSnapshot();
  const accounts = useMemo(() => accountsByUsage(snapshot).filter((a) => a.type === "asset"), [snapshot]);
  const [tab, setTab] = useState<Tab>("repay");
  const [chosenId, setChosenId] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Derived rather than captured at mount: the first render can see an empty
  // snapshot, so a default stored in state would latch onto "".
  const accountId = chosenId || accounts[0]?.id || "";
  const currency: Currency = snapshot.accountsById.get(accountId)?.currency ?? "PKR";
  const owesMe = position.direction === "owes_me";

  const press = useCallback((key: PadKey) => {
    setAmount((current) => padInput(current, key));
    setError(null);
  }, []);
  usePadKeyboard(press, tab === "repay");

  const history = useMemo(
    () => counterpartyHistory(snapshot, position.counterparty.id, position.direction),
    [snapshot, position.counterparty.id, position.direction],
  );

  const typed = parseAmount(amount, currency) ?? 0n;
  // What is left once this repayment is in, in PKR, counting down as typed.
  const left = position.amountPkr - pkr(snapshot, typed, currency);
  const due = position.dueOn ? dueCountdown(position.dueOn, today()) : null;

  async function submit() {
    if (busy) return;
    setError(null);
    const value = parseAmount(amount, currency);
    if (value === null || value <= 0n) {
      setError("Enter an amount");
      return;
    }
    setBusy(true);
    try {
      const entries = await composeEntries(snapshot, {
        bookedOn: today(),
        // They pay me back: money in. I pay them back: money out.
        direction: owesMe ? "in" : "out",
        kind: owesMe ? "receive_repayment" : "repay_debt",
        amount: value,
        accountId,
        counterpartyId: position.counterparty.id,
      });
      await postTransaction({
        booked_on: today(),
        payee: position.counterparty.name,
        note: owesMe ? "Repayment received" : "Repayment paid",
        entries,
      });
      buzz();
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record repayment");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Who and how much ------------------------------------------------ */}
      <div className="flex items-center gap-3">
        <DaysCounter days={position.daysOutstanding} />
        <div className="min-w-0 flex-1">
          <p className="truncate t-section">{position.counterparty.name}</p>
          <p className="text-muted">{owesMe ? "owes you" : "you owe"}</p>
        </div>
      </div>
      <div>
        <Money amount={position.amountPkr} tone="plain" countOnMount className="t-hero block" />
        {due && (
          <p className={cx("mt-1", due.overdue ? "text-danger" : "text-muted")}>{due.text}</p>
        )}
      </div>

      <div role="group" aria-label="View" className="grid grid-cols-2 rounded-2xl bg-surface p-1">
        {(["repay", "history"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={tab === option}
            onClick={() => setTab(option)}
            className={cx(
              "min-h-11 rounded-xl font-medium transition-colors",
              tab === option ? "bg-raised text-ink" : "text-muted",
            )}
          >
            {option === "repay" ? (owesMe ? "Received" : "Repay") : "History"}
          </button>
        ))}
      </div>

      {tab === "history" ? (
        history.length === 0 ? (
          <p className="py-8 text-center text-muted">No history.</p>
        ) : (
          <ul className="space-y-1">
            {history.map((row, index) => (
              <li
                key={`${row.transactionId}-${index}`}
                className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{row.label}</span>
                  <span className="block text-xs text-muted">{formatRelativeDay(row.on)}</span>
                </span>
                <span
                  className={cx("tabular shrink-0 font-medium", row.kind === "repayment" && "text-accent")}
                >
                  {row.kind === "repayment" ? "−" : "+"}
                  {formatAmount(row.amountPkr, "PKR")}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <ChipRow label="Account">
            {accounts.map((account) => (
              <Chip
                key={account.id}
                className={accountId === account.id ? undefined : "bg-surface"}
                selected={accountId === account.id}
                onClick={() => setChosenId(account.id)}
              >
                {account.name}
              </Chip>
            ))}
          </ChipRow>

          <AmountReadout value={amount} currency={currency} />
          <div className="flex h-8 items-center justify-between" aria-live="polite">
            <span className="t-label text-muted">{left < 0n ? "Overpaying by" : "Left after"}</span>
            <Money
              amount={left < 0n ? -left : left}
              tone={left < 0n ? "danger" : "plain"}
              className="t-section"
            />
          </div>

          <div className="flex items-center justify-end">
            {currency === "PKR" && position.amountPkr > 0n && (
              <button
                type="button"
                onClick={() => {
                  setAmount(minorToTyped(position.amountPkr));
                  setError(null);
                }}
                className="min-h-11 rounded-xl px-3 text-accent"
              >
                Full {formatAmount(position.amountPkr, "PKR")}
              </button>
            )}
          </div>

          <NumberPad onKey={press} className="h-[232px]" />

          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className={cx(
              "flex h-14 w-full items-center justify-center rounded-2xl font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              amount === "" ? "bg-surface text-muted" : "bg-accent text-on-accent",
            )}
          >
            {busy ? "Saving…" : "Record repayment"}
          </button>
        </>
      )}
    </div>
  );
}
