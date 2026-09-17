"use client";

import { useMemo, useState } from "react";
import { Guard, Shell } from "@/components/Shell";
import { Money } from "@/components/Money";
import { Button, Card, Chip, ChipRow, Empty, ErrorNote, Input, Label, SectionTitle, cx } from "@/components/ui";
import { useSnapshot } from "@/lib/ledger/snapshot";
import {
  boxProgress,
  buildBoxes,
  currentPeriod,
  shiftPeriod,
  type Box,
  type BoxBorrow,
  type BoxesView,
  type PeriodWindow,
} from "@/lib/ledger/boxes";
import { BudgetRuleError, assignToBox, moveBetweenBoxes, settleBorrow } from "@/lib/ledger/box-actions";
import { parseAmount } from "@/lib/money";
import { today } from "@/lib/dates";

/**
 * /boxes is the allocation layer, and nothing on this page is an account.
 * Every number here is a claim on cash that already exists somewhere in
 * /accounts — assigning, moving and borrowing never write to the ledger.
 */
export default function BoxesPage() {
  return (
    <Guard>
      <Shell title="Boxes">
        <BoxesScreen />
      </Shell>
    </Guard>
  );
}

function BoxesScreen() {
  const snapshot = useSnapshot();
  const [window, setWindow] = useState<PeriodWindow>(() => currentPeriod("monthly"));
  const view = useMemo(() => buildBoxes(snapshot, window), [snapshot, window]);

  if (snapshot.categories.length === 0) {
    return <Empty>No categories yet. They are created during setup.</Empty>;
  }

  return (
    <div className="space-y-6">
      <PeriodNav window={window} onChange={setWindow} />
      <IncomeStrip view={view} />
      <Actions view={view} window={window} />

      <section>
        <SectionTitle
          action={
            <span className="text-xs text-muted">
              assigned <Money amount={view.assignedThisPeriod} compact tone="plain" /> · spent{" "}
              <Money amount={view.spentThisPeriod} compact tone="plain" />
            </span>
          }
        >
          Boxes
        </SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          {view.boxes.map((box) => (
            <BoxCard key={box.category.id} box={box} />
          ))}
        </div>
      </section>

      <OpenBorrows borrows={view.openBorrows} canSettle={window.isCurrent} />
    </div>
  );
}

function PeriodNav({
  window,
  onChange,
}: {
  window: PeriodWindow;
  onChange: (next: PeriodWindow) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Button type="button" variant="ghost" aria-label="Previous period" onClick={() => onChange(shiftPeriod(window, -1))}>
        ←
      </Button>
      <div className="text-center">
        <p className="text-sm font-semibold">{window.label}</p>
        {!window.isCurrent && (
          <button type="button" className="text-xs text-accent underline" onClick={() => onChange(currentPeriod(window.type))}>
            back to this month
          </button>
        )}
      </div>
      <Button type="button" variant="ghost" aria-label="Next period" onClick={() => onChange(shiftPeriod(window, 1))}>
        →
      </Button>
    </div>
  );
}

/**
 * Read-only, and only ever money that has actually landed. There is no notion
 * of expected or pending income anywhere in the app, so nothing here can be
 * budgeted before it exists.
 */
function IncomeStrip({ view }: { view: BoxesView }) {
  return (
    <div className="space-y-3">
      <Card className="divide-y divide-line">
        {view.income.length === 0 ? (
          <p className="px-3 py-2.5 text-sm text-muted">No income received this period.</p>
        ) : (
          view.income.map((line) => (
            <div key={line.account.id} className="flex items-center justify-between px-3 py-2">
              <span className="truncate text-sm">{line.account.name}</span>
              <Money amount={line.amount} compact tone="plain" className="text-sm font-medium" />
            </div>
          ))
        )}
        <div className="flex items-baseline justify-between px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">Available to assign</p>
            <p className="text-xs text-muted">received money not yet in a box</p>
          </div>
          <Money
            amount={view.availableToAssign}
            tone={view.availableToAssign < 0n ? "danger" : "plain"}
            className="text-lg font-semibold"
          />
        </div>
      </Card>

      {view.floatShortfall < 0n && (
        <div className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-danger">Float shortfall</p>
              <p className="text-xs text-danger/80">Not a box and never budgetable — this has to be returned.</p>
            </div>
            <Money amount={view.floatShortfall} tone="danger" className="shrink-0 text-sm font-semibold" />
          </div>
        </div>
      )}
    </div>
  );
}

type Mode = "assign" | "reallocate" | "borrow";

const MODE_LABEL: Record<Mode, string> = {
  assign: "Assign",
  reallocate: "Move",
  borrow: "Borrow",
};

