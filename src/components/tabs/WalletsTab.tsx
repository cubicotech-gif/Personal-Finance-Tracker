"use client";

import { useMemo } from "react";
import { accountBalances, summarise } from "@/lib/ledger/accounts";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { Amount } from "@/components/Amount";
import { Card, Empty, Pill, SectionTitle } from "@/components/ui";

/**
 * Every account, with what is in it.
 *
 * Receivable and payable accounts are left out on purpose: they are not places
 * money sits, they are records of a promise, and listing them here alongside a
 * bank balance is how an account total stops meaning anything. They have their
 * own two screens.
 */
export function WalletsTab() {
  const snapshot = useSnapshot();

  const balances = useMemo(() => accountBalances(snapshot), [snapshot]);
  const summary = useMemo(() => summarise(balances), [balances]);

  const wallets = balances
    .filter(({ account, native, isReceivable }) => {
      if (account.type !== "asset" || isReceivable) return false;
      // An account closed long ago is only worth a line if something is left in it.
      return !account.archived || native !== 0n;
    })
    .sort((a, b) => (b.pkr > a.pkr ? 1 : b.pkr < a.pkr ? -1 : a.account.name.localeCompare(b.account.name)));

  return (
    <>
      <SectionTitle aside={`${wallets.length} accounts`}>
        Where the money is
      </SectionTitle>

      {wallets.length === 0 ? (
        <Empty>No accounts yet.</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {wallets.map(({ account, native, currency }) => (
            <Card key={account.id} className="flex flex-col justify-between gap-2 p-3.5">
              <div className="flex items-start justify-between gap-1">
                <span className="text-xs leading-tight font-medium text-muted">{account.name}</span>
                {account.is_float && <Pill tone="danger">float</Pill>}
              </div>
              <Amount
                amount={native}
                currency={currency}
                tone={native < 0n ? "danger" : "ink"}
                className="text-base font-bold"
              />
            </Card>
          ))}
        </div>
      )}

      <Card className="space-y-2 p-4 text-xs">
        <p className="flex items-center justify-between">
          <span className="text-muted">Total in the accounts</span>
          <Amount amount={summary.cash} tone="ink" className="font-bold" />
        </p>
        <p className="flex items-center justify-between">
          <span className="text-muted">Of that, held for other people</span>
          <Amount amount={summary.heldForOthers} tone="danger" className="font-bold" />
        </p>
        <p className="flex items-center justify-between border-t border-line pt-2">
          <span className="text-muted">Yours to spend</span>
          <Amount
            amount={summary.mine}
            tone={summary.mine < 0n ? "danger" : "positive"}
            className="text-sm font-extrabold"
          />
        </p>
      </Card>
    </>
  );
}
