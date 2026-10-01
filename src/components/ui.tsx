"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

/** Tap targets are 44px minimum throughout — this is a phone-first app. */
const TAP = "min-h-11";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-2xl bg-surface", className)}>{children}</div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <h2 className="t-label text-muted">{children}</h2>
      {action}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({ variant = "secondary", className, ...props }: ButtonProps) {
  const styles = {
    primary: "bg-accent text-on-accent hover:opacity-90 disabled:bg-raised disabled:text-muted",
    secondary: "bg-raised hover:opacity-90",
    ghost: "text-muted hover:text-ink",
    danger: "bg-danger-soft text-danger hover:opacity-90",
  }[variant];

  return (
    <button
      {...props}
      className={cx(
        TAP,
        "inline-flex items-center justify-center gap-2 rounded-2xl px-4 text-[15px] font-medium",
        "transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        styles,
        className,
      )}
    />
  );
}

export function Chip({
  selected,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      {...props}
      className={cx(
        "min-h-11 shrink-0 rounded-full px-4 text-[15px] whitespace-nowrap transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        selected
          ? "bg-accent text-on-accent"
          : "bg-surface text-ink hover:bg-raised",
        className,
      )}
    />
  );
}

/** A horizontally scrolling chip row — faster to hit than a native select. */
export function ChipRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="group" aria-label={label} className="no-scrollbar -mx-4 overflow-x-auto px-4">
      <div className="flex gap-2 pb-1">{children}</div>
    </div>
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="t-label mb-1.5 block text-muted">
      {children}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        TAP,
        "w-full rounded-2xl bg-surface px-4 text-base",
        "focus:outline-2 focus:outline-accent",
        className,
      )}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx(
        TAP,
        "w-full appearance-none rounded-2xl bg-surface px-4 text-base",
        "focus:outline-2 focus:outline-accent",
        className,
      )}
    />
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-muted">{children}</p>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-danger">
      {children}
    </p>
  );
}
