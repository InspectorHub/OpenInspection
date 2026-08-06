import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { users, inspections, tenantConfigs } from '../../lib/db/schema';
import { logger } from '../../lib/logger';
import { CredentialService } from '../credential.service';
import { pushInspectionAfterResponse } from '../../lib/calendar/push-hooks';
import { resolveTenantTimeZone, wallClockToEpochMs } from '../../lib/tz';
import { getBookingHost, getBaseUrl } from '../../lib/url';
import type { HonoConfig } from '../../types/hono';
import type { PublicBookingSchema } from '../../lib/validations/booking.schema';
import type { z } from '@hono/zod-openapi';

type BookingBody = z.infer<typeof PublicBookingSchema>;

/**
 * Sprint 1 C-6 — map window option to a human-readable label for the
 * calendar event + confirmation email.
 */
function windowLabelFor(body: BookingBody): string {
    const windowLabel: Record<BookingBody['timeSlot'], string> = {
        'morning':   'Morning (8:00 AM – 12:00 PM)',
        'afternoon': 'Afternoon (12:00 PM – 4:00 PM)',
        'all-day':   'All day (8:00 AM – 5:00 PM)',
        'custom':    body.customTime ? `${body.customTime}` : 'Custom time',
    };
    return windowLabel[body.timeSlot];
}

export interface BookingConfirmationInput {
    inspectorId: string;
    requestedTime: string;
    inspectionId: string;
    /** Null when the contact upsert was skipped or failed; suppresses the opt-in link. */
    bookingClientContactId: string | null;
}

/**
 * Everything the outside world hears about a booking after it exists: the
 * inspector's Google Calendar and the customer's confirmation email.
 *
 * The seam is "after the answer is sent". The caller hands this to
 * `waitUntil`, so NOTHING here can change the response the booker already got,
 * and nothing here may throw in a way that matters — every leg either catches
 * or is `.catch`-ed. That is also why the read of `users` happens here rather
 * than being threaded in: this runs detached, and one more query on the
 * detached side costs the booker nothing.
 *
 * Kept as one function rather than two because the calendar push and the email
 * share the resolved inspector row and the same start instant, and because
 * "what the booking announces" is the thing a reader comes here looking for.
 */
export async function dispatchBookingConfirmation(
    c: Context<HonoConfig>,
    db: DrizzleD1Database,
    tenantId: string,
    body: BookingBody,
    input: BookingConfirmationInput,
): Promise<void> {
    const { inspectorId, requestedTime, inspectionId, bookingClientContactId } = input;
    const windowLabel = windowLabelFor(body);

    const inspector = await db.select().from(users).where(eq(users.id, inspectorId)).get();

    // The calendar push goes through the tracked export path: it reads the
    // instant that fulfillBooking already stamped in the TENANT zone, records
    // the Google event id in calendar_external_links, and therefore updates
    // rather than duplicates when the booking is later moved. The previous
    // call composed `${body.date}T${requestedTime}:00Z` — a wall clock labelled
    // UTC — which put the event on the inspector's calendar at the wrong hour
    // for every tenant not actually in UTC.
    pushInspectionAfterResponse(c, tenantId, inspectionId);

    const emailService = c.var.services.email;

    // Sprint 1 C-10 — the ICS invite the customer imports into Apple Calendar
    // or Google Calendar.
    //
    // The instant comes from the row, not from re-deriving it here. fulfillBooking
    // stamped scheduled_start_ms/end_ms by reading the slot time in the TENANT
    // zone; this used to recompute it as `${body.date}T${requestedTime}:00Z`,
    // labelling a wall clock as UTC, so the customer's invite landed hours off
    // in every zone but UTC — and it disagreed with the row the office sees.
    // One authority, and the window-length policy stops being duplicated too.
    const booked = await db.select({
        scheduledStartMs: inspections.scheduledStartMs,
        scheduledEndMs: inspections.scheduledEndMs,
    }).from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
        .get();

    const tzRow = await db.select({ defaultTimezone: tenantConfigs.defaultTimezone })
        .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
    const tenantTz = resolveTenantTimeZone(tzRow?.defaultTimezone);

    const stampedStart = booked?.scheduledStartMs instanceof Date ? booked.scheduledStartMs.getTime() : null;
    const stampedEnd = booked?.scheduledEndMs instanceof Date ? booked.scheduledEndMs.getTime() : null;
    // Only reached when the stamp write failed; still read in the tenant zone.
    const startMs = stampedStart ?? wallClockToEpochMs(body.date, requestedTime, tenantTz);
    const fallbackHours = body.timeSlot === 'all-day' ? 9
        : body.timeSlot === 'morning' || body.timeSlot === 'afternoon' ? 4
        : 3;
    const endMs = stampedEnd ?? startMs + fallbackHours * 60 * 60 * 1000;
    // Booking-confirmation greeting falls back to the brand, never the
    // inspector's inbox — keeps the email looking professional even if a
    // legacy account is missing a display name.
    const inspectorName = inspector?.name || c.env.APP_NAME || 'Your inspector';
    const inspectorEmail = inspector?.email || c.env.SENDER_EMAIL || `noreply@${c.env.APP_NAME?.toLowerCase().replace(/\s/g, '') || 'inspector'}.com`;

    // Spec B — the assigned inspector's active credentials, for the footer.
    // Via the shared mapper, so this footer and the email signature can
    // never disagree about the badge URL form.
    const bookingCreds = inspector
        ? await new CredentialService(c.env.DB).listRenderable(tenantId, inspectorId)
        : [];
    // Sprint B-4a — append inspector signature so customers can rebook
    // with the same inspector via the per-inspector booking link.
    const sigInspector = inspector ? {
        name:          inspector.name ?? null,
        email:         inspector.email ?? null,
        phone:         inspector.phone ?? null,
        slug:          inspector.slug ?? null,
        credentials:   bookingCreds,
    } : undefined;
    // Track L (D6, path B) — double-opt-in link injected at the RENDERER
    // level (not gated on any automation rule) so disabling a rule never
    // removes the only opt-in path. The token self-describes (tenant,
    // contact) — see lib/sms/optin-token.ts. Best-effort: a token failure
    // simply omits the link.
    let smsOptinUrl: string | undefined;
    if (bookingClientContactId && c.env.JWT_SECRET) {
        try {
            const { mintOptinToken } = await import('../../lib/sms/optin-token');
            const token = await mintOptinToken(tenantId, bookingClientContactId, c.env.JWT_SECRET);
            smsOptinUrl = `${getBaseUrl(c)}/sms-optin/${encodeURIComponent(token)}`;
        } catch (e) {
            logger.warn('booking.sms-optin.mint.failed', { inspectionId, error: e instanceof Error ? e.message : String(e) });
        }
    }

    await emailService.sendBookingConfirmation(
        body.clientEmail,
        body.clientName,
        body.address,
        body.date,
        windowLabel,
        {
            uid:            `inspection-${inspectionId}`,
            summary:        `Home Inspection at ${body.address}`,
            description:    `Inspector: ${inspectorName}\nWindow: ${windowLabel}\n\nWe will send your detailed report within 24 hours of completion.`,
            location:       body.address,
            start:          new Date(startMs),
            end:            new Date(endMs),
            organizerEmail: inspectorEmail,
            organizerName:  inspectorName,
        },
        sigInspector,
        getBookingHost(c),
        smsOptinUrl,
    ).catch(e => logger.error('Booking confirmation email failed', {}, e instanceof Error ? e : undefined));
}
