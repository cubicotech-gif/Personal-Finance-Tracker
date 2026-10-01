"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

/** ease-out cubic: fast start, long settle. */
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Tween a bigint to its new value over `ms`, instead of snapping.
 *
 * Interpolation is done in bigint (progress in thousandths), so a large
 * balance never passes through a float. `fromZero` counts up from 0 on first
 * render, for a hero figure. With reduced motion the target is returned as-is.
 */
export function useCountUp(target: bigint, ms = 400, fromZero = false): bigint {
  const reduce = useReducedMotion();
  const start = fromZero ? 0n : target;
  const [shown, setShown] = useState(start);
  const current = useRef(start);

  useEffect(() => {
    if (reduce || current.current === target) return;

    const from = current.current;
    const delta = target - from;
    const started = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / ms);
      const next = t >= 1 ? target : from + (delta * BigInt(Math.round(easeOut(t) * 1000))) / 1000n;
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms, reduce]);

  return reduce ? target : shown;
}
