"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { IconArrowRight, IconChevronLeft, IconChevronRight, IconCoin } from "@tabler/icons-react";
import { Money } from "@/components/Money";
import { Sheet } from "@/components/Sheet";
import { TABBAR } from "@/components/Shell";
import { Button, Empty, SectionTitle } from "@/components/ui";
import { useSnapshot } from "@/lib/ledger/snapshot";
import {
  buildBoxes,
  currentPeriod,
  shiftPeriod,
  type Box,
  type BoxBorrow,
  type BoxesView,
  type PeriodWindow,
} from "@/lib/ledger/boxes";
import { borrowBadges } from "@/lib/ledger/box-badges";
import { settleBorrow } from "@/lib/ledger/box-actions";
import { today } from "@/lib/dates";
import { BoxCard } from "./BoxCard";
import { BoxSheetBody } from "./BoxSheet";

/** Height reserved for the pinned action, so content never hides behind it. */
const ACTION_H = 76;

/**
 * /boxes is the allocation layer, and nothing on this page is an account.
 * Every number here is a claim on cash that already exists somewhere in
 * /accounts — assigning, moving and borrowing never write to the ledger.
 */
export function BoxesScreen() {
  const snapshot = useSnapshot();
  const [window, setWindow] = useState<PeriodWindow>(() => currentPeriod("monthly"));
  const view = useMemo(() => buildBoxes(snapshot, window), [snapshot, window]);
  const badges = useMemo(() => borrowBadges(view.openBorrows), [view.openBorrows]);

  // `session` changes on every open, which remounts the sheet body and so
  // clears whatever was typed last time. Closing only flips `open`, so the
  // content stays put while the sheet slides away.
  const [sheet, setSheet] = useState<{ boxId: string | null; session: number; open: boolean }>({
    boxId: null,
    session: 0,
    open: false,
  });
  const open = useCallback((boxId: string | null) => {
    setSheet((current) => ({ boxId, session: current.session + 1, open: true }));
  }, []);
  const close = useCallback(() => setSheet((current) => ({ ...current, open: false })), []);

  if (snapshot.categories.length === 0) {
    return (
      <div className="py-6 text-center">
        <Empty>No boxes yet. They are created during setup.</Empty>
        <Link href="/setup" className="font-medium text-accent underline">
          Go to setup
        </Link>
      </div>
    );
  }

  const canAct = window.isCurrent;

  return (
    <div className="flex flex-col" style={{ minHeight: `calc(100dvh - 48px - ${TABBAR})` }}>
      <div className="flex-1 space-y-6 pb-6">
        <PeriodNav window={window} onChange={setWindow} />
        <IncomeStrip view={view} />

        <section>
          <SectionTitle
            action={
              <span className="text-xs text-muted">
                assigned <Money amount={view.assignedThisPeriod} tone="plain" /> · spent{" "}
                <Money amount={view.spentThisPeriod} tone="plain" />
              </span>
            }
          >
            Boxes
          </SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            {view.boxes.map((box) => (
              <BoxCard
                key={box.category.id}
                box={box}
                badge={badges.get(box.category.id)}
                onOpen={(picked: Box) => canAct && open(picked.category.id)}
              />
            ))}
          </div>
          <p className="mt-3 text-center text-xs text-muted">
            {canAct
              ? "Hold a box to assign, move or borrow."
              : `Viewing ${window.start > today() ? "a future" : "a past"} period. Money can only be assigned or moved in the current one.`}
          </p>
        </section>

        <OpenBorrows borrows={view.openBorrows} canSettle={canAct} />

        {view.floatShortfall < 0n && <FloatShortfall amount={view.floatShortfall} />}
      </div>

      {/* Primary action, under the thumb -------------------------------- */}
      {canAct && (
        <div
          className="sticky z-10 -mx-4 bg-canvas px-4 pt-2 pb-3"
          style={{ bottom: TABBAR, minHeight: ACTION_H }}
        >
          <button
            type="button"
            onClick={() => open(null)}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent font-medium text-on-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <IconCoin size={20} stroke={2} aria-hidden />
            Assign money
          </button>
        </div>
      )}

      <Sheet open={sheet.open} onClose={close} label="Assign, move or borrow">
        {sheet.session > 0 && (
          <BoxSheetBody
            key={sheet.session}
            view={view}
            window={window}
            initialBoxId={sheet.boxId}
            onDone={close}
          />
        )}
      </Sheet>
    </div>
  );
}

function PeriodNav({ window, onChange }: { window: PeriodWindow; onChange: (next: PeriodWindow) => void }) {
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        aria-label="Previous period"
        onClick={() => onChange(shiftPeriod(window, -1))}
        className="flex size-11 items-center justify-center rounded-2xl text-muted"
      >
        <IconChevronLeft size={22} stroke={1.75} />
      </button>
      <div className="text-center">
        <p className="font-medium">{window.label}</p>
        {!window.isCurrent && (
          <button
            type="button"
            className="text-xs text-accent underline"
            onClick={() => onChange(currentPeriod(window.type))}
          >
            back to this month
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Next period"
        onClick={() => onChange(shiftPeriod(window, 1))}
        className="flex size-11 items-center justify-center rounded-2xl text-muted"
      >
        <IconChevronRight size={22} stroke={1.75} />
      </button>
    </div>
  );
}

/**
 * Read-only, and only ever money that has actually landed. There is no notion
 * of expected or pending income anywhere in the app, so nothing here can be
 * budgeted before it exists.
 */
function IncomeStrip({ view }: { view: BoxesView }) {
  const over = view.availableToAssign < 0n;
  return (
    <section className="rounded-2xl bg-surface p-4">
      {view.income.length === 0 ? (
        <p className="text-muted">No income received this period.</p>
      ) : (
        <ul className="space-y-1">
          {view.income.map((line) => (
            <li key={line.account.id} className="flex items-baseline justify-between gap-3">
              <span className="truncate text-muted">{line.account.name}</span>
              <Money amount={line.amount} tone="plain" className="shrink-0" />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        <p className="t-label text-muted">Available to assign</p>
        <Money
          amount={view.availableToAssign}
          tone={over ? "danger" : "positive"}
          countOnMount
          className="t-hero mt-1 block"
        />
        <p className="mt-1 text-xs text-muted">received money not yet in a box</p>
      </div>
    </section>
  );
}

function OpenBorrows({ borrows, canSettle }: { borrows: BoxBorrow[]; canSettle: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (borrows.length === 0) return null;

  return (
    <section>
      <SectionTitle>Open borrows</SectionTitle>
      <ul className="space-y-1">
        {borrows.map((borrow) => (
          <li key={borrow.transfer.id} className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 font-medium">
                <span className="truncate">{borrow.from.name}</span>
                <IconArrowRight size={16} stroke={1.75} className="shrink-0 text-muted" aria-hidden />
                <span className="truncate">{borrow.to.name}</span>
              </p>
              <p className="text-xs text-danger">
                {borrow.daysOutstanding} day{borrow.daysOutstanding === 1 ? "" : "s"} outstanding
              </p>
            </div>
            <Money amount={borrow.amount} tone="danger" className="shrink-0 font-medium" />
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

/** Never a box and never budgetable: a hole to be returned, kept apart on purpose. */
function FloatShortfall({ amount }: { amount: bigint }) {
  return (
    <section className="mt-10 rounded-2xl bg-danger-soft p-4">
      <p className="t-label text-danger">Float shortfall</p>
      <Money amount={amount} tone="danger" className="t-section mt-2 block" />
      <p className="mt-1 text-xs text-danger">Not a box and never budgetable. This has to be returned.</p>
    </section>
  );
}
