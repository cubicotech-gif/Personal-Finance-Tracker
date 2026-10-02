"use client";

import { useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Money } from "@/components/Money";
import { cx } from "@/components/ui";
import { formatAmount } from "@/lib/format";
import { boxProgress, type Box } from "@/lib/ledger/boxes";
import type { BorrowBadge } from "@/lib/ledger/box-badges";

const HOLD_MS = 450;
/** Finger travel, in px, that turns a press into a scroll and cancels the hold. */
const SLOP = 8;

/**
 * One box. Press and hold opens its sheet; Enter or Space does the same from a
 * keyboard. A plain tap does nothing, so scrolling past a card never opens it.
 */
export function BoxCard({
  box,
  badge,
  onOpen,
}: {
  box: Box;
  badge?: BorrowBadge;
  onOpen: (box: Box) => void;
}) {
  const reduce = useReducedMotion();
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const over = box.isOverspent;
  const progress = boxProgress(box);
  // What the box had to spend this period, carry-in and moves included.
  const budget = box.spent + box.available;

  function cancel() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }

  function start(event: React.PointerEvent) {
    origin.current = { x: event.clientX, y: event.clientY };
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
      onOpen(box);
    }, HOLD_MS);
  }

  function move(event: React.PointerEvent) {
    if (!origin.current) return;
    if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > SLOP) cancel();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${box.category.name}, ${formatAmount(box.available, "PKR")} left. Hold to assign, move or borrow.`}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(box);
        }
      }}
      className="relative select-none overflow-hidden rounded-2xl bg-surface p-4 transition-transform duration-100 [-webkit-touch-callout:none] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-accent"
    >
      {over && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-danger" />}

      <div className="flex items-start justify-between gap-2">
        <span className="text-muted">
          <CategoryIcon name={box.category.name} hint={box.category.icon} size={22} />
        </span>
        {badge && (
          <span
            aria-label={badge.role === "lent" ? `Lent out ${badge.days} days` : `Owes ${badge.days} days`}
            className="t-label rounded-full bg-danger-soft px-2 py-0.5 text-danger"
            style={{ textTransform: "none", letterSpacing: 0 }}
          >
            {badge.days}d
          </span>
        )}
      </div>

      <p className="mt-3 truncate text-muted">{box.category.name}</p>
      <Money
        amount={box.available}
        tone={over ? "danger" : "plain"}
        className="t-section mt-0.5 block"
      />

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-label={`${box.category.name} spent`}
        className="mt-3 h-1 w-full overflow-hidden rounded-full bg-raised"
      >
        <motion.div
          className={cx("h-full rounded-full", over ? "bg-danger" : "bg-accent")}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(progress * 100, progress > 0 ? 2 : 0)}%` }}
          transition={{ duration: reduce ? 0 : 0.4, ease: "easeOut" }}
        />
      </div>

      <p className="mt-2 truncate text-xs text-muted">
        spent <Money amount={box.spent} symbol={false} tone="plain" /> of{" "}
        <Money amount={budget} symbol={false} tone="plain" />
      </p>
    </div>
  );
}
