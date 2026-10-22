"use client";

import Link from "next/link";
import { Money } from "@/components/Money";
import type { DebtPosition } from "@/lib/ledger/people";

/** First letters of a name, for the circle. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "?";
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}

/**
 * The people who owe you, as faces rather than a table.
 *
 * Chasing a debt is a thing you do to a person, not to a row, and a circle you
 * can hit with a thumb gets you to "record what they paid" in one tap. The
 * amount stays under each one, because without it this is just a contact list.
 */
export function ChaseAvatars({ positions }: { positions: DebtPosition[] }) {
  if (positions.length === 0) return null;

  return (
    <div className="no-scrollbar -mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <ul className="flex gap-3">
        {positions.slice(0, 8).map((position) => (
          <li key={position.counterparty.id}>
            <Link
              href={`/people?person=${position.counterparty.id}`}
              className="flex w-[4.5rem] flex-col items-center gap-1.5 rounded-xl py-1 text-center transition-colors hover:bg-raised/40"
            >
              <span
                aria-hidden
                className="flex size-12 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent"
              >
                {initials(position.counterparty.name)}
              </span>
              <span className="t-label w-full truncate text-muted">{position.counterparty.name}</span>
              <Money
                amount={position.amountPkr}
                compact
                symbol={false}
                tone="plain"
                className="t-label font-medium"
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
