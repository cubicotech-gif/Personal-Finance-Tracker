"use client";

import { useSyncExternalStore } from "react";
import { IconMoon, IconSun } from "@tabler/icons-react";

function subscribe(notify: () => void) {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

const read = () => document.documentElement.dataset.theme === "light";

/** Dark by default. A light choice is remembered on this device only. */
export function ThemeToggle() {
  const light = useSyncExternalStore(subscribe, read, () => false);

  function toggle() {
    const next = light ? "dark" : "light";
    if (next === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private mode: the choice just will not outlive the tab.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      className="flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:text-ink"
    >
      {light ? <IconMoon size={18} stroke={1.75} /> : <IconSun size={18} stroke={1.75} />}
    </button>
  );
}
