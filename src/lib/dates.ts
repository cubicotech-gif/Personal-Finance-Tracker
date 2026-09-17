/**
 * Dates.
 *
 * Timestamps are stored as timestamptz, but nothing in this app reasons about
 * them. Every date that matters — what day a transaction lands on, what period
 * it falls in, how many days a debt has been outstanding — is a `booked_on`,
 * which is an ISO date string (YYYY-MM-DD) on the Asia/Karachi calendar.
 *
 * Doing this with plain strings rather than Date objects means a booked_on can
 * never drift across midnight because the device is in another timezone or the
 * value got round-tripped through UTC.
 */

export const TZ = "Asia/Karachi";

/** An ISO calendar date, YYYY-MM-DD. */
export type IsoDate = string;

// en-CA formats as YYYY-MM-DD, which is exactly the shape we want.
const isoFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
});

const weekdayFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
});

const monthFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  month: "long",
  year: "numeric",
});

/** The Karachi calendar date for an instant. */
export function bookedOn(at: Date = new Date()): IsoDate {
  return isoFormatter.format(at);
}

export function today(): IsoDate {
  return bookedOn();
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(toEpochDay(value));
}

/** Days since the Unix epoch, as pure calendar arithmetic. */
function toEpochDay(iso: IsoDate): number {
  const [y, m, d] = iso.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return Number.NaN;
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function fromEpochDay(day: number): IsoDate {
  const date = new Date(day * 86_400_000);
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** Whole days from `iso` until today in Karachi. */
export function daysSince(iso: IsoDate): number {
  return daysBetween(iso, today());
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return fromEpochDay(toEpochDay(iso) + days);
}

/** "17 Sep" — the dense form used in list rows. */
export function formatDay(iso: IsoDate): string {
  return dayFormatter.format(new Date(`${iso}T12:00:00Z`));
}

/** "Today", "Yesterday", or "Wed 17 Sep". */
export function formatRelativeDay(iso: IsoDate): string {
  const delta = daysSince(iso);
  if (delta === 0) return "Today";
  if (delta === 1) return "Yesterday";
  const at = new Date(`${iso}T12:00:00Z`);
  return `${weekdayFormatter.format(at)} ${dayFormatter.format(at)}`;
}

/** First day of the month containing `iso`. */
export function monthStart(iso: IsoDate): IsoDate {
  return `${iso.slice(0, 7)}-01`;
}

/** Shift by whole months, clamping to the last valid day of the target month. */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const [y, m, d] = iso.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return iso;
  const zeroBased = (m - 1) + months;
  const year = y + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12;
  // 31 Jan + 1 month is 28/29 Feb, not 2/3 March.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year.toString().padStart(4, "0")}-${(month + 1).toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
}

/** Last day of the month containing `iso`. */
export function monthEnd(iso: IsoDate): IsoDate {
  return addDays(addMonths(monthStart(iso), 1), -1);
}

/** "September 2026" — the period heading on /boxes. */
export function formatMonth(iso: IsoDate): string {
  return monthFormatter.format(new Date(`${iso}T12:00:00Z`));
}

/** Monday of the week containing `iso`. */
export function weekStart(iso: IsoDate): IsoDate {
  const day = toEpochDay(iso);
  // 1970-01-01 was a Thursday, so shift by 3 to make Monday the week boundary.
  const offset = (((day + 3) % 7) + 7) % 7;
  return fromEpochDay(day - offset);
}
