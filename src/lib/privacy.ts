"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Private mode: blur every figure on screen until it is turned back off.
 *
 * This exists because the app gets opened in front of other people — on a
 * desk, in a shop, with someone looking over a shoulder — and a screen full of
 * balances is not always something you want readable at a glance.
 *
 * Blur rather than hiding: the layout does not move, and it reads as
 * deliberate rather than broken. The real value stays in the DOM, so screen
 * readers and copy still work. This is cover from a passing glance, not a
 * security feature, and it should not pretend to be one.
 *
 * Kept in localStorage and read through useSyncExternalStore rather than
 * mirrored into state, so there is no render with the wrong value and no
 * provider to thread through the tree.
 */

const KEY = "pft-private";

const listeners = new Set<() => void>();

function subscribe(notify: () => void) {
  listeners.add(notify);
  // Another tab toggling it should move this one too.
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    // Private window, or storage blocked. Off is the right default.
    return false;
  }
}

/** Server and first client paint agree: always off until storage is read. */
const readServer = () => false;

export function usePrivacy(): { private: boolean; toggle: () => void } {
  const isPrivate = useSyncExternalStore(subscribe, read, readServer);

  const toggle = useCallback(() => {
    try {
      localStorage.setItem(KEY, read() ? "0" : "1");
    } catch {
      // Not being able to remember the choice is no reason to refuse it.
    }
    for (const notify of listeners) notify();
  }, []);

  return { private: isPrivate, toggle };
}
