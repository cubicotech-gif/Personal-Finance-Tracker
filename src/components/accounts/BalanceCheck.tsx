"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { IconCheck } from "@tabler/icons-react";
import { Money } from "@/components/Money";
import { Card, SectionTitle } from "@/components/ui";
import { db } from "@/lib/db/dexie";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { buildBalanceChecks, staleCount, type AccountCheck } from "@/lib/ledger/balance-check";
import type { IsoDate } from "@/lib/dates";

/** How many to list before it becomes a wall rather than a prompt. */
const SHOWN = 3;

/**
 * "Does the app still match your bank?"
 *
 * No amount of bookkeeping can notice a bank charge or a transfer made outside
 * the app — only a person looking at their bank can. This says which figures
 * have gone unconfirmed longest, so a stale balance announces itself instead
 * of quietly being trusted.
 */
export function BalanceCheck() {
  const snapshot = useSnapshot();

  // "Checked and it matched" posts no transaction, so it lives in local meta.
  const checkedLocally = useLiveQuery(async () => {
    const rows = await db.meta.toArray();
    const map = new Map<string, IsoDate>();
    for (const row of rows) {
      if (row.key.startsWith("checked:")) map.set(row.key.slice(8), row.value);
    }
    return map;
  }, []);

  const checks = useMemo(
    () => (checkedLocally ? buildBalanceChecks(snapshot, checkedLocally) : []),
    [snapshot, checkedLocally],
  );

  const stale = checks.filter((check) => check.stale);
  if (stale.length === 0) return null;

  return (
    <section>
      <SectionTitle
        action={
          stale.length > SHOWN ? (
            <span className="t-label text-muted">{staleCount(checks)} to check</span>
          ) : undefined
        }
      >
        Balance check
      </SectionTitle>

      <Card className="divide-y divide-line">
        {stale.slice(0, SHOWN).map((check) => (
          <CheckRow key={check.account.id} check={check} />
        ))}
      </Card>

      <p className="mt-2 text-muted">
        Compare each with your bank. Anything that does not match is booked to Unaccounted.
      </p>
    </section>
  );
}

function CheckRow({ check }: { check: AccountCheck }) {
  const when =
    check.daysSinceCheck === null
      ? "never checked"
      : `checked ${check.daysSinceCheck} day${check.daysSinceCheck === 1 ? "" : "s"} ago`;

  return (
    <Link
      href={`/log?check=${check.account.id}`}
      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-raised/40"
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{check.account.name}</p>
        <p className="t-label text-muted">{when}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Money amount={check.balance} currency={check.currency} tone="plain" className="font-medium" />
        <span className="flex size-8 items-center justify-center rounded-full bg-raised text-muted">
          <IconCheck size={16} stroke={2} aria-hidden />
        </span>
      </div>
    </Link>
  );
}
