import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { users } from '../../lib/db/schema';
import { logger } from '../../lib/logger';
import { CredentialService } from '../credential.service';
import { createCalendarEvent } from '../../api/calendar';
import { loadOpenGoogleConnection } from '../../lib/calendar/connection';
import { loadGoogleOAuthMode, resolveGoogleOAuthCredentials } from '../../lib/calendar/resolve-google-oauth';
import { canPushEvents } from '../../lib/calendar/provider';
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
    const open = await loadOpenGoogleConnection(
        c.env.DB,
        tenantId,
        inspectorId,
        c.env.JWT_SECRET,
        c.env.JWT_SECRET_PREVIOUS,
    );
    if (open && canPushEvents(open.connection.capabilities)) {
        const oauthMode = await loadGoogleOAuthMode(c.env.DB, tenantId);
        const oauthCreds = await resolveGoogleOAuthCredentials(c.env, tenantId, oauthMode);
        if (oauthCreds) {
            const startDateTime = `${body.date}T${requestedTime}:00Z`;
            await createCalendarEvent(
                oauthCreds.clientId,
                oauthCreds.clientSecret,
                open.credentials.refreshToken,
                open.connection.calendarId,
                `Inspection: ${body.address}`,
                startDateTime,
                body.address,
            ).catch(e => logger.error('Calendar sync failed', {}, e instanceof Error ? e : undefined));
        }
    }

    const emailService = c.var.services.email;

    // Sprint 1 C-10 — build the ICS event so the confirmation email
    // carries a calendar invite the customer can import into Apple
    // Calendar / Google Calendar. Duration defaults to 3 hours, with
    // 4 hours for morning/afternoon windows and 9 hours for all-day.
    const startMs = new Date(`${body.date}T${requestedTime}:00Z`).getTime();
    let durationHours: number;
    switch (body.timeSlot) {
        case 'all-day':   durationHours = 9; break;
        case 'morning':
        case 'afternoon': durationHours = 4; break;
        default:          durationHours = 3; break;
    }
    const endMs = startMs + durationHours * 60 * 60 * 1000;
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
