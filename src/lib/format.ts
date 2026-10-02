import type { Currency, Minor } from "@/lib/money";

/**
 * How money is shown. Presentation only: amounts stay bigint minor units, and
 * nothing here parses or does arithmetic on them.
 *
 * PKR is grouped the Pakistani way — the last three digits, then pairs:
 * 14,10,000, not 1,410,000. USD keeps ordinary thousands grouping, because a
 * dollar figure that reads like a rupee figure is a way to misread it.
 */

export const PKR_SYMBOL = "₨";

const SYMBOL: Record<Currency, string> = { PKR: PKR_SYMBOL, USD: "$" };

/** 1410000 -> "14,10,000". */
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${digits.slice(-3)}`;
}

/** 1410000 -> "1,410,000". */
export function groupWestern(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function groupDigits(digits: string, currency: Currency): string {
  return currency === "PKR" ? groupIndian(digits) : groupWestern(digits);
}

export function symbolFor(currency: Currency): string {
  return SYMBOL[currency];
}

export interface FormatOptions {
  /** Prefix with the currency symbol. Default true. */
  symbol?: boolean;
  /** Show "+" on positive values. */
  signed?: boolean;
  /** Drop ".00" on whole amounts. Default true: paisa are rare and noisy. */
  compact?: boolean;
}

export function formatAmount(m: Minor, currency: Currency, opts: FormatOptions = {}): string {
  const { symbol = true, signed = false, compact = true } = opts;
  const negative = m < 0n;
  const raw = (negative ? -m : m).toString().padStart(3, "0");
  const whole = raw.slice(0, -2);
  const frac = raw.slice(-2);

  const body = groupDigits(whole, currency) + (compact && frac === "00" ? "" : `.${frac}`);
  const sign = negative ? "-" : signed && m > 0n ? "+" : "";
  return `${sign}${symbol ? SYMBOL[currency] : ""}${body}`;
}

/**
 * Format a number pad string as it is typed: "1410000.5" -> "14,10,000.5".
 * Keeps a trailing "." and trailing zeros, which formatAmount would drop.
 */
export function formatTyped(typed: string, currency: Currency): string {
  if (typed === "") return "0";
  const [whole = "", frac] = typed.split(".");
  const grouped = groupDigits(whole === "" ? "0" : whole, currency);
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}
