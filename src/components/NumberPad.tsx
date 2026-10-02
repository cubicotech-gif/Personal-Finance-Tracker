"use client";

import { useRef } from "react";
import { IconBackspace } from "@tabler/icons-react";
import type { PadKey } from "@/lib/pad";
import { cx } from "./ui";

const LAYOUT: PadKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];

const KEY =
  "flex h-full min-h-11 items-center justify-center rounded-2xl bg-surface text-[24px] font-medium tabular " +
  "select-none transition-[background-color,transform] duration-100 active:scale-[0.97] active:bg-raised " +
  "focus-visible:outline-2 focus-visible:outline-accent";

/**
 * A custom number pad, so the system keyboard never opens. Presentational:
 * it reports keys and the owner applies them with `padInput`. Holding the
 * backspace key clears the whole amount.
 */
export function NumberPad({ onKey, className }: { onKey: (key: PadKey) => void; className?: string }) {
  const hold = useRef<number | null>(null);
  const cleared = useRef(false);

  function startHold() {
    cleared.current = false;
    hold.current = window.setTimeout(() => {
      cleared.current = true;
      onKey("clear");
    }, 450);
  }
  function endHold() {
    if (hold.current !== null) window.clearTimeout(hold.current);
    hold.current = null;
  }

  return (
    <div role="group" aria-label="Number pad" className={cx("grid grid-cols-3 grid-rows-4 gap-2", className)}>
      {LAYOUT.map((key) =>
        key === "back" ? (
          <button
            key={key}
            type="button"
            aria-label="Delete"
            className={cx(KEY, "text-muted")}
            onPointerDown={startHold}
            onPointerUp={endHold}
            onPointerLeave={endHold}
            onPointerCancel={endHold}
            onClick={() => {
              if (!cleared.current) onKey("back");
            }}
          >
            <IconBackspace size={24} stroke={1.75} />
          </button>
        ) : (
          <button key={key} type="button" className={KEY} onClick={() => onKey(key)}>
            {key}
          </button>
        ),
      )}
    </div>
  );
}
