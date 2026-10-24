"use client";

import { useEffect } from "react";

/** The green confirmation the reference design drops in from the top. */
export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 2600);
    return () => clearTimeout(timer);
  }, [message, onDone]);

  return (
    <div
      role="status"
      className="fade-in fixed top-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-accent px-5 py-3 font-semibold text-on-accent shadow-2xl"
    >
      <span aria-hidden>✅</span>
      {message}
    </div>
  );
}
