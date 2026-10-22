"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Money } from "@/components/Money";
import { Card, SectionTitle, cx } from "@/components/ui";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { buildHome, type DueItem } from "@/lib/ledger/home";
import { BalanceCheck } from "./BalanceCheck";
import { ChaseAvatars } from "./ChaseAvatars";
import { formatDay } from "@/lib/dates";

/**
 * The part of the home screen that answers "what do I have to do about it".
 *
 * The balances above say where things stand; these say what happens next —
 * what falls due, who to chase, and whether this month is adding to the
 * problem or paying it down. Each section hides itself when empty, so a
 * ledger with nothing outstanding stays quiet instead of showing zeroes.
 */
export function HomeSections() {
  const snapshot = useSnapshot();
  const home = useMemo(() => buildHome(snapshot), [snapshot]);

  if (!snapshot.ready) return null;

  return (
    <>
      <BalanceCheck />

      {home.dueSoon.length > 0 && (
        <section>
          <SectionTitle>Due soon</SectionTitle>
          <Card className="divide-y divide-line">
            {home.dueSoon.slice(0, 4).map((item) => (
              <DueRow key={item.position.counterparty.id} item={item} />
            ))}
          </Card>
        </section>
      )}

      {home.chase.length > 0 && (
        <section>
          <SectionTitle
            action={
              <Link href="/people" className="t-label text-accent underline">
                all people
              </Link>
            }
          >
            Chase — owed to you
          </SectionTitle>
          <ChaseAvatars positions={home.chase} />
        </section>
      )}

      <section>
        <SectionTitle>{home.month.label}</SectionTitle>
        <Card className="grid grid-cols-3 divide-x divide-line">
          <Flow label="In" amount={home.month.received} tone={home.month.received > 0n ? "positive" : "plain"} />
          <Flow label="Out" amount={home.month.spent} tone={home.month.spent > 0n ? "danger" : "plain"} />
          <Flow
            label="Net"
            amount={home.month.net}
            tone={home.month.net < 0n ? "danger" : home.month.net > 0n ? "positive" : "plain"}
          />
        </Card>
        {home.month.net < 0n && (
          <p className="mt-2 text-sm text-danger">
            You have spent <Money amount={-home.month.net} compact tone="danger" /> more than you
            received this month.
          </p>
        )}
      </section>
    </>
  );
}

function DueRow({ item }: { item: DueItem }) {
  const { position, daysUntil, overdue } = item;
  // Days are what make a date mean something — "Dec 30" reads as far away,
  // "in 69 days" does not, and "11 days late" reads as neither.
  const when = overdue
    ? `${-daysUntil} day${daysUntil === -1 ? "" : "s"} late`
    : daysUntil === 0
      ? "today"
      : `in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`;

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate font-medium">{position.counterparty.name}</p>
        <p className={cx("t-label", overdue ? "text-danger" : "text-muted")}>
          {formatDay(item.dueOn)} · {when}
        </p>
      </div>
      <Money
        amount={position.amountPkr}
        compact
        tone={overdue ? "danger" : "plain"}
        className="shrink-0 font-semibold"
      />
    </div>
  );
}

function Flow({
  label,
  amount,
  tone,
}: {
  label: string;
  amount: bigint;
  tone: "plain" | "danger" | "positive";
}) {
  return (
    <div className="px-3 py-3 text-center">
      <p className="t-label text-muted">{label}</p>
      <Money amount={amount} compact tone={tone} className="mt-1 block font-semibold" />
    </div>
  );
}
