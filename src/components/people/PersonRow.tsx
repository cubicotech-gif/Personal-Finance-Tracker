"use client";

import { Money } from "@/components/Money";
import { cx } from "@/components/ui";
import type { DebtPosition } from "@/lib/ledger/people";
import { ageTone, dueCountdown, type AgeTone } from "@/lib/ledger/people-view";
import { today } from "@/lib/dates";

const TONE: Record<AgeTone, string> = {
  calm: "bg-raised text-muted",
  warn: "bg-warn-soft text-warn",
  alert: "bg-danger-soft text-danger",
};

/** The days counter: the loudest thing in the row, on purpose. */
export function DaysCounter({ days }: { days: number | null }) {
  return (
    <span
      className={cx(
        "flex size-14 shrink-0 flex-col items-center justify-center rounded-2xl leading-none",
        TONE[ageTone(days)],
      )}
      aria-label={days === null ? "No open balance" : `${days} day${days === 1 ? "" : "s"} outstanding`}
    >
      <span className="tabular text-[24px] font-medium">{days ?? "–"}</span>
      <span className="t-label mt-1">{days === 1 ? "day" : "days"}</span>
    </span>
  );
}

export function PersonRow({ position, onOpen }: { position: DebtPosition; onOpen: (position: DebtPosition) => void }) {
  const due = position.dueOn ? dueCountdown(position.dueOn, today()) : null;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(position)}
        className="flex min-h-20 w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-left transition-transform duration-100 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-accent"
      >
        <DaysCounter days={position.daysOutstanding} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{position.counterparty.name}</span>
          {due && (
            <span className={cx("block truncate text-xs", due.overdue ? "text-danger" : "text-muted")}>
              {due.text}
            </span>
          )}
        </span>
        <Money
          amount={position.amountPkr}
          tone={due?.overdue ? "danger" : "plain"}
          className="shrink-0 font-medium"
        />
      </button>
    </li>
  );
}
