"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Amount } from "@/components/Amount";
import { Button, Card, Input, Pill, SectionTitle, cx } from "@/components/ui";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { useApp } from "@/lib/sync/provider";
import {
  commitSetup,
  defaultSetup,
  previewTotals,
  validateSetup,
  type DebtRow,
  type SetupInput,
} from "@/lib/setup";

/**
 * The baseline, entered once.
 *
 * The names, targets and debts are already filled in. The only thing to type
 * is what is actually in each account right now, read off the banking apps.
 *
 * The loud warning at the top is not decoration. Running this twice adds a
 * second opening transaction rather than replacing the first, which doubles
 * every figure in the app — it has happened, and the numbers looked plausible
 * enough that it took a while to notice.
 */
export default function SetupPage() {
  const router = useRouter();
  const snapshot = useSnapshot();
  const { sync } = useApp();

  const [input, setInput] = useState<SetupInput>(defaultSetup);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const totals = useMemo(() => previewTotals(input), [input]);
  const alreadySetUp = snapshot.ready && snapshot.accounts.length > 0;

  function patch(update: Partial<SetupInput>) {
    setInput((current) => ({ ...current, ...update }));
  }

  function setRow<K extends "wallets" | "owed" | "owedToMe">(
    key: K,
    index: number,
    field: string,
    value: string | boolean,
  ) {
    patch({
      [key]: input[key].map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    } as Partial<SetupInput>);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found = validateSetup(input);
    setErrors(found);
    if (found.length > 0) return;

    setBusy(true);
    try {
      await commitSetup(input, snapshot);
      await sync();
      router.replace("/spend");
    } catch (cause) {
      setErrors([cause instanceof Error ? cause.message : "Could not save that"]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md space-y-5 p-4 pb-16">
      <header className="pt-4">
        <h1 className="text-xl font-bold text-white">Set up once</h1>
        <p className="mt-1 text-sm text-muted">
          Everything below is already filled in except the account balances. Open your banking
          apps and type what is actually in each one right now.
        </p>
      </header>

      {alreadySetUp && (
        <Card tone="danger" className="p-4">
          <p className="t-label text-danger">Stop — you already have data</p>
          <p className="mt-1.5 text-sm text-muted">
            There are already {snapshot.accounts.length} accounts here. Running this again
            <strong className="text-ink"> adds </strong>
            a second set of opening balances instead of replacing the first, which doubles every
            figure in the app. Go back unless you have cleared the database first.
          </p>
          <Button
            type="button"
            onClick={() => router.replace("/spend")}
            className="mt-3 w-full"
          >
            Take me back
          </Button>
        </Card>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        <section>
          <SectionTitle>As of</SectionTitle>
          <Input
            type="date"
            value={input.asOf}
            onChange={(event) => patch({ asOf: event.target.value })}
            className="num"
          />
        </section>

        <section>
          <SectionTitle aside={<Amount amount={totals.cash} />}>
            What is in each account
          </SectionTitle>
          <Card className="divide-y divide-line">
            {input.wallets.map((wallet, index) => (
              <div key={index} className="flex items-center gap-2 p-2.5">
                <Input
                  aria-label={`Account ${index + 1} name`}
                  value={wallet.name}
                  onChange={(event) => setRow("wallets", index, "name", event.target.value)}
                  className="flex-1 border-transparent bg-transparent px-2 text-sm"
                />
                <Input
                  aria-label={`${wallet.name} balance`}
                  inputMode="decimal"
                  placeholder="0"
                  value={wallet.amount}
                  onChange={(event) => setRow("wallets", index, "amount", event.target.value)}
                  className="num w-28 text-right text-sm"
                />
              </div>
            ))}
          </Card>
        </section>

        <DebtSection
          title="What you owe"
          rows={input.owed}
          total={totals.callable + totals.term}
          showCallable
          onChange={(index, field, value) => setRow("owed", index, field, value)}
        />

        <DebtSection
          title="What people owe you"
          rows={input.owedToMe}
          total={totals.owedToMe}
          onChange={(index, field, value) => setRow("owedToMe", index, field, value)}
        />

        <section>
          <SectionTitle aside={<Amount amount={totals.targets} />}>
            Monthly spending targets
          </SectionTitle>
          <Card className="divide-y divide-line">
            {input.boxes.map((box, index) => (
              <div key={index} className="flex items-center gap-2 p-2.5">
                <span className="w-6 text-center" aria-hidden>
                  {box.icon}
                </span>
                <span className="flex-1 truncate px-1 text-sm">{box.name}</span>
                <Input
                  aria-label={`${box.name} target`}
                  inputMode="decimal"
                  value={box.target}
                  onChange={(event) =>
                    patch({
                      boxes: input.boxes.map((b, i) =>
                        i === index ? { ...b, target: event.target.value } : b,
                      ),
                    })
                  }
                  className="num w-24 text-right text-sm"
                />
              </div>
            ))}
          </Card>
        </section>

        <Card className="space-y-1.5 p-4 text-xs">
          <Line label="Cash in the accounts" amount={totals.cash} />
          <Line label="Callable any day" amount={totals.callable} tone="danger" />
          <Line label="Term loans" amount={totals.term} tone="danger" />
          <Line label="Owed to you" amount={totals.owedToMe} tone="positive" />
          <div className="border-t border-line pt-2">
            <Line
              label="Net worth"
              amount={totals.cash + totals.owedToMe - totals.callable - totals.term}
              bold
            />
          </div>
        </Card>

        {errors.length > 0 && (
          <Card tone="danger" className="p-4">
            <ul className="space-y-1 text-sm text-danger">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </Card>
        )}

        <Button type="submit" variant="primary" disabled={busy} className="w-full py-3.5">
          {busy ? "Setting up…" : "That's right — set it up"}
        </Button>
      </form>
    </main>
  );
}

function DebtSection({
  title,
  rows,
  total,
  showCallable,
  onChange,
}: {
  title: string;
  rows: DebtRow[];
  total: bigint;
  showCallable?: boolean;
  onChange: (index: number, field: string, value: string | boolean) => void;
}) {
  return (
    <section>
      <SectionTitle aside={<Amount amount={total} />}>{title}</SectionTitle>
      <Card className="divide-y divide-line">
        {rows.map((row, index) => (
          <div key={index} className="space-y-2 p-3">
            <div className="flex items-center gap-2">
              <Input
                aria-label={`Name ${index + 1}`}
                value={row.name}
                onChange={(event) => onChange(index, "name", event.target.value)}
                className="flex-1 border-transparent bg-transparent px-2 text-sm"
              />
              <Input
                aria-label={`${row.name} amount`}
                inputMode="decimal"
                value={row.amount}
                onChange={(event) => onChange(index, "amount", event.target.value)}
                className="num w-28 text-right text-sm"
              />
            </div>
            <div className="flex items-center justify-between gap-2 px-2">
              <span className="truncate text-xs text-faint">{row.note || "—"}</span>
              {showCallable && (
                <button
                  type="button"
                  aria-pressed={row.callable}
                  onClick={() => onChange(index, "callable", !row.callable)}
                  className="shrink-0"
                >
                  <Pill tone={row.callable ? "danger" : "move"}>
                    {row.callable ? "callable" : "term"}
                  </Pill>
                </button>
              )}
            </div>
          </div>
        ))}
      </Card>
      {showCallable && (
        <p className="mt-2 px-1 text-xs text-faint">
          Tap the tag to change it. <strong className="text-muted">Callable</strong> means they can
          ask any day — client money, or something that landed by mistake.
          <strong className="text-muted"> Term</strong> means it has a shape to it.
        </p>
      )}
    </section>
  );
}

function Line({
  label,
  amount,
  tone = "ink",
  bold,
}: {
  label: string;
  amount: bigint;
  tone?: "ink" | "danger" | "positive";
  bold?: boolean;
}) {
  return (
    <p className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <Amount
        amount={amount}
        tone={tone === "ink" ? "auto" : tone}
        className={cx(bold ? "text-sm font-extrabold" : "font-bold")}
      />
    </p>
  );
}
