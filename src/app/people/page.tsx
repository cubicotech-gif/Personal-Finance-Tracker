"use client";

import { useMemo, useState } from "react";
import { Guard, Shell } from "@/components/Shell";
import { Money } from "@/components/Money";
import { Button, Card, Chip, ChipRow, Empty, ErrorNote, Input, SectionTitle, cx } from "@/components/ui";
import { useSnapshot } from "@/lib/ledger/snapshot";
import { debtPositions, splitByKind, totalOf, type DebtPosition } from "@/lib/ledger/people";
import { accountsByUsage, composeEntries } from "@/lib/ledger/compose";
import { postTransaction } from "@/lib/db/mutations";
import { parseAmount, type Currency } from "@/lib/money";
import { formatDay, today } from "@/lib/dates";

export default function PeoplePage() {
  return (
    <Guard>
      <Shell title="People">
        <PeopleScreen />
      </Shell>
    </Guard>
  );
}

function PeopleScreen() {
  const snapshot = useSnapshot();
  const positions = useMemo(() => debtPositions(snapshot), [snapshot]);
  const { people, floatClients } = useMemo(() => splitByKind(positions), [positions]);

  const empty =
    people.owesMe.length === 0 &&
    people.iOwe.length === 0 &&
    floatClients.owesMe.length === 0 &&
    floatClients.iOwe.length === 0;

  if (empty) {
    return <Empty>Nobody owes anybody. Log a loan or a repayment from the Log tab.</Empty>;
  }

  return (
    <div className="space-y-8">
      <Group title="Owes me" positions={people.owesMe} />
      <Group title="I owe" positions={people.iOwe} />

      {(floatClients.owesMe.length > 0 || floatClients.iOwe.length > 0) && (
        <section className="space-y-6 rounded-xl border border-line bg-surface/60 p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Float clients</p>
          <Group title="Client owes me" positions={floatClients.owesMe} nested />
          <Group title="Holding for client" positions={floatClients.iOwe} nested />
        </section>
      )}
    </div>
  );
}

function Group({
  title,
  positions,
  nested = false,
}: {
  title: string;
  positions: DebtPosition[];
  nested?: boolean;
}) {
  if (positions.length === 0) return null;
  return (
    <section>
      <SectionTitle
        action={
          <span className="text-xs font-semibold text-muted">
            <Money amount={totalOf(positions)} tone="plain" />
          </span>
        }
      >
        {title}
      </SectionTitle>
      <ul className={cx("divide-y divide-line overflow-hidden rounded-xl border border-line", nested ? "bg-surface" : "bg-surface")}>
        {positions.map((position) => (
          <PersonRow key={position.counterparty.id} position={position} />
        ))}
      </ul>
    </section>
  );
}

function PersonRow({ position }: { position: DebtPosition }) {
  const [repaying, setRepaying] = useState(false);
  const overdue =
    position.dueOn !== null && position.dueOn < today();

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{position.counterparty.name}</p>
          <p className="truncate text-xs text-muted">
            {position.daysOutstanding !== null && (
              <>
                {position.daysOutstanding} day{position.daysOutstanding === 1 ? "" : "s"} outstanding
              </>
            )}
            {position.dueOn && (
              <span className={cx(overdue && "text-danger")}>
                {" · due "}
                {formatDay(position.dueOn)}
                {overdue ? " (overdue)" : ""}
              </span>
            )}
            {!position.dueOn && position.daysOutstanding !== null && " · no due date"}
          </p>
        </div>
        <Money
          amount={position.amountPkr}
          tone={overdue ? "danger" : "plain"}
          className="shrink-0 text-sm font-semibold"
        />
      </div>

      {!repaying ? (
        <button
          type="button"
          onClick={() => setRepaying(true)}
          className="mt-1 text-xs font-medium text-accent underline"
        >
          Record repayment
        </button>
      ) : (
        <RepaymentForm position={position} onDone={() => setRepaying(false)} />
      )}
    </li>
  );
}

/**
 * A repayment is an ordinary transaction, not a special kind of row. Partial
 * amounts therefore work without any extra machinery, and the FIFO ageing on
 * the position keeps counting from the oldest unpaid advance.
 */
function RepaymentForm({ position, onDone }: { position: DebtPosition; onDone: () => void }) {
  const snapshot = useSnapshot();
  const accounts = useMemo(() => accountsByUsage(snapshot).filter((a) => a.type === "asset"), [snapshot]);
  const [chosenId, setChosenId] = useState("");
  const [amount, setAmount] = useState("");

  // Derived rather than captured at mount: the first render sees an empty
  // snapshot, so a default stored in state would latch onto "".
  const accountId = chosenId || accounts[0]?.id || "";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const currency: Currency = snapshot.accountsById.get(accountId)?.currency ?? "PKR";
  const owesMe = position.direction === "owes_me";

  async function submit() {
    setError(null);
    const value = parseAmount(amount, currency);
    if (value === null || value <= 0n) {
      setError("Enter an amount");
      return;
    }

    setBusy(true);
    try {
      const entries = await composeEntries(snapshot, {
        bookedOn: today(),
        // They pay me back: money in. I pay them back: money out.
        direction: owesMe ? "in" : "out",
        kind: owesMe ? "receive_repayment" : "repay_debt",
        amount: value,
        accountId,
        counterpartyId: position.counterparty.id,
      });
      await postTransaction({
        booked_on: today(),
        payee: position.counterparty.name,
        note: owesMe ? "Repayment received" : "Repayment paid",
        entries,
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record repayment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-2 space-y-2 p-2">
      <ChipRow label="Account">
        {accounts.map((account) => (
          <Chip key={account.id} selected={accountId === account.id} onClick={() => setChosenId(account.id)}>
            {account.name}
          </Chip>
        ))}
      </ChipRow>
      <Input
        autoFocus
        inputMode="decimal"
        aria-label="Repayment amount"
        placeholder={owesMe ? "Amount received" : "Amount paid"}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <ErrorNote>{error}</ErrorNote>
      <div className="flex gap-2">
        <Button type="button" variant="primary" onClick={submit} disabled={busy} className="flex-1">
          {busy ? "Saving…" : "Record"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
