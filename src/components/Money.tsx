"use client";

import { type Currency, type Minor, formatMinor } from "@/lib/money";
import { cx } from "./ui";

/**
 * One place that decides how money looks. Every amount is tabular-figure so
 * columns align, and the sign is expressed with colour and a minus, never with
 * parentheses, which are easy to miss on a phone.
 */
export function Money({
  amount,
  currency = "PKR",
  signed = false,
  compact = false,
  symbol = true,
  tone = "auto",
  className,
}: {
  amount: Minor;
  currency?: Currency;
  signed?: boolean;
  compact?: boolean;
  symbol?: boolean;
  /** "auto" colours negatives red; "plain" never colours; "danger" always does. */
  tone?: "auto" | "plain" | "danger" | "positive";
  className?: string;
}) {
  const colour =
    tone === "danger"
      ? "text-danger"
      : tone === "positive"
        ? "text-positive"
        : tone === "auto" && amount < 0n
          ? "text-danger"
          : "";

  return (
    <span className={cx("tabular", colour, className)}>
      {formatMinor(amount, currency, { signed, compact, symbol })}
    </span>
  );
}

/** A non-PKR amount with its PKR equivalent underneath. */
export function MoneyWithPkr({
  amount,
  currency,
  pkr,
  rateMissing,
  className,
}: {
  amount: Minor;
  currency: Currency;
  pkr: Minor;
  rateMissing?: boolean;
  className?: string;
}) {
  return (
    <span className={cx("flex flex-col items-end leading-tight", className)}>
      <Money amount={amount} currency={currency} />
      {currency !== "PKR" &&
        (rateMissing ? (
          <span className="text-xs text-danger">no PKR rate set</span>
        ) : (
          <span className="text-xs text-muted">
            ≈ <Money amount={pkr} currency="PKR" compact tone="plain" />
          </span>
        ))}
    </span>
  );
}
