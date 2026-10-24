"use client";

import { useMemo, useState } from "react";
import { deleteTransaction } from "@/lib/db/mutations";
import { describe, groupLogRowsByDay, recentLogRows, type LogRow } from "@/lib/ledger/log";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { Amount } from "@/components/Amount";
import { Card, Empty, SectionTitle } from "@/components/ui";

/**
 * Everything that happened, newest first.
 *
 * This is the receipt for every other screen: any figure in the app can be
 * followed back to the lines here that produced it. Each row is one
 * transaction collapsed to the sentence a human would say about it, with the
 * day's own net alongside the date.
 */
export function LedgerTab() {
  const snapshot = useSnapshot();
  const [busy, setBusy] = useState<string | null>(null);

  const days = useMemo(() => groupLogRowsByDay(recentLogRows(snapshot, 200)), [snapshot]);

  async function remove(row: LogRow) {
    if (busy) return;
    setBusy(row.transaction.id);
    try {
      await deleteTransaction(row.transaction.id);
    } finally {
      setBusy(null);
    }
  }

  if (days.length === 0) {
    return <Empty>Nothing logged yet. Record something on the Spend tab.</Empty>;
  }

  return (
    <>
      <SectionTitle aside="newest first">Everything that happened</SectionTitle>

      <div className="space-y-4">
        {days.map((day) => (
          <section key={day.on}>
            <div className="mb-2 flex items-baseline justify-between px-1">
              <h3 className="t-label text-muted">{day.label}</h3>
              {day.net !== 0n && (
                <Amount
                  amount={day.net}
                  signed
                  tone={day.net > 0n ? "positive" : "plain"}
                  className="text-xs text-muted"
                />
              )}
            </div>

            <Card className="overflow-hidden">
              <ul className="divide-y divide-line">
                {day.rows.map((row) => (
                  <li key={row.transaction.id} className="flex items-center gap-3 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{describe(row)}</p>
                      <p className="mt-0.5 truncate text-xs text-muted">{trail(row)}</p>
                    </div>

                    <RowAmount row={row} />

                    <button
                      type="button"
                      onClick={() => remove(row)}
                      disabled={busy === row.transaction.id}
                      aria-label={`Delete ${describe(row)}`}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-40"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ))}
      </div>
    </>
  );
}

/** Where the money came from and where it went — the half a date cannot tell you. */
function trail(row: LogRow): string {
  if (row.direction === "transfer" && row.account && row.toAccount) {
    return `${row.account.name} → ${row.toAccount.name}`;
  }
  return [
    row.direction === "split" ? `${row.lineCount} lines` : null,
    row.account?.name,
    row.counterparty?.name,
    row.category?.name,
  ]
    .filter(Boolean)
    .join(" · ");
}

function RowAmount({ row }: { row: LogRow }) {
  // Only a plain in or out carries a sign. A transfer nets to zero across my
  // own accounts and a split has no single direction, so signing either would
  // state something untrue.
  const signed = row.direction === "in" || row.direction === "out";
  const inbound = row.direction === "in";

  return (
    <Amount
      amount={signed && !inbound ? -row.amount : row.amount}
      currency={row.currency}
      signed={signed}
      tone={inbound ? "positive" : row.direction === "out" ? "plain" : "ink"}
      className="shrink-0 text-sm font-bold"
    />
  );
}
