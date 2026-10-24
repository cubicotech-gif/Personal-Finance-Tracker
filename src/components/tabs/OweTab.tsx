"use client";

import { useMemo } from "react";
import { formatDay } from "@/lib/dates";
import { accountBalances, summarise } from "@/lib/ledger/accounts";
import { debtPositions, type DebtPosition } from "@/lib/ledger/people";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { Amount } from "@/components/Amount";
import { Card, Empty, Pill, SectionTitle } from "@/components/ui";

/**
 * What I owe, split the way it is actually owed.
 *
 * The split is the entire point of this screen. Callable money — client float,
 * a payment that landed by mistake — can be asked for tomorrow morning with no
 * warning. A term loan has a date and can be planned around. Adding the two
 * into one "I owe" figure, which is what every app does, produces a number
 * that is true and useless: it cannot tell you whether you are in trouble this
 * week or next year.
 */
export function OweTab() {
  const snapshot = useSnapshot();

  const summary = useMemo(() => summarise(accountBalances(snapshot)), [snapshot]);
  const owed = useMemo(
    () => debtPositions(snapshot, true).filter((position) => position.direction === "i_owe"),
    [snapshot],
  );

  const callable = owed.filter((position) => position.klass === "callable");
  const term = owed.filter((position) => position.klass === "term");
  const total = (positions: DebtPosition[]) =>
    positions.reduce((sum, position) => sum + position.amountPkr, 0n);

  const callableTotal = total(callable);
  /*
    How much of it could actually be handed back today.

    Deliberately measured against every rupee in the accounts, not against a
    ring-fenced "float" balance. There is no ring fence: the clients' money
    went into the same accounts as everything else and cannot be told apart
    any more. Pretending otherwise would report a smaller hole than the one
    that exists.
  */
  const covered = summary.cash < callableTotal ? summary.cash : callableTotal;
  const short = callableTotal - covered;

  return (
    <>
      <Card tone="danger" className="p-5">
        <p className="t-label flex items-center gap-1.5 text-danger">
          <span aria-hidden>🚨</span> Callable any day
        </p>
        <Amount amount={callableTotal} tone="ink" className="mt-1 block text-3xl font-extrabold" />
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Money that was never yours — client float and payments that landed by mistake. No due
          date: it can be asked for tomorrow.
        </p>

        <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs">
          <p className="flex items-center justify-between">
            <span className="text-muted">You could hand back today</span>
            <Amount amount={covered} tone="ink" className="font-bold" />
          </p>
          <p className="flex items-center justify-between">
            <span className="text-muted">{short > 0n ? "Already spent — the hole" : "Fully covered"}</span>
            <Amount
              amount={short}
              tone={short > 0n ? "danger" : "positive"}
              className="font-bold"
            />
          </p>
        </div>
      </Card>

      <section>
        <SectionTitle aside={callable.length === 0 ? undefined : `${callable.length} holder(s)`}>
          Callable
        </SectionTitle>
        {callable.length === 0 ? <Empty>Nothing callable. Good.</Empty> : <DebtList items={callable} />}
      </section>

      <section>
        <SectionTitle>Term loans</SectionTitle>
        {term.length === 0 ? (
          <Empty>No term loans.</Empty>
        ) : (
          <>
            <DebtList items={term} />
            <Card className="mt-3 flex items-center justify-between p-4 text-xs">
              <span className="text-muted">Total term loans</span>
              <Amount amount={total(term)} tone="ink" className="font-bold" />
            </Card>
          </>
        )}
      </section>

      <Card className="flex items-center justify-between p-4">
        <span className="t-label text-muted">Everything you owe</span>
        <Amount amount={total(owed)} tone="ink" className="text-base font-extrabold" />
      </Card>
    </>
  );
}

function DebtList({ items }: { items: DebtPosition[] }) {
  return (
    <div className="space-y-2.5">
      {items.map((position) => (
        <Card
          key={`${position.counterparty.id}-${position.settlementAccountId}`}
          className="flex items-start justify-between gap-3 p-3.5"
        >
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-ink">{position.counterparty.name}</h4>
            {position.counterparty.notes && (
              <p className="mt-0.5 truncate text-xs text-muted">{position.counterparty.notes}</p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Pill tone={position.klass === "callable" ? "danger" : "move"}>{position.klass}</Pill>
              {position.dueOn ? (
                <span className="text-[11px] text-faint">due {formatDay(position.dueOn)}</span>
              ) : position.daysOutstanding ? (
                <span className="text-[11px] text-faint">
                  {position.daysOutstanding} day{position.daysOutstanding === 1 ? "" : "s"} old
                </span>
              ) : null}
            </div>
          </div>
          <Amount amount={position.amountPkr} tone="ink" className="shrink-0 text-sm font-bold" />
        </Card>
      ))}
    </div>
  );
}
