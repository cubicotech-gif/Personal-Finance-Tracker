"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import { IconRefresh } from "@tabler/icons-react";

const TRIGGER = 64;
const MAX = 96;
/** Finger travel is damped so the pull feels like it has weight. */
const RESISTANCE = 0.5;
/** Keep the spinner up long enough to be seen even when the work is instant. */
const MIN_SPIN_MS = 700;

/**
 * Pull down from the top of the page to run `onRefresh`. Only starts when the
 * page is already scrolled to the top, so it never fights normal scrolling.
 */
export function PullToRefresh({ onRefresh, children }: { onRefresh: () => Promise<void>; children: ReactNode }) {
  const reduce = useReducedMotion();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [touching, setTouching] = useState(false);
  const startY = useRef<number | null>(null);
  const pulled = useRef(0);
  const busy = useRef(false);
  const refresh = useRef(onRefresh);

  useEffect(() => {
    refresh.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    function onStart(event: TouchEvent) {
      startY.current = window.scrollY <= 0 && !busy.current ? event.touches[0]!.clientY : null;
      pulled.current = 0;
      setTouching(startY.current !== null);
    }

    function onMove(event: TouchEvent) {
      if (startY.current === null) return;
      const dy = event.touches[0]!.clientY - startY.current;
      if (dy <= 0 || window.scrollY > 0) {
        pulled.current = 0;
        setPull(0);
        return;
      }
      pulled.current = Math.min(MAX, dy * RESISTANCE);
      setPull(pulled.current);
    }

    async function onEnd() {
      if (startY.current === null) return;
      startY.current = null;
      setTouching(false);
      if (pulled.current < TRIGGER) {
        setPull(0);
        return;
      }
      busy.current = true;
      setRefreshing(true);
      setPull(TRIGGER * 0.75);
      try {
        await Promise.all([refresh.current(), new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS))]);
      } finally {
        busy.current = false;
        setRefreshing(false);
        setPull(0);
      }
    }

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const armed = pull >= TRIGGER;
  const shift = reduce ? 0 : pull;

  return (
    <div>
      <div
        aria-hidden={!refreshing && pull === 0}
        role="status"
        className="pointer-events-none flex h-0 items-start justify-center overflow-visible text-muted"
        style={{ opacity: Math.min(1, pull / TRIGGER) }}
      >
        <span className="flex items-center gap-2" style={{ transform: `translateY(${Math.max(0, shift - 32)}px)` }}>
          <IconRefresh
            size={18}
            stroke={1.75}
            className={refreshing && !reduce ? "animate-spin" : undefined}
            style={reduce || refreshing ? undefined : { transform: `rotate(${pull * 4}deg)` }}
          />
          <span className="t-label">{refreshing ? "Recalculating" : armed ? "Release" : "Pull to refresh"}</span>
        </span>
      </div>
      <div
        style={{
          transform: shift ? `translateY(${shift}px)` : undefined,
          transition: touching ? undefined : "transform 200ms ease-out",
        }}
      >
        {children}
      </div>
    </div>
  );
}
