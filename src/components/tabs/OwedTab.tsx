"use client";

import { useMemo } from "react";
import { debtPositions } from "@/lib/ledger/people";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { Amount } from "@/components/Amount";
import { Card, Empty, SectionTitle } from "@/components/ui";

/**
 * What is owed to me.
 *
 * Netted per person, oldest first, with how long it has been outstanding —
 * because age is the only thing that tells you who to chase. A figure on its
 * own invites you to count this as money; a figure that has been sitting for
 * 180 days does not.
 */
export function OwedTab() {
  const snapshot = useSnapshot();

  /*
    Grouped per account, not netted per person.

    One person can be on both sides — Rafay owes 6,00,600 and is owed 3,00,000
    back — and netting those into a single figure hides both halves. Each side
    is shown where it belongs, and the offset stays a decision rather than
    something the app quietly makes.
  */
  const owed = useMemo(
    () => debtPositions(snapshot, true).filter((position) => position.direction === "owes_me"),
    [snapshot],
  );

  const total = owed.reduce((sum, position) => sum + position.amountPkr, 0n);

  return (
    <>
      <Card tone="accent" className="p-5">
        <p className="t-label text-accent-bright">Owed to you</p>
        <Amount amount={total} tone="ink" className="mt-1 block text-3xl font-extrabold" />
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Real money, but not cash: you cannot spend it until it arrives. It does not count
          towards what is in your accounts.
        </p>
      </Card>

      <section>
        <SectionTitle aside={owed.length === 0 ? undefined : "oldest first"}>People</SectionTitle>

        {owed.length === 0 ? (
          <Empty>Nobody owes you anything.</Empty>
        ) : (
          <div className="space-y-2.5">
            {owed.map((position) => (
              <Card
                key={`${position.counterparty.id}-${position.settlementAccountId}`}
                className="flex items-center justify-between gap-3 p-3.5"
              >
                <div className="min-w-0">
                  <h4 className="truncate text-sm font-semibold text-ink">
                    {position.counterparty.name}
                  </h4>
                  {position.counterparty.notes && (
                    <p className="mt-0.5 truncate text-xs text-muted">{position.counterparty.notes}</p>
                  )}
                  {/* On the day it is entered there is nothing to report. */}
                  {Boolean(position.daysOutstanding) && (
                    <p className="mt-0.5 text-[11px] text-faint">
                      waiting {position.daysOutstanding} day
                      {position.daysOutstanding === 1 ? "" : "s"}
                    </p>
                  )}
                </div>
                <Amount amount={position.amountPkr} tone="positive" className="shrink-0 text-sm font-bold" />
              </Card>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
