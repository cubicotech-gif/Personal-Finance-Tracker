"use client";

import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { usePrivacy } from "@/lib/privacy";

/** Blur every figure on screen, for when someone else can see it. */
export function PrivacyToggle() {
  const { private: hidden, toggle } = usePrivacy();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={hidden}
      aria-label={hidden ? "Show amounts" : "Hide amounts"}
      className="flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:text-ink"
    >
      {hidden ? <IconEyeOff size={18} stroke={1.75} /> : <IconEye size={18} stroke={1.75} />}
    </button>
  );
}
