"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

/**
 * The pieces the reference design is built from: a slate card with a one-pixel
 * border and a 24px radius, a small all-caps heading, a pill, a bar.
 *
 * Tap targets are 44px minimum throughout — this is a phone-first app.
 */
const TAP = "min-h-11";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  children,
  className,
  tone = "plain",
}: {
  children: ReactNode;
  className?: string;
  /** A hero card is tinted; an ordinary card is flat slate. */
  tone?: "plain" | "accent" | "danger";
}) {
  const tones = {
    plain: "border-line bg-surface",
    accent: "border-accent-line bg-gradient-to-br from-accent-soft to-surface",
    danger: "border-danger-line bg-gradient-to-br from-danger-soft to-surface",
  }[tone];

  return <div className={cx("rounded-3xl border", tones, className)}>{children}</div>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="t-label text-muted">{children}</h2>
      {aside && <span className="text-xs text-faint">{aside}</span>}
    </div>
  );
}

/** The small bordered badge the design uses for CALLABLE / TERM and the like. */
export function Pill({
  children,
  tone = "plain",
  className,
}: {
  children: ReactNode;
  tone?: "plain" | "accent" | "danger" | "move";
  className?: string;
}) {
  const tones = {
    plain: "border-line bg-raised text-muted",
    accent: "border-accent-line bg-accent-soft text-accent-bright",
    danger: "border-danger-line bg-danger-soft text-danger",
    move: "border-move-line bg-move-soft text-move",
  }[tone];

  return (
    <span
      className={cx(
        "t-label inline-block rounded-full border px-2.5 py-1 leading-none",
        tones,
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A progress bar for a spending box.
 *
 * It fills emerald up to the target and turns red the moment it is passed,
 * which is the only state change that matters on this screen.
 */
export function Bar({ filled, over }: { filled: number; over: boolean }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-raised">
      <div
        className={cx(
          "h-full rounded-full transition-[width] duration-500",
          over ? "bg-danger" : "bg-gradient-to-r from-accent-bright to-accent",
        )}
        style={{ width: `${Math.max(0, Math.min(100, filled))}%` }}
      />
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({ variant = "secondary", className, ...props }: ButtonProps) {
  const styles = {
    primary: "bg-accent text-on-accent font-bold shadow-lg shadow-accent-soft hover:bg-accent-bright",
    secondary: "border border-line bg-raised text-ink hover:border-faint",
    ghost: "text-muted hover:text-ink",
  }[variant];

  return (
    <button
      {...props}
      className={cx(
        TAP,
        "inline-flex items-center justify-center gap-2 rounded-2xl px-4 text-[15px]",
        "transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        styles,
        className,
      )}
    />
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="t-label mb-1.5 block text-muted">
      {children}
    </label>
  );
}

const FIELD = cx(
  TAP,
  "w-full rounded-xl border border-line bg-canvas px-4 text-base text-ink",
  "focus:border-accent focus:outline-none",
);

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(FIELD, className)} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(FIELD, "appearance-none pr-10", className)}>
      {children}
    </select>
  );
}

/** Used wherever a list would otherwise render as a blank gap. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-faint">{children}</p>;
}
