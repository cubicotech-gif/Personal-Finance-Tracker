/**
 * The number pad's input rules, kept apart from the component so they can be
 * tested. The pad edits a plain decimal string; `parseAmount` turns it into
 * minor units on save exactly as it did for the text field it replaces.
 */

export type PadKey = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "." | "back" | "clear";

/** Whole-part digit cap: far beyond any real figure, short of overflowing the screen. */
const MAX_WHOLE = 12;
const MAX_FRAC = 2;

export function padInput(value: string, key: PadKey): string {
  if (key === "clear") return "";
  if (key === "back") return value.slice(0, -1);

  const dot = value.indexOf(".");

  if (key === ".") {
    if (dot !== -1) return value;
    return value === "" ? "0." : `${value}.`;
  }

  if (dot !== -1) {
    return value.length - dot - 1 >= MAX_FRAC ? value : value + key;
  }
  if (value === "0") return key === "0" ? value : key;
  return value.length >= MAX_WHOLE ? value : value + key;
}

/**
 * Minor units back to the string the pad edits, without a float: 125050n is
 * "1250.5", 125000n is "1250". Used to pre-fill "the full amount".
 */
export function minorToTyped(value: bigint): string {
  const digits = (value < 0n ? -value : value).toString().padStart(3, "0");
  const whole = digits.slice(0, -2);
  const frac = digits.slice(-2).replace(/0+$/, "");
  return frac === "" ? whole : `${whole}.${frac}`;
}
