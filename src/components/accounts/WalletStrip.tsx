"use client";

import { Money } from "@/components/Money";
import { cx } from "@/components/ui";
import { rateMissing, useSnapshot } from "@/lib/ledger/snapshot";
import type { AccountBalance } from "@/lib/ledger/accounts";

/**
 * Accounts as cards rather than rows.
 *
 * Ten rows of which seven hold under a thousand rupees is a lot of screen for
 * very little information. As a scrolling strip the whole wallet is one
 * gesture, the balances that matter are the ones you land on first, and the
 * small ones stop costing a row each. On desktop, where there is width to
 * spare, the same cards lay out as a grid instead.
 */
export function WalletStrip({ rows }: { rows: AccountBalance[] }) {
  const snapshot = useSnapshot();
  if (rows.length === 0) return null;

  return (
    <div className="no-scrollbar -mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
      <ul className="flex gap-3 lg:grid lg:grid-cols-3 lg:gap-3">
        {rows.map(({ account, native, pkr, currency }) => {
          const liability = account.type === "liability";
          // A liability carries a credit balance; show what is owed, positively.
          const shown = liability ? -native : native;

          return (
            <li
              key={account.id}
              className={cx(
                "flex w-40 shrink-0 flex-col justify-between rounded-2xl p-4 lg:w-auto",
                liability ? "bg-danger-soft" : "bg-surface",
                account.is_float && !liability && "bg-raised",
              )}
              style={{ minHeight: 104 }}
            >
              <p className="flex items-baseline gap-1.5">
                <span className="t-label truncate text-muted">{account.name}</span>
                {currency !== "PKR" && <span className="t-label shrink-0 text-muted">{currency}</span>}
              </p>

              <Money
                amount={shown}
                currency={currency}
                tone={liability ? "danger" : "plain"}
                className="mt-3 block text-lg font-semibold"
              />

              {/* A foreign balance means nothing here without its PKR value. */}
              {currency !== "PKR" &&
                (rateMissing(snapshot, currency) ? (
                  <p className="t-label mt-0.5 text-danger">no PKR rate set</p>
                ) : (
                  <p className="t-label mt-0.5 text-muted">
                    ≈ <Money amount={liability ? -pkr : pkr} compact tone="plain" />
                  </p>
                ))}

              {(liability || account.is_float || account.archived) && (
                <p className={cx("t-label mt-0.5", liability ? "text-danger" : "text-muted")}>
                  {[liability ? "owed" : null, account.is_float ? "float" : null, account.archived ? "archived" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
