"use client";

import { useCallback, useState } from "react";
import { AmountReadout } from "@/components/AmountReadout";
import { Money } from "@/components/Money";
import { NumberPad } from "@/components/NumberPad";
import { Chip, ChipRow, cx } from "@/components/ui";
import type { BoxesView, PeriodWindow } from "@/lib/ledger/boxes";
import { BudgetRuleError, assignToBox, moveBetweenBoxes } from "@/lib/ledger/box-actions";
import { padInput, type PadKey } from "@/lib/pad";
import { usePadKeyboard } from "@/lib/usePadKeyboard";
import { parseAmount } from "@/lib/money";

export type Mode = "assign" | "reallocate" | "borrow";

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "assign", label: "Assign", hint: "Put received money into a box, or take it back out." },
  { id: "reallocate", label: "Move", hint: "Move money between boxes for good. No debt is created." },
  { id: "borrow", label: "Borrow", hint: "Lend from one box to another and track it until it is paid back." },
];

function buzz() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
}

/**
 * Assign, move or borrow, on the same number pad as /log. Every rule lives in
 * box-actions (what may be assigned, what a box can lose); this only collects
 * the inputs and shows the figure that is about to change.
 *
 * Mounted fresh each time the sheet opens, so nothing carries over.
 */
export function BoxSheetBody({
  view,
  window,
  initialBoxId,
  initialMode = "assign",
  onDone,
}: {
  view: BoxesView;
  window: PeriodWindow;
  initialBoxId: string | null;
  initialMode?: Mode;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  // The box in focus: the one assigned to, or the one money leaves.
  const [anchorId, setAnchorId] = useState<string | null>(initialBoxId);
  const [toId, setToId] = useState<string | null>(null);
  const [takeBack, setTakeBack] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const press = useCallback((key: PadKey) => {
    setAmount((current) => padInput(current, key));
    setError(null);
  }, []);
  usePadKeyboard(press);

  const anchor = view.boxes.find((box) => box.category.id === anchorId);
  const typed = parseAmount(amount, "PKR") ?? 0n;

  // The one figure that moves as the amount is typed, and what it is called.
  let liveLabel: string;
  let live: bigint;
  if (mode === "assign" && !takeBack) {
    liveLabel = "Available to assign";
    live = view.availableToAssign - typed;
  } else if (anchor) {
    liveLabel = `Left in ${anchor.category.name}`;
    live = anchor.available - typed;
  } else {
    liveLabel = "Pick a box";
    live = 0n;
  }

  async function submit() {
    if (busy) return;
    setError(null);
    const parsed = parseAmount(amount, "PKR");
    if (parsed === null || parsed <= 0n) {
      setError("Enter an amount");
      return;
    }
    setBusy(true);
    try {
      if (mode === "assign") {
        if (!anchorId) throw new BudgetRuleError("Pick a box");
        await assignToBox(view, window, anchorId, takeBack ? -parsed : parsed);
      } else {
        if (!anchorId || !toId) throw new BudgetRuleError("Pick both boxes");
        await moveBetweenBoxes(view, window, anchorId, toId, parsed, mode);
      }
      buzz();
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not do that");
      setBusy(false);
    }
  }

  const hint = MODES.find((m) => m.id === mode)?.hint;

  return (
    <div className="space-y-3">
      {/* Mode ------------------------------------------------------------ */}
      <div role="group" aria-label="Action" className="grid grid-cols-3 rounded-2xl bg-surface p-1">
        {MODES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={mode === option.id}
            onClick={() => {
              setMode(option.id);
              setError(null);
              if (option.id !== "assign") setTakeBack(false);
            }}
            className={cx(
              "min-h-11 rounded-xl font-medium transition-colors",
              mode === option.id ? "bg-raised text-ink" : "text-muted",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{hint}</p>

      {/* Boxes ----------------------------------------------------------- */}
      <div>
        <p className="t-label mb-1.5 text-muted">{mode === "assign" ? "Box" : "From"}</p>
        <ChipRow label={mode === "assign" ? "Box" : "From box"}>
          {view.boxes.map((box) => (
            <Chip
              key={box.category.id}
              className={anchorId === box.category.id ? undefined : "bg-surface"}
              selected={anchorId === box.category.id}
              onClick={() => {
                setAnchorId(box.category.id);
                if (toId === box.category.id) setToId(null);
                setError(null);
              }}
            >
              {box.category.name}
            </Chip>
          ))}
        </ChipRow>
      </div>

      {mode !== "assign" && (
        <div>
          <p className="t-label mb-1.5 text-muted">To</p>
          <ChipRow label="To box">
            {view.boxes
              .filter((box) => box.category.id !== anchorId)
              .map((box) => (
                <Chip
                  key={box.category.id}
                  className={toId === box.category.id ? undefined : "bg-surface"}
                  selected={toId === box.category.id}
                  onClick={() => {
                    setToId(box.category.id);
                    setError(null);
                  }}
                >
                  {box.category.name}
                </Chip>
              ))}
          </ChipRow>
        </div>
      )}

      {mode === "assign" && (
        <div role="group" aria-label="Direction" className="grid grid-cols-2 rounded-2xl bg-surface p-1">
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={takeBack === value}
              onClick={() => setTakeBack(value)}
              className={cx(
                "min-h-11 rounded-xl font-medium transition-colors",
                takeBack === value ? "bg-raised text-ink" : "text-muted",
              )}
            >
              {value ? "Take back" : "Give"}
            </button>
          ))}
        </div>
      )}

      {/* Amount and the figure it moves ---------------------------------- */}
      <AmountReadout value={amount} />
      <div className="flex h-8 items-center justify-between" aria-live="polite">
        <span className="t-label truncate text-muted">{liveLabel}</span>
        {(mode === "assign" && !takeBack) || anchor ? (
          <Money amount={live} tone={live < 0n ? "danger" : "plain"} className="t-section" />
        ) : null}
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
        {busy ? "Saving…" : MODES.find((m) => m.id === mode)?.label}
      </button>
    </div>
  );
}
