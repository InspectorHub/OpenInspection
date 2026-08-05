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
  /** Tenant booking_slot_interval_min — the lattice a vertical drag snaps to. */
  slotIntervalMin: number;
  /** Epoch ms of 00:00 on `date` in the TENANT timezone. */
  dayStartMs: number;
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

/** One overlap the reschedule endpoint reported, mirroring ScheduleConflictSchema. */
export interface ScheduleConflict {
  inspectionId: string;
  propertyAddress: string;
  date: string;
  inspectorId: string;
}

/**
 * What the route action hands back to the board after a drop.
 *
 * `ok: true` with a non-empty `conflicts` is the ADVISORY outcome — the write
 * landed and the overlap is a warning. `ok: false` with SCHEDULE_CONFLICT is
 * the BLOCK outcome — nothing was written. Collapsing the two into a single
 * "there were conflicts" flag is how a board ends up telling a dispatcher a
 * move succeeded when the server refused it.
 */
export interface RescheduleResult {
  ok: boolean;
  code?: string;
  message?: string | null;
  conflicts?: ScheduleConflict[];
}

/** A card the dispatcher may move. Blocks, busy time and closures are facts. */
export function isDraggableItem(item: DispatchItem): boolean {
  return item.kind === "inspection" && Boolean(item.inspectionId);
}

/**
 * Round a minute-of-day onto the tenant's booking lattice.
 *
 * Snapping to `booking_slot_interval_min` rather than to a pretty number is
 * the point: a dragged job has to land on a time the booking engine would
 * also have offered a customer, or the board quietly creates starts that no
 * other surface in the product can produce.
 */
export function snapMinute(minute: number, intervalMin: number): number {
  const step = intervalMin > 0 ? intervalMin : 30;
  return Math.round(minute / step) * step;
}

/**
 * Pixel offset inside a column's axis → snapped minute-of-day, clamped so a
 * drop near the bottom edge cannot produce a start after the axis ends.
 */
export function minuteFromOffsetY(offsetY: number, intervalMin: number): number {
  const raw = AXIS_START_MIN + (offsetY / HOUR_HEIGHT_PX) * 60;
  const snapped = snapMinute(raw, intervalMin);
  return clamp(snapped, AXIS_START_MIN, AXIS_END_MIN);
}

/** Axis pixel for a minute-of-day — the inverse of `minuteFromOffsetY`. */
export function offsetYFromMinute(minute: number): number {
  return pxFromAxis(clamp(minute, AXIS_START_MIN, AXIS_END_MIN));
}

/** Minute-of-day → instant, anchored on the tenant's own midnight. */
export function minuteToEpochMs(dayStartMs: number, minute: number): number {
  return dayStartMs + minute * 60_000;
}

/**
 * The instant a card currently occupies. The server layers the real
 * `scheduledStartMs` onto every inspection it has one for; the wall-clock
 * fallback exists for rows whose instant was never stored, so dropping such a
 * card into the unassigned lane still has something to send.
 */
export function currentStartMs(item: DispatchItem, dayStartMs: number): number | null {
  const stored = item.meta?.scheduledStartMs;
  if (typeof stored === "number" && Number.isFinite(stored)) return stored;
  const minute = minutesOfDay(item.startTime);
  return minute == null ? null : minuteToEpochMs(dayStartMs, minute);
}

/** `HH:MM` for a minute-of-day — assembled, never formatted (see `lint:i18n`). */
export function minuteToHm(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  return `${String(h).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export interface DaySlot {
  time: string;
  available: boolean;
  inspectorIds: string[];
}

/**
 * Which slot STARTS can actually hold a job of `durationMin`.
 *
 * The slots endpoint reports starts, not windows — a 09:00 slot being free says
 * nothing about 09:30, and offering "09:00" for a three-hour job whose 10:00
 * slot is taken is worse than offering nothing: it is a promise the calendar
 * cannot keep. So a start qualifies only when every consecutive slot it needs
 * exists, follows on at exactly `intervalMin`, and is free. The contiguity
 * check is not paranoia: a gap in the grid is a closed window (lunch, a
 * split shift), and index arithmetic alone would step straight over it.
 */
export function startsFittingDuration(
  slots: DaySlot[],
  intervalMin: number,
  durationMin: number,
): Set<string> {
  const step = intervalMin > 0 ? intervalMin : 30;
  const needed = Math.max(1, Math.ceil((durationMin > 0 ? durationMin : step) / step));
  const fits = new Set<string>();

  for (let i = 0; i < slots.length; i++) {
    let ok = true;
    for (let n = 0; n < needed; n++) {
      const slot = slots[i + n];
      const previous = n === 0 ? null : slots[i + n - 1];
      if (!slot || !slot.available) { ok = false; break; }
      if (previous) {
        const gap = (minutesOfDay(slot.time) ?? 0) - (minutesOfDay(previous.time) ?? 0);
        if (gap !== step) { ok = false; break; }
      }
    }
    if (ok) fits.add(slots[i].time);
  }
  return fits;
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
