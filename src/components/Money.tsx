"use client";

import type { Currency, Minor } from "@/lib/money";
import { formatAmount, symbolFor } from "@/lib/format";
import { useCountUp } from "@/lib/useCountUp";
import { cx } from "./ui";

/**
 * The one place that decides how money looks, and how it moves. Digits are
 * tabular so they do not jitter, the format is Pakistani-style for PKR, and a
 * changed value counts to its new figure over 400ms rather than snapping.
 *
 * Sign is shown with a minus and colour, never parentheses, which are easy to
 * miss on a phone.
 */
export function Money({
  amount,
  currency = "PKR",
  signed = false,
  compact = true,
  symbol = true,
  tone = "auto",
  animate = true,
  countOnMount = false,
  className,
}: {
  amount: Minor;
  currency?: Currency;
  signed?: boolean;
  compact?: boolean;
  symbol?: boolean;
  /** "auto" colours negatives red; "plain" never colours; "danger" always does. */
  tone?: "auto" | "plain" | "danger" | "positive";
  animate?: boolean;
  /** Count up from zero when first shown. For hero figures. */
  countOnMount?: boolean;
  className?: string;
}) {
  const counted = useCountUp(amount, 400, countOnMount);
  const shown = animate ? counted : amount;

  const colour =
    tone === "danger"
      ? "text-danger"
      : tone === "positive"
        ? "text-positive"
        : tone === "auto" && shown < 0n
          ? "text-danger"
          : "";

  // The symbol is its own span so it can be spaced from the digits: the
  // typeface has no thin space, and a glued "₨13" reads as one token.
  const text = formatAmount(shown, currency, { signed, compact, symbol: false });
  const sign = text.startsWith("-") || text.startsWith("+") ? text[0] : "";

  return (
    <span className={cx("tabular", colour, className)}>
      {sign}
      {symbol && <span className="mr-[0.12em]">{symbolFor(currency)}</span>}
      {sign ? text.slice(1) : text}
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
            ≈ <Money amount={pkr} currency="PKR" tone="plain" />
          </span>
        ))}
    </span>
  );
}
