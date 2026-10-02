"use client";

import type { AccountRow } from "@/lib/db/types";
import type { Currency, Minor } from "@/lib/money";
import { type IsoDate, addDays, monthStart } from "@/lib/dates";
import { type Snapshot, entryAmount, pkr } from "./snapshot";

/**
 * Balances and the summary numbers on /accounts.
 *
 * Sign convention is plain double entry: a debit is positive. So asset and
 * expense balances are positive when they hold money, and liability, income and
 * equity balances are negative. Anything shown to the user as "owed" is negated
 * at the display boundary, never in the arithmetic.
 */

export interface AccountBalance {
  account: AccountRow;
  /** In the account's own currency. */
  native: Minor;
  /** The same amount converted to PKR at the latest rate. */
  pkr: Minor;
  currency: Currency;
  /**
   * True for an account that tracks what someone owes rather than money I can
   * reach. It still counts towards net worth, but never towards spendable cash.
   */
  isReceivable: boolean;
}

/**
 * Balances now, or as they stood at the end of `asOf` when given. Conversion
 * always uses the latest rate: rates are entered by hand and not kept as
 * history, so a past USD balance is valued at today's rate.
 */
export function accountBalances(snapshot: Snapshot, asOf?: IsoDate): AccountBalance[] {
  const totals = new Map<string, Minor>();
  // Derived, not named: an account is a receivable/payable because it carries
  // counterparty-tagged lines. composeEntries only ever puts a counterparty on
  // the debt leg, never on the account the money physically moved through, so
  // this identifies the role without depending on what the account is called.
  const withCounterparty = new Set<string>();

  for (const entry of snapshot.entries) {
    if (asOf !== undefined) {
      const bookedOn = snapshot.transactionsById.get(entry.transaction_id)?.booked_on;
      if (!bookedOn || bookedOn > asOf) continue;
    }
    totals.set(entry.account_id, (totals.get(entry.account_id) ?? 0n) + entryAmount(entry));
    if (entry.counterparty_id) withCounterparty.add(entry.account_id);
  }

  return snapshot.accounts.map((account) => {
    const native = totals.get(account.id) ?? 0n;
    return {
      account,
      native,
      pkr: pkr(snapshot, native, account.currency),
      currency: account.currency,
      isReceivable: withCounterparty.has(account.id),
    };
  });
}

export interface AccountsSummary {
  /**
   * My own cash, after setting aside anything I have already spent out of
   * float and still owe back.
   */
  mine: Minor;
  /** What I am holding on behalf of other people, as a positive number. */
  heldForOthers: Minor;
  /** Cash actually sitting in float accounts. */
  floatCash: Minor;
  /**
   * floatCash − heldForOthers. Negative means float money has been spent and
   * there is a hole to refill. This is never a budget envelope and is never
   * assignable.
   */
  floatShortfall: Minor;
  assets: Minor;
  liabilities: Minor;
  netWorth: Minor;
}

export function summarise(balances: AccountBalance[]): AccountsSummary {
  let nonFloatCash = 0n;
  let floatCash = 0n;
  let floatOwed = 0n;
  let assets = 0n;
  let liabilities = 0n;

  for (const { account, pkr: value, isReceivable } of balances) {
    if (account.archived && value === 0n) continue;

    if (account.type === "asset") {
      assets += value;
      // Money someone owes me is mine, but it is not cash and cannot be spent
      // or assigned until it actually arrives.
      if (isReceivable) continue;
      if (account.is_float) floatCash += value;
      else nonFloatCash += value;
    } else if (account.type === "liability") {
      // Liabilities carry a credit balance, so negate to get "amount owed".
      liabilities += -value;
      if (account.is_float) floatOwed += -value;
    }
  }

  const floatShortfall = floatCash - floatOwed;

  return {
    // "Free to spend" means exactly that: if float has been dipped into, the
    // hole comes out of my own cash, because that money is already promised.
    // A float surplus is not mine either, so only a shortfall moves this number.
    mine: nonFloatCash + (floatShortfall < 0n ? floatShortfall : 0n),
    heldForOthers: floatOwed,
    floatCash,
    floatShortfall,
    assets,
    liabilities,
    netWorth: assets - liabilities,
  };
}

/** Accounts that hold real money, in the order they should be listed. */
export function realMoneyAccounts(balances: AccountBalance[]): AccountBalance[] {
  return balances.filter(
    ({ account, native }) =>
      (account.type === "asset" || account.type === "liability") &&
      (!account.archived || native !== 0n),
  );
}

/** The most-used account, used to pre-select the account on /log. */
export function mostUsedAccountId(snapshot: Snapshot): string | undefined {
  const counts = new Map<string, number>();
  for (const entry of snapshot.entries) {
    const account = snapshot.accountsById.get(entry.account_id);
    if (!account || account.type !== "asset" || account.archived) continue;
    counts.set(entry.account_id, (counts.get(entry.account_id) ?? 0) + 1);
  }

  let best: string | undefined;
  let bestCount = -1;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best ?? snapshot.accounts.find((a) => a.type === "asset" && !a.archived)?.id;
}

export interface NetWorthChange {
  current: Minor;
  /** Net worth at the end of last month. */
  previous: Minor;
  delta: Minor;
  /** False when nothing was booked by then, so there is no month to compare to. */
  hasPrevious: boolean;
}

/** Net worth now against the close of last month. */
export function netWorthChange(snapshot: Snapshot, now: IsoDate): NetWorthChange {
  const lastMonthEnd = addDays(monthStart(now), -1);
  const current = summarise(accountBalances(snapshot)).netWorth;
  const previous = summarise(accountBalances(snapshot, lastMonthEnd)).netWorth;
  return {
    current,
    previous,
    delta: current - previous,
    hasPrevious: snapshot.transactions.some((transaction) => transaction.booked_on <= lastMonthEnd),
  };
}

export type AccountGroup = "float" | "operating" | "buffer" | "usd";

export const GROUP_ORDER: readonly AccountGroup[] = ["float", "operating", "buffer", "usd"];

export const GROUP_LABEL: Record<AccountGroup, string> = {
  float: "Float",
  operating: "Operating",
  buffer: "Buffer",
  usd: "USD",
};

/**
 * Which list an account sits in. Nothing in the data says "buffer" or
 * "operating", so this reads what is there: the float flag, the currency, and
 * — for the buffer — the name. Everything else is operating cash.
 */
export function groupOf(account: AccountRow): AccountGroup {
  if (account.is_float) return "float";
  if (account.currency !== "PKR") return "usd";
  if (/buffer|reserve|emergency|rainy|saving/i.test(account.name)) return "buffer";
  return "operating";
}
