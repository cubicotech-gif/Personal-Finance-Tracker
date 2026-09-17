"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Guard, Shell } from "@/components/Shell";
import { Money, MoneyWithPkr } from "@/components/Money";
import { Button, Card, Empty, ErrorNote, Input, SectionTitle, cx } from "@/components/ui";
import { rateMissing, useSnapshot } from "@/lib/ledger/snapshot";
import { accountBalances, realMoneyAccounts, summarise } from "@/lib/ledger/accounts";
import { upsertRate } from "@/lib/db/mutations";
import { formatRate, parseRate, type Minor } from "@/lib/money";
import { today } from "@/lib/dates";

export default function AccountsPage() {
  return (
    <Guard>
      <Shell title="Accounts">
        <AccountsScreen />
      </Shell>
    </Guard>
  );
}

function Stat({
  label,
  amount,
  hint,
  tone = "auto",
  large = false,
}: {
  label: string;
  amount: Minor;
  hint?: string;
  tone?: "auto" | "plain" | "danger" | "positive";
  large?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className={cx("truncate font-medium", large ? "text-sm" : "text-sm")}>{label}</p>
        {hint && <p className="truncate text-xs text-muted">{hint}</p>}
      </div>
      <Money
        amount={amount}
        tone={tone}
        className={cx("shrink-0 font-semibold", large ? "text-lg" : "text-base")}
      />
    </div>
  );
}

function AccountsScreen() {
  const snapshot = useSnapshot();
  const balances = useMemo(() => accountBalances(snapshot), [snapshot]);
  const summary = useMemo(() => summarise(balances), [balances]);
  const rows = useMemo(() => realMoneyAccounts(balances), [balances]);

  const assets = rows.filter((row) => row.account.type === "asset");
  const liabilities = rows.filter((row) => row.account.type === "liability");
  const hasUsd = snapshot.accounts.some((account) => account.currency === "USD");

  return (
    <div className="space-y-6">
      <Card className="divide-y divide-line">
        <Stat label="Mine" hint="free to spend" amount={summary.mine} tone="plain" large />
        <Stat label="Held for others" hint="float owed to clients" amount={summary.heldForOthers} tone="plain" />
        <Stat
          label="Float shortfall"
          hint={
            summary.floatShortfall < 0n
              ? "float money already spent — must be returned"
              : "float is fully backed"
          }
          amount={summary.floatShortfall}
          tone={summary.floatShortfall < 0n ? "danger" : "plain"}
        />
      </Card>

      <Card className="divide-y divide-line">
        <Stat label="Net worth" hint="assets − liabilities" amount={summary.netWorth} tone="plain" large />
      </Card>

      {hasUsd && <RateCard />}

      <section>
        <SectionTitle
          action={
            <Link href="/setup" className="text-xs font-medium text-accent underline">
              Add accounts
            </Link>
          }
        >
          Assets
        </SectionTitle>
        {assets.length === 0 ? <Empty>No asset accounts.</Empty> : <AccountList rows={assets} />}
      </section>

      {liabilities.length > 0 && (
        <section>
          <SectionTitle>Liabilities</SectionTitle>
          <AccountList rows={liabilities} />
        </section>
      )}
    </div>
  );
}

function AccountList({ rows }: { rows: ReturnType<typeof accountBalances> }) {
  const snapshot = useSnapshot();
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {rows.map(({ account, native, pkr, currency }) => (
        <li key={account.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{account.name}</p>
            <p className="text-xs text-muted">
              {account.is_float ? "float · " : ""}
              {account.type}
              {account.archived ? " · archived" : ""}
            </p>
          </div>
          {currency === "PKR" ? (
            // Liabilities read as credit balances; show what is owed, positively.
            <Money
              amount={account.type === "liability" ? -native : native}
              currency={currency}
              className="shrink-0 text-sm font-medium"
              tone="plain"
            />
          ) : (
            <MoneyWithPkr
              amount={account.type === "liability" ? -native : native}
              currency={currency}
              pkr={account.type === "liability" ? -pkr : pkr}
              rateMissing={rateMissing(snapshot, currency)}
              className="shrink-0 text-sm font-medium"
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Rates are entered by hand and dated — there is no rate API and no FX gain or
 * loss accounting. Every conversion on every screen uses the latest one.
 */
function RateCard() {
  const snapshot = useSnapshot();
  const current = snapshot.rates.get("USD");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function save() {
    const scaled = parseRate(value);
    if (scaled === null) {
      setError("Enter a rate greater than zero");
      return;
    }
    await upsertRate("USD", today(), scaled);
    setValue("");
    setError(null);
    setOpen(false);
  }

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">PKR per USD</p>
          <p className="text-xs text-muted">
            {current ? `${formatRate(current)} — used for all conversions` : "not set yet"}
          </p>
        </div>
        {!open && (
          <Button type="button" onClick={() => setOpen(true)}>
            Update
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          <Input
            autoFocus
            inputMode="decimal"
            placeholder="278.50"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <ErrorNote>{error}</ErrorNote>
          <div className="flex gap-2">
            <Button type="button" variant="primary" onClick={save} className="flex-1">
              Save rate
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
