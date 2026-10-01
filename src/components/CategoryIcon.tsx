"use client";

import { createElement } from "react";

import {
  IconBriefcase,
  IconBulb,
  IconCash,
  IconCircleDot,
  IconDeviceMobile,
  IconGift,
  IconHome,
  IconMotorbike,
  IconPill,
  IconPlane,
  IconSchool,
  IconShoppingCart,
  IconTarget,
  IconToolsKitchen2,
  IconUsers,
  type Icon,
} from "@tabler/icons-react";

/**
 * Categories store an emoji (or any short string) in `icon`. The interface
 * draws Tabler line icons instead, so the stored value is only a hint: first
 * the emoji the app seeds, then keywords in the name, then a neutral dot.
 */
const BY_EMOJI: Record<string, Icon> = {
  "🏠": IconHome,
  "💡": IconBulb,
  "🛒": IconShoppingCart,
  "🛵": IconMotorbike,
  "🍔": IconToolsKitchen2,
  "💊": IconPill,
  "👪": IconUsers,
  "🎯": IconTarget,
};

const BY_KEYWORD: [RegExp, Icon][] = [
  [/rent|home|house/, IconHome],
  [/util|electric|gas|water|bill/, IconBulb],
  [/grocer|shop|market/, IconShoppingCart],
  [/transport|fuel|petrol|bike|car|ride/, IconMotorbike],
  [/eat|food|dining|restaurant|lunch|dinner/, IconToolsKitchen2],
  [/health|medic|pharm|doctor/, IconPill],
  [/family|kids|parents/, IconUsers],
  [/saving|goal|invest/, IconTarget],
  [/school|educat|fees|course/, IconSchool],
  [/phone|internet|mobile|data/, IconDeviceMobile],
  [/gift|charity|zakat|sadaq/, IconGift],
  [/travel|trip|flight/, IconPlane],
];

export function iconFor(name: string, hint = ""): Icon {
  const emoji = BY_EMOJI[hint.trim()];
  if (emoji) return emoji;
  const lower = name.toLowerCase();
  return BY_KEYWORD.find(([pattern]) => pattern.test(lower))?.[1] ?? IconCircleDot;
}

export function CategoryIcon({
  name,
  hint,
  size = 22,
  className,
}: {
  name: string;
  hint?: string;
  size?: number;
  className?: string;
}) {
  // Picked from a fixed table, so the element type is stable across renders.
  return createElement(iconFor(name, hint), { size, stroke: 1.75, className, "aria-hidden": true });
}

/** Income sources have no stored icon; the name is all there is to go on. */
export function SourceIcon({ name, size = 22 }: { name: string; size?: number }) {
  const Glyph = /salary|wage|job|work|client|business/i.test(name) ? IconBriefcase : IconCash;
  return <Glyph size={size} stroke={1.75} aria-hidden />;
}
