import type { Context } from 'hono';
import { eq, and, isNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { users, contactRoleProfiles } from '../../lib/db/schema';
import { contacts } from '../../lib/db/schema/contact';
import { logger } from '../../lib/logger';
import { normalizeLocale } from '../../lib/i18n/contact-locale';
import { PeopleService } from '../people.service';
import type { HonoConfig } from '../../types/hono';
import type { PublicBookingSchema } from '../../lib/validations/booking.schema';
import type { z } from '@hono/zod-openapi';

/**
 * WHO a public booking is for and who gets credit for it.
 *
 * Task 13 dropped `inspections.clientContactId` / `referredByAgentId` /
 * `sellingAgentId`, so `inspection_people` is now the ONLY persistence of who
 * is attached to an inspection — and on the booking path that is written from
 * two ends: the referring agent is resolved from the URL before anything
 * exists, the client is upserted after the rows commit. Splitting them across
 * two files is how one of them gets forgotten, so both live here.
 *
 * EVERY WRITE IN THIS MODULE IS NON-FATAL BY DESIGN. The inspection rows have
 * already committed by the time `attachBookingPeople` runs; an anonymous booker
 * must never see a 500 because of contact bookkeeping, and logs carry inspection
 * ids and messages only, never the client's email.
 */

/**
 * UC-A-1 — agent referral attribution. Resolve `?ref=<agentSlug>` (sent
 * through the form as agentRefSlug) to a contacts.id in this tenant.
 * Two requirements both need to hold:
 *   1. A global agent user with that slug exists.
 *   2. They have an `active` agent_tenant_links row for THIS tenant whose
 *      inspectorContactId points at the agent's contact row.
 * Either failure leaves the result null — bookings with bad slugs still
 * succeed; we just don't credit the (unknown) agent.
 */
export async function resolveBookingAgentReferral(
    db: DrizzleD1Database,
    tenantId: string,
    agentRefSlug: string | undefined,
): Promise<string | null> {
    if (!agentRefSlug) return null;
    try {
        const agent = await db.select({ id: users.id })
            .from(users)
            .where(and(
                eq(users.slug, agentRefSlug),
                isNull(users.tenantId),
                eq(users.role, 'agent'),
            ))
            .get();
        if (!agent) return null;
        // IA-104 — the agent's contact in THIS tenant is the row
        // bound to their account; no link hop.
        const link = await db.select({ contactId: contacts.id })
            .from(contacts)
            .where(and(
                eq(contacts.agentUserId, agent.id),
                eq(contacts.tenantId, tenantId),
                isNull(contacts.agentRevokedAt),
            ))
            .get();
        return link?.contactId ?? null;
    } catch (err) {
        logger.warn('booking.agentRef.resolve.failed', {
            slug: agentRefSlug,
            tenantId,
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

export interface BookingPeopleInput {
    /** Every inspection this booking created; the client is linked to all of them. */
    allInspectionIds: string[];
    /** Set only by the legacy single-service direct-insert branch. */
    directInsertInspectionId: string | null;
    resolvedAgentContactId: string | null;
    /** The BookingService instance's own D1 handle — see `admitBooking`'s note. */
    d1: D1Database;
}

/**
 * Capture the booker as a Client contact, mirror client + buyer_agent into
 * `inspection_people`, and record an SMS consent event when the box was ticked.
 * Returns the client contact id, which the confirmation email needs to mint the
 * double-opt-in link.
 *
 * PLACEMENT MATTERS AND IS THE CALLER'S RESPONSIBILITY: this must run AFTER
 * slot arbitration. A losing booker self-revokes and throws, so we never stamp a
 * contact onto inspections that were just deleted. (A stray contact row is
 * harmless on its own — what we avoid is a contact pointing at vanished
 * inspections.) It also runs BEFORE the side-effect block, to keep the
 * synchronous DB writes grouped ahead of async waitUntil work.
 */
export async function attachBookingPeople(
    c: Context<HonoConfig>,
    db: DrizzleD1Database,
    tenantId: string,
    body: z.infer<typeof PublicBookingSchema>,
    input: BookingPeopleInput,
): Promise<string | null> {
    const { allInspectionIds, directInsertInspectionId, resolvedAgentContactId, d1 } = input;

    // IA-18 (#111) — capture the booker as a Client contact and link it to
    // ALL inspections this booking created so their client appears in
    // Contacts and on the inspector portal People card.
    let bookingClientContactId: string | null = null;
    if (body.clientEmail || body.clientName) {
        try {
            const { id: clientContactId } = await c.var.services.contact.upsertClientContact(tenantId, {
                name:  body.clientName,
                email: body.clientEmail,
                type:  'client',
                // Reduced to a locale we actually have messages for, so a
                // regional variant lands on its catalogue and anything we
                // cannot speak is stored as NULL rather than as a promise
                // we would break at send time.
                locale: normalizeLocale(body.locale),
            });
            bookingClientContactId = clientContactId;
        } catch (e) {
            logger.warn('booking.client-contact.upsert.failed', {
                inspectionIds: allInspectionIds,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    // Task 7b (people-role-profiles), FIXED — mirror client + buyer_agent
    // into inspection_people. Client covers EVERY allInspectionIds entry
    // (bookingClientContactId is linked to all of them, incl. multi-service
    // sub-inspections, which only get buyer_agent from
    // InspectionRequestService.create — the original bug wrongly scoped
    // the client write to directInsertInspectionId alone).
    if (bookingClientContactId || (directInsertInspectionId && resolvedAgentContactId)) {
        try {
            const roleRows = await db.select({ id: contactRoleProfiles.id, key: contactRoleProfiles.key })
                .from(contactRoleProfiles)
                .where(and(eq(contactRoleProfiles.tenantId, tenantId), eq(contactRoleProfiles.active, true)));
            const roleIdByKey = new Map(roleRows.map(r => [r.key, r.id]));
            const people = new PeopleService({ DB: d1 });
            const clientRoleId = roleIdByKey.get('client');
            if (bookingClientContactId && clientRoleId) {
                for (const inspId of allInspectionIds) {
                    await people.addPerson(tenantId, inspId, bookingClientContactId, clientRoleId);
                }
            }
            const buyerAgentRoleId = roleIdByKey.get('buyer_agent');
            if (directInsertInspectionId && resolvedAgentContactId && buyerAgentRoleId) {
                await people.addPerson(tenantId, directInsertInspectionId, resolvedAgentContactId, buyerAgentRoleId);
            }
        } catch (err) {
            logger.error('inspection-people write from booking create failed', { inspectionIds: allInspectionIds }, err instanceof Error ? err : undefined);
        }
    }

    // Track L (D6, path A) — self-book SMS opt-in. The checkbox is unchecked by
    // default; when ticked we record a `granted` consent event (captured_via=
    // booking_form) keyed on the client contact. Non-fatal: a consent write must
    // never fail the booking (the inspection rows already committed).
    if (body.smsOptin && bookingClientContactId) {
        try {
            const { SmsConsentService } = await import('../sms-consent.service');
            await new SmsConsentService(c.env.DB).record(
                tenantId, bookingClientContactId, 'granted', 'booking_form',
                { ip: c.req.header('CF-Connecting-IP'), userAgent: c.req.header('User-Agent') },
            );
        } catch (e) {
            logger.warn('booking.sms-optin.record.failed', {
                inspectionId: allInspectionIds[0], error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    return bookingClientContactId;
}
