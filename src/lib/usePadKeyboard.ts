"use client";

import { useEffect } from "react";
import type { PadKey } from "./pad";

/**
 * Let a hardware keyboard drive the number pad, so a screen built for a thumb
 * stays usable on a desktop. Ignores keystrokes aimed at a field or button.
 */
export function usePadKeyboard(onKey: (key: PadKey) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [role=button]")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^[0-9.]$/.test(event.key)) onKey(event.key as PadKey);
      else if (event.key === "Backspace") onKey("back");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKey, enabled]);
}
