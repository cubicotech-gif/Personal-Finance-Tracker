"use client";

import { formatTyped, symbolFor } from "@/lib/format";
import type { Currency } from "@/lib/money";
import { cx } from "./ui";

/** The amount shrinks as it grows so twelve digits still fit one line. */
function size(text: string): string {
  const n = text.length;
  if (n <= 9) return "text-[56px] short:text-[44px]";
  if (n <= 12) return "text-[44px] short:text-[36px]";
  if (n <= 15) return "text-[36px] short:text-[30px]";
  return "text-[28px]";
}

/** The amount being typed on a number pad: huge, tabular, right-aligned. */
export function AmountReadout({ value, currency = "PKR" }: { value: string; currency?: Currency }) {
  const text = formatTyped(value, currency);
  return (
    <div
      role="status"
      aria-label="Amount"
      className={cx(
        "tabular flex items-baseline justify-end gap-2 overflow-hidden font-medium leading-tight tracking-tight",
        size(text),
        value === "" ? "text-muted" : "text-ink",
      )}
    >
      <span className="text-muted">{symbolFor(currency)}</span>
      <span>{text}</span>
    </div>
  );
}
