"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { TABBAR } from "./Shell";
import { cx } from "./ui";

export interface ToastState {
  /** Changes with every toast, so a new one restarts the timer. */
  id: number;
  message: string;
  tone?: "default" | "error";
  action?: { label: string; run: () => void };
}

export const TOAST_MS = 5000;

/**
 * One toast at a time, bottom of the screen above whatever is pinned there.
 * Never a dialog: the action is optional and the toast goes away on its own.
 * Only the action takes taps; everything else passes through, so the toast
 * never blocks the keys it floats over.
 */
export function Toast({
  toast,
  onDone,
  lift = 0,
}: {
  toast: ToastState | null;
  onDone: (id: number) => void;
  /** Extra px to sit above the tab bar, e.g. for a pinned save button. */
  lift?: number;
}) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => onDone(toast.id), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast, onDone]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 mx-auto flex max-w-lg justify-center px-4"
      style={{ bottom: `calc(${TABBAR} + ${lift}px + 8px)` }}
    >
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            role="status"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={cx(
              "pointer-events-none relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-2xl px-4 py-3",
              toast.tone === "error" ? "bg-raised text-danger" : "bg-raised text-ink",
            )}
          >
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action?.run();
                  onDone(toast.id);
                }}
                className="pointer-events-auto -my-2 -mr-2 min-h-11 rounded-xl px-3 font-medium text-accent"
              >
                {toast.action.label}
              </button>
            )}
            {!reduce && (
              <motion.span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-accent"
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{ duration: TOAST_MS / 1000, ease: "linear" }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
