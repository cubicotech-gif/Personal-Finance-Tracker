"use client";

import { useMemo, useState } from "react";
import { today } from "@/lib/dates";
import { accountBalances, summarise } from "@/lib/ledger/accounts";
import { monthBoxes } from "@/lib/ledger/budgets";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { ActionSheet, QuickActions, type Action } from "@/components/ActionSheet";
import { Amount } from "@/components/Amount";
import { Toast } from "@/components/Toast";
import { Bar, Card, Empty, SectionTitle } from "@/components/ui";

/**
 * The screen for the question "can I spend this".
 *
 * The cash figure on top is what is physically in the accounts; underneath it
 * is how much of that is actually mine once other people's money is set aside.
 * Those two are usually very far apart, and showing only the first is how
 * someone spends money that was never theirs.
 */
export function SpendTab() {
  const snapshot = useSnapshot();
  const [action, setAction] = useState<Action | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const balances = useMemo(() => accountBalances(snapshot), [snapshot]);
  const summary = useMemo(() => summarise(balances), [balances]);
  const view = useMemo(() => monthBoxes(snapshot, today()), [snapshot]);

  // The same count the Wallets tab shows. Receivables are assets but they are
  // not places money sits, so counting them here would disagree with the list
  // the next tab prints.
  const wallets = balances.filter(
    ({ account, isReceivable }) => account.type === "asset" && !isReceivable && !account.archived,
  ).length;

  return (
    <>
      <Card tone="accent" className="relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-accent-soft blur-2xl" />
        <p className="t-label text-muted">Cash in {wallets} accounts</p>
        <Amount amount={summary.cash} tone="ink" className="mt-1 block text-3xl font-extrabold" />

        {/*
          Stacked rather than run on one line: "Actually mine" is often a long
          negative figure, and on a phone a label and a figure sharing a line
          break in the middle of the number.
        */}
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3">
          <div>
            <p className="t-label text-faint">Actually mine</p>
            <Amount
              amount={summary.mine}
              tone={summary.mine < 0n ? "danger" : "positive"}
              className="mt-0.5 block text-sm font-bold"
            />
          </div>
          <div>
            <p className="t-label text-faint">Month&apos;s target</p>
            <Amount amount={view.totalTarget} tone="ink" className="mt-0.5 block text-sm font-bold" />
          </div>
        </div>
      </Card>

      <QuickActions onPick={setAction} />

      <section>
        <SectionTitle aside={`${view.label} · spent so far`}>Spending boxes</SectionTitle>

        {view.boxes.length === 0 ? (
          <Empty>No boxes yet.</Empty>
        ) : (
          <div className="space-y-2.5">
            {view.boxes.map((box) => (
              <Card key={box.category.id} className="flex flex-col gap-2 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-ink">
                    <span className="mr-1.5" aria-hidden>
                      {box.category.icon}
                    </span>
                    {box.category.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    <Amount
                      amount={box.spent}
                      symbol={false}
                      tone={box.over ? "danger" : "plain"}
                      className={box.over ? "font-bold" : undefined}
                    />
                    {" / "}
                    <Amount amount={box.target} symbol={false} tone="ink" className="font-bold" />
                  </span>
                </div>
                <Bar filled={box.percent} over={box.over} />
                {box.over && (
                  <p className="text-xs text-danger">
                    Over by <Amount amount={-box.left} tone="danger" className="font-bold" />
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}

        <Card className="mt-3 flex items-center justify-between p-4 text-xs text-muted">
          <span>Spent this month</span>
          <span>
            <Amount amount={view.totalSpent} tone="ink" className="font-bold" /> of{" "}
            <Amount amount={view.totalTarget} tone="ink" className="font-bold" />
          </span>
        </Card>
      </section>

      {action && (
        <ActionSheet action={action} onClose={() => setAction(null)} onDone={setToast} />
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </>
  );
}
