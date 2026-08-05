/**
 * Dispatch board geometry and bucketing.
 *
 * Pure functions with no React and no `Date`: the board's placement rules are
 * arithmetic over the wall-clock `HH:MM` strings the server already resolved in
 * the TENANT timezone. Re-deriving a time here from an instant would reopen the
 * calendar off-by-one — two dispatchers in different zones must see one card in
 * one place, and the only string that guarantees that is the one the server sent.
 */

export interface DispatchInspector {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

export interface DispatchItem {
  id: string;
  kind: string;
  title: string;
  start: string;
  end: string;
  civilDate: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;
  color?: string;
  inspectionId?: string;
  userId?: string;
  meta?: Record<string, unknown>;
}

export interface DispatchPayload {
  date: string;
  conflictPolicy: "advisory" | "block";
  inspectors: DispatchInspector[];
  items: DispatchItem[];
  unassigned: DispatchItem[];
}

/** Axis bounds, in tenant wall-clock hours. Tenant-configurable later. */
export const BOARD_START_HOUR = 7;
export const BOARD_END_HOUR = 19;
/** One axis hour in pixels — matches the day calendar's row height. */
export const HOUR_HEIGHT_PX = 56;
/** A card whose end instant was never stored still has to be grabbable. */
export const DEFAULT_CARD_MINUTES = 60;
/** Below this a card is a line, not a target. */
const MIN_CARD_PX = 22;

const AXIS_START_MIN = BOARD_START_HOUR * 60;
const AXIS_END_MIN = BOARD_END_HOUR * 60;

/** Hour labels down the gutter, inclusive of the closing hour's line. */
export function boardHours(): number[] {
  const out: number[] = [];
  for (let h = BOARD_START_HOUR; h < BOARD_END_HOUR; h++) out.push(h);
  return out;
}

/** `HH:MM` → minutes since midnight, or null when absent/malformed. */
export function minutesOfDay(hhmm: string | undefined): number | null {
  if (!hhmm) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

/** 12-hour gutter label, assembled rather than formatted — see `lint:i18n`. */
export function hourLabel(hour: number): { hour12: number; meridiem: "AM" | "PM" } {
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return { hour12, meridiem: hour >= 12 ? "PM" : "AM" };
}

export interface CardGeometry {
  topPx: number;
  heightPx: number;
  /** The card really starts before the axis does — the top edge is a lie. */
  clippedStart: boolean;
  /** The card really ends after the axis does. */
  clippedEnd: boolean;
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

const pxFromAxis = (minute: number) =>
  ((minute - AXIS_START_MIN) / 60) * HOUR_HEIGHT_PX;

/**
 * Where a timed card sits on the axis. Returns null for all-day items and for
 * anything with no usable start — those belong in the all-day strip, not at an
 * arbitrary pixel. Cards outside the axis are CLAMPED rather than dropped: an
 * inspection at 06:00 is exactly the thing a dispatcher needs to see, and
 * hiding it because the axis starts at 07:00 would make the board lie.
 */
export function cardGeometry(item: DispatchItem): CardGeometry | null {
  const startMin = minutesOfDay(item.startTime);
  if (item.allDay || startMin == null) return null;
  const endMin = Math.max(
    minutesOfDay(item.endTime) ?? startMin + DEFAULT_CARD_MINUTES,
    startMin + 1,
  );

  const top = clamp(startMin, AXIS_START_MIN, AXIS_END_MIN - 1);
  const bottom = clamp(endMin, top + 1, AXIS_END_MIN);

  return {
    topPx: pxFromAxis(top),
    heightPx: Math.max(pxFromAxis(bottom) - pxFromAxis(top), MIN_CARD_PX),
    clippedStart: startMin < AXIS_START_MIN,
    clippedEnd: endMin > AXIS_END_MIN,
  };
}

/** Total axis height, so the column and the gutter cannot disagree. */
export function axisHeightPx(): number {
  return (BOARD_END_HOUR - BOARD_START_HOUR) * HOUR_HEIGHT_PX;
}

/**
 * Company-wide closures. These carry no `userId`, so they are NOT a column's
 * items — they grey the whole board. Unassigned inspections also carry no
 * `userId`, which is why this keys on the kind and not on the absence.
 */
export function closureItems(items: DispatchItem[]): DispatchItem[] {
  return items.filter((item) => item.kind === "company_holiday");
}

export interface ColumnBuckets {
  /** Placeable on the axis, earliest first. */
  timed: DispatchItem[];
  /** All-day or untimed — rendered in the strip above the axis. */
  untimed: DispatchItem[];
}

/**
 * One inspector's day. `userId` is the resolved owner the feed already worked
 * out (link table first, legacy `inspections.inspector_id` as fallback), so the
 * board never re-implements that precedence.
 */
export function bucketColumn(items: DispatchItem[], inspectorId: string): ColumnBuckets {
  const mine = items.filter(
    (item) => item.userId === inspectorId && item.kind !== "company_holiday",
  );
  const timed = mine.filter((item) => cardGeometry(item) !== null);
  const untimed = mine.filter((item) => cardGeometry(item) === null);
  timed.sort((a, b) => (minutesOfDay(a.startTime) ?? 0) - (minutesOfDay(b.startTime) ?? 0));
  return { timed, untimed };
}

/** Design-system tone per item kind, mirroring the calendar's `eventColor`. */
export function cardTone(kind: string): string {
  if (kind === "calendar_block") return "bg-ih-fg-3 text-ih-fg-inverse";
  if (kind === "external_busy") return "bg-ih-fg-4 text-ih-fg-inverse";
  if (kind === "company_holiday") return "bg-ih-watch text-ih-fg-inverse";
  return "bg-ih-primary text-ih-fg-inverse";
}

/** Column heading — a name when there is one, the login otherwise. */
export function inspectorLabel(inspector: DispatchInspector): string {
  const name = inspector.name?.trim();
  return name ? name : inspector.email;
}

/**
 * Shift a civil date by whole days without ever touching local time. Built on
 * `Date.UTC` and read back with the UTC accessors, so the arithmetic happens in
 * a zone with no DST and the result is a pure string transform.
 */
export function shiftCivilDate(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const at = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  at.setUTCDate(at.getUTCDate() + days);
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, "0");
  const d = String(at.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
