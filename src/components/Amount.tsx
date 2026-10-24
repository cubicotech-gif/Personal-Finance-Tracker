"use client";

import type { Currency, Minor } from "@/lib/money";
import { formatAmount, symbolFor } from "@/lib/format";
import { cx } from "./ui";

/**
 * The one place that decides how money looks.
 *
 * Monospaced and tabular so a column lines up, grouped the Pakistani way
 * (11,82,900 — not 1,182,900), and signed with a minus and a colour rather
 * than brackets, which are easy to miss on a phone.
 *
 * Amounts arrive as bigint minor units and are formatted as strings. No value
 * on this path is ever a JS number, so nothing can round.
 */
export function Amount({
  amount,
  currency = "PKR",
  signed = false,
  symbol = true,
  tone = "auto",
  className,
}: {
  amount: Minor;
  currency?: Currency;
  signed?: boolean;
  symbol?: boolean;
  /** "auto" reddens a negative; the rest are stated outright. */
  tone?: "auto" | "plain" | "ink" | "danger" | "positive";
  className?: string;
}) {
  const colour =
    tone === "danger"
      ? "text-danger"
      : tone === "positive"
        ? "text-positive"
        : tone === "ink"
          ? "text-ink"
          : tone === "auto" && amount < 0n
            ? "text-danger"
            : "";

  const text = formatAmount(amount, currency, { signed, compact: true, symbol: false });
  const sign = text.startsWith("-") || text.startsWith("+") ? text[0] : "";

  return (
    <span className={cx("num", colour, className)}>
      {sign}
      {symbol && <span className="mr-[0.15em] opacity-70">{symbolFor(currency)}</span>}
      {sign ? text.slice(1) : text}
    </span>
  );
}

/**
 * A figure in lakhs, for the header pill — "11.83L".
 *
 * Done on the bigint by integer division, not by dividing a float: the pill is
 * the first thing read on every screen and it is not allowed to drift.
 */
export function Lakh({ amount, className }: { amount: Minor; className?: string }) {
  const negative = amount < 0n;
  const paisa = negative ? -amount : amount;
  // 1 lakh = 100,000 rupees = 10,000,000 paisa. Two decimal places of a lakh
  // means scaling by 100 before the divide, then splitting the digits back.
  const hundredths = paisa / 100_000n;
  const whole = hundredths / 100n;
  const frac = (hundredths % 100n).toString().padStart(2, "0");

  return (
    <span className={cx("num", className)}>
      {negative ? "-" : ""}
      {whole.toString()}.{frac}L
    </span>
  );
}
