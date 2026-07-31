/**
 * §7.5 item 3 — a date PATCH moves the civil day, and the precise scheduled
 * instant (`scheduled_start_ms`, the truth source for conflict detection and
 * calendar push) moves WITH it, preserving wall-clock time-of-day in the
 * TENANT timezone. Before this, a dragged inspection kept its old instant
 * forever — every downstream reader saw a timestamp diverging from the row's
 * own date.
 *
 * The one-time cleanup for rows that diverged before this shipped is
 * `scripts/backfill-scheduled-start.mjs` (same shift rule, dry-run first).
 */
import { and, eq } from 'drizzle-orm';
import { inspections, tenantConfigs } from '../../lib/db/schema';
import { resolveTenantTimeZone, epochMsToWallClockHm, wallClockToEpochMs } from '../../lib/tz';

type AnyDb = {
    select: (...args: never[]) => unknown;
};

const toMs = (v: unknown): number | null =>
    v instanceof Date ? v.getTime() : v == null ? null : Number(v);

/**
 * Given a validated PATCH body whose `date` is either a full ISO datetime (the
 * settings sheet) or a bare civil `YYYY-MM-DD` (the calendar drag), return the
 * values to write: the normalized `date` plus, when the row carries a
 * scheduled instant, the shifted `scheduledStartMs`/`scheduledEndMs`.
 */
export async function datePatchValues(
    rawDb: AnyDb,
    tenantId: string,
    inspectionId: string,
    body: Record<string, unknown> & { date: string },
): Promise<Record<string, unknown>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = rawDb as any;
    const newCivil = body.date.slice(0, 10);
    const row = await db.select({
        date: inspections.date,
        scheduledStartMs: inspections.scheduledStartMs,
        scheduledEndMs: inspections.scheduledEndMs,
    }).from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
        .get();

    // The calendar drag posts a bare civil date, but the stored value may
    // carry a time suffix that keys the HH:MM busy-checks via slice(11,16) —
    // keep it rather than truncating.
    const oldDate: string = row?.date ?? '';
    const dateValue = body.date.length === 10 && oldDate.length > 10
        ? `${newCivil}${oldDate.slice(10)}`
        : body.date;
    const values: Record<string, unknown> = { ...body, date: dateValue };

    const oldStart = toMs(row?.scheduledStartMs);
    if (oldStart != null) {
        const tzRow = await db.select({ defaultTimezone: tenantConfigs.defaultTimezone })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        const tz = resolveTenantTimeZone(tzRow?.defaultTimezone);
        const newStartMs = wallClockToEpochMs(newCivil, epochMsToWallClockHm(oldStart, tz), tz);
        values.scheduledStartMs = new Date(newStartMs);
        const oldEnd = toMs(row?.scheduledEndMs);
        // End shifts by the same delta, so the booked duration survives even
        // across a DST boundary.
        if (oldEnd != null) values.scheduledEndMs = new Date(oldEnd + (newStartMs - oldStart));
    }
    return values;
}
