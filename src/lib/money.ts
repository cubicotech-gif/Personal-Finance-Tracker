/**
 * Money.
 *
 * Every amount in this app is a bigint count of MINOR units — paisa for PKR,
 * cents for USD. There is no `number` anywhere on this path, and no float
 * anywhere at all. The only places a money value changes representation are:
 *
 *   text (user input, wire format)  <->  bigint (everything else)
 *
 * The wire format is a decimal string of minor units ("125000"), never a JSON
 * number, because JSON numbers lose precision past 2^53 and PostgREST renders
 * bigint columns as JSON numbers by default.
 */

export type Minor = bigint;
export type Currency = "PKR" | "USD";

export const CURRENCIES: readonly Currency[] = ["PKR", "USD"] as const;

const DECIMALS: Record<Currency, number> = { PKR: 2, USD: 2 };
const SYMBOL: Record<Currency, string> = { PKR: "Rs", USD: "$" };

/** Exchange rates are held as integers scaled by 1e8, so conversion is exact. */
export const RATE_SCALE = 100_000_000n;
const RATE_DECIMALS = 8;

export function isCurrency(v: string): v is Currency {
  return (CURRENCIES as readonly string[]).includes(v);
}

/** Parse a wire string into minor units. Throws on anything unparseable. */
export function minor(wire: string | number | bigint): Minor {
  if (typeof wire === "bigint") return wire;
  // A number here means a bigint column leaked through as a JSON number
  // somewhere; BigInt() rejects non-integers, which is the failure we want.
  return BigInt(wire);
}

/** Render minor units back to the wire format. */
export function wire(m: Minor): string {
  return m.toString();
}

export function abs(m: Minor): Minor {
  return m < 0n ? -m : m;
}

export function sum(values: Iterable<Minor>): Minor {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

/** Integer division rounding half away from zero. */
function divRound(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("divide by zero");
  const negative = a < 0n !== b < 0n;
  const na = a < 0n ? -a : a;
  const nb = b < 0n ? -b : b;
  const q = na / nb;
  const rounded = (na % nb) * 2n >= nb ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/**
 * Parse a human-typed decimal into a scaled integer.
 * Accepts "1,234.5", " 1234 ", "-12.345", ".5", "Rs 300".
 * Returns null for anything that is not a number.
 */
export function parseDecimal(input: string, decimals: number): bigint | null {
  const cleaned = input
    .trim()
    .replace(/^(rs\.?|pkr|usd|\$)\s*/i, "")
    .replace(/[,\s_]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;

  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;

  const [, sign, whole = "", frac = ""] = match;
  if (whole === "" && frac === "") return null;

  // Keep one extra digit so we can round the rest half-away-from-zero rather
  // than silently truncating what was typed.
  const padded = frac.padEnd(decimals + 1, "0");
  const kept = padded.slice(0, decimals);
  const next = padded.slice(decimals, decimals + 1);

  let value = BigInt((whole === "" ? "0" : whole) + (kept === "" ? "" : kept));
  if (next !== "" && Number(next) >= 5) value += 1n;
  return sign === "-" ? -value : value;
}

/** Parse a typed amount into minor units for the given currency. */
export function parseAmount(input: string, currency: Currency): Minor | null {
  return parseDecimal(input, DECIMALS[currency]);
}

/** Parse a typed exchange rate into the 1e8-scaled integer form. */
export function parseRate(input: string): bigint | null {
  const value = parseDecimal(input, RATE_DECIMALS);
  return value === null || value <= 0n ? null : value;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function splitScaled(value: bigint, decimals: number): [sign: string, whole: string, frac: string] {
  const negative = value < 0n;
  const raw = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const cut = raw.length - decimals;
  return [negative ? "-" : "", raw.slice(0, cut), decimals === 0 ? "" : raw.slice(cut)];
}

export interface FormatOptions {
  /** Prefix with the currency symbol. */
  symbol?: boolean;
  /** Always show a sign, including "+" for positive values. */
  signed?: boolean;
  /** Drop ".00" when the amount is whole — used in dense list rows. */
  compact?: boolean;
}

export function formatMinor(m: Minor, currency: Currency, opts: FormatOptions = {}): string {
  const decimals = DECIMALS[currency];
  const [sign, whole, frac] = splitScaled(m, decimals);
  const showFrac = !(opts.compact && /^0*$/.test(frac));
  const body = groupThousands(whole) + (showFrac && frac !== "" ? `.${frac}` : "");
  const prefix = opts.symbol === false ? "" : `${SYMBOL[currency]} `;
  const displaySign = sign === "-" ? "-" : opts.signed && m > 0n ? "+" : "";
  return `${displaySign}${prefix}${body}`;
}

export function formatRate(scaled: bigint): string {
  const [sign, whole, frac] = splitScaled(scaled, RATE_DECIMALS);
  const trimmed = frac.replace(/0+$/, "");
  return `${sign}${whole}${trimmed === "" ? "" : `.${trimmed}`}`;
}

/**
 * Convert an amount to PKR using a 1e8-scaled rate.
 * PKR passes through untouched so the common path is free and exact.
 */
export function toPkr(m: Minor, currency: Currency, rateScaled: bigint | undefined): Minor {
  if (currency === "PKR") return m;
  if (rateScaled === undefined) {
    throw new Error(`no PKR rate available for ${currency}`);
  }
  return divRound(m * rateScaled, RATE_SCALE);
}

/** True when the currency needs a rate before it can be shown in PKR. */
export function needsRate(currency: Currency): boolean {
  return currency !== "PKR";
}