function Actions({ view, window }: { view: BoxesView; window: PeriodWindow }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("assign");
  const [amount, setAmount] = useState("");
  const [takeBack, setTakeBack] = useState(false);
  const [target, setTarget] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!window.isCurrent) {
    return (
      <p className="rounded-lg bg-canvas px-3 py-2 text-xs text-muted">
        Viewing {window.start > today() ? "a future" : "a past"} period. Money can only be assigned or
        moved in the current one.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="grid grid-cols-3 gap-2">
        {(["assign", "reallocate", "borrow"] as const).map((option) => (
          <Button
            key={option}
            type="button"
            onClick={() => {
              setMode(option);
              setOpen(true);
              setError(null);
            }}
          >
            {MODE_LABEL[option]}
          </Button>
        ))}
      </div>
    );
  }

  const reset = () => {
    setAmount("");
    setTarget("");
    setSource("");
    setTakeBack(false);
    setError(null);
    setOpen(false);
  };

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
        if (!target) throw new BudgetRuleError("Pick a box");
        await assignToBox(view, window, target, takeBack ? -parsed : parsed);
      } else {
        if (!source || !target) throw new BudgetRuleError("Pick both boxes");
        await moveBetweenBoxes(view, window, source, target, parsed, mode);
      }
      reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not do that");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-3 p-3">
      <div className="grid grid-cols-3 gap-2">
        {(["assign", "reallocate", "borrow"] as const).map((option) => (
          <Chip key={option} selected={mode === option} onClick={() => { setMode(option); setError(null); }}>
            {MODE_LABEL[option]}
          </Chip>
        ))}
      </div>

      <p className="text-xs text-muted">
        {mode === "assign"
          ? "Put received money into a box, or take it back out."
          : mode === "reallocate"
            ? "Move money between boxes for good. No debt is created."
            : "Lend from one box to another and track it until it is paid back."}
      </p>

      {mode !== "assign" && (
        <div>
          <Label>From</Label>
          <ChipRow label="From box">
            {view.boxes.map((box) => (
              <Chip key={box.category.id} selected={source === box.category.id} onClick={() => setSource(box.category.id)}>
                {box.category.icon} {box.category.name}
              </Chip>
            ))}
          </ChipRow>
        </div>
      )}

      <div>
        <Label>{mode === "assign" ? "Box" : "To"}</Label>
        <ChipRow label="To box">
          {view.boxes.map((box) => (
            <Chip key={box.category.id} selected={target === box.category.id} onClick={() => setTarget(box.category.id)}>
              {box.category.icon} {box.category.name}
            </Chip>
          ))}
        </ChipRow>
      </div>

      {mode === "assign" && (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Direction">
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={takeBack === value}
              onClick={() => setTakeBack(value)}
              className={cx(
                "min-h-11 rounded-lg border text-sm font-medium transition-colors",
                takeBack === value ? "border-ink bg-ink text-white" : "border-line bg-surface text-muted",
              )}
            >
              {value ? "Take back" : "Assign to box"}
            </button>
          ))}
        </div>
      )}

      <Input
        autoFocus
        inputMode="decimal"
        aria-label="Amount"
        placeholder="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />

      <ErrorNote>{error}</ErrorNote>

      <div className="flex gap-2">
        <Button type="button" variant="primary" onClick={submit} disabled={busy} className="flex-1">
          {busy ? "Saving…" : MODE_LABEL[mode]}
        </Button>
        <Button type="button" variant="ghost" onClick={reset}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function BoxCard({ box }: { box: Box }) {
  const progress = boxProgress(box);
  const over = box.isOverspent;

  return (
    <Card className={cx("p-3", over && "border-danger/40 bg-danger-soft")}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-sm font-medium">
          <span aria-hidden>{box.category.icon} </span>
          {box.category.name}
        </p>
        <Money
          amount={box.available}
          compact
          tone={over ? "danger" : "plain"}
          className="shrink-0 text-base font-semibold"
        />
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-label={`${box.category.name} spent`}
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line"
      >
        <div
          className={cx("h-full rounded-full transition-[width]", over ? "bg-danger" : "bg-accent")}
          style={{ width: `${Math.max(progress * 100, progress > 0 ? 2 : 0)}%` }}
        />
      </div>

      <p className="mt-1.5 text-xs text-muted">
        assigned <Money amount={box.assigned} compact tone="plain" symbol={false} /> · spent{" "}
        <Money amount={box.spent} compact tone="plain" symbol={false} /> · left{" "}
        <Money amount={box.available} compact tone={over ? "danger" : "plain"} symbol={false} />
      </p>

      {box.carriedIn !== 0n && (
        <p className="text-xs text-muted">
          carried in <Money amount={box.carriedIn} compact signed tone={box.carriedIn < 0n ? "danger" : "plain"} symbol={false} />
        </p>
      )}

      {box.lentTo.map((borrow) => (
        <p key={borrow.transfer.id} className="text-xs font-medium text-danger">
          −<Money amount={borrow.amount} compact tone="danger" symbol={false} /> lent to {borrow.to.name} ·{" "}
          {borrow.daysOutstanding} day{borrow.daysOutstanding === 1 ? "" : "s"}
        </p>
      ))}

      {box.borrowedIn > 0n && (
        <p className="text-xs text-muted">
          includes <Money amount={box.borrowedIn} compact tone="plain" symbol={false} /> borrowed in
        </p>
      )}
    </Card>
  );
}

function OpenBorrows({ borrows, canSettle }: { borrows: BoxBorrow[]; canSettle: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (borrows.length === 0) return null;

  return (
    <section>
      <SectionTitle>Open box borrows</SectionTitle>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {borrows.map((borrow) => (
          <li key={borrow.transfer.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {borrow.from.name} → {borrow.to.name}
              </p>
              <p className="text-xs text-danger">
                {borrow.daysOutstanding} day{borrow.daysOutstanding === 1 ? "" : "s"} outstanding
              </p>
            </div>
            <Money amount={borrow.amount} compact tone="danger" className="shrink-0 text-sm font-semibold" />
            {canSettle && (
              <Button
                type="button"
                disabled={busy === borrow.transfer.id}
                onClick={async () => {
                  setBusy(borrow.transfer.id);
                  try {
                    await settleBorrow(borrow.transfer.id);
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Repaid
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
