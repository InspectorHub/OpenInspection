import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { and, eq, isNull } from 'drizzle-orm';
import {
    inspections,
    tenantConfigs,
    conciergeConfirmTokens,
    agentTenantLinks,
    contacts,
    users,
    tenants,
} from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import type { EmailService } from './email.service';

/**
 * Agent Accounts A3 — Concierge state machine service.
 *
 * Per-tenant concierge_review_required toggles between:
 *   - HomeGauge auto mode (default, OFF): agent submits -> client gets magic link immediately
 *   - Spectora reviewer mode (ON):        agent submits -> inspector approves -> client gets magic link
 *
 * State machine:
 *   agent submits  ─┬─> 'awaiting_inspector' ── approveByInspector ──> 'awaiting_client'
 *                   └─> 'awaiting_client' (default)
 *   awaiting_client ── confirmByClient ──> NULL + inspection.status='confirmed'
 *
 * Tokens: 7-day TTL, single-use, marked via `confirmed_at` timestamp.
 */

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ConciergeBookParams {
    tenantId: string;
    agentUserId: string;
    inspectorContactId: string;
    date: string;
    timeSlot: string;
    propertyAddress: string;
    clientName: string;
    clientEmail: string;
    clientPhone?: string;
    agreementRequired: boolean;
    paymentRequired: boolean;
}

export interface ConciergeBookResult {
    inspectionId: string;
    status: 'awaiting_inspector' | 'awaiting_client';
}

export interface ConciergeTokenView {
    inspection: {
        id: string;
        tenantId: string;
        tenantSubdomain: string;
        propertyAddress: string;
        date: string;
        clientName: string | null;
        clientEmail: string | null;
        agreementRequired: boolean;
        inspectorId: string | null;
    };
    inspector: {
        name: string | null;
        photoUrl: string | null;
        email: string | null;
    } | null;
    expired: boolean;
    alreadyConfirmed: boolean;
}

function mintToken(): string {
    // 32 bytes -> 64 hex chars. crypto.randomUUID() is 16 random bytes; concatenate
    // two without dashes for full 256-bit entropy.
    return (
        crypto.randomUUID().replace(/-/g, '') +
        crypto.randomUUID().replace(/-/g, '')
    );
}

function toMs(value: Date | number | null | undefined): number {
    if (value == null) return 0;
    if (value instanceof Date) return value.getTime();
    return Number(value);
}

export class ConciergeService {
    constructor(
        private db: D1Database,
        private email: EmailService,
        private appBaseUrl: string,
    ) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Step 1 of the concierge flow. Verifies the agent ↔ tenant link is active,
     * resolves the inspector user from the inspector-contact id (via email
     * match), reads tenant.concierge_review_required, and creates an
     * inspection in the appropriate state. Mints a magic-link token + sends
     * the client confirm email when the tenant is in auto-confirm mode;
     * otherwise sends the inspector-review notification.
     */
    async createBooking(params: ConciergeBookParams): Promise<ConciergeBookResult> {
        const db = this.getDrizzle();

        // 1. Verify the agent's link to this tenant is active.
        const link = await db
            .select({
                id: agentTenantLinks.id,
                status: agentTenantLinks.status,
                inspectorContactId: agentTenantLinks.inspectorContactId,
            })
            .from(agentTenantLinks)
            .where(
                and(
                    eq(agentTenantLinks.agentUserId, params.agentUserId),
                    eq(agentTenantLinks.tenantId, params.tenantId),
                ),
            )
            .get();
        if (!link || link.status !== 'active') {
            throw Errors.Forbidden('Agent not linked to this tenant');
        }

        // 2. Resolve the inspector contact + tenant-scoped inspector user.
        const inspectorContact = await db
            .select()
            .from(contacts)
            .where(
                and(
                    eq(contacts.id, params.inspectorContactId),
                    eq(contacts.tenantId, params.tenantId),
                ),
            )
            .get();
        if (!inspectorContact) {
            throw Errors.NotFound('Inspector contact not found');
        }
        const inspectorEmail = inspectorContact.email ?? '';
        const inspector = inspectorEmail
            ? await db
                  .select()
                  .from(users)
                  .where(and(eq(users.email, inspectorEmail), eq(users.tenantId, params.tenantId)))
                  .get()
            : undefined;
        if (!inspector) {
            throw Errors.NotFound('Inspector user not resolved from contact');
        }

        // 3. Read tenant config to decide which mode to enter.
        const cfg = await db
            .select()
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, params.tenantId))
            .get();
        const reviewRequired = !!cfg?.conciergeReviewRequired;

        // 4. Insert inspection in the appropriate concierge state.
        const inspectionId = crypto.randomUUID();
        const conciergeStatus: 'awaiting_inspector' | 'awaiting_client' =
            reviewRequired ? 'awaiting_inspector' : 'awaiting_client';
        await db.insert(inspections).values({
            id: inspectionId,
            tenantId: params.tenantId,
            inspectorId: inspector.id,
            referredByAgentId: link.inspectorContactId ?? null,
            propertyAddress: params.propertyAddress,
            clientName: params.clientName,
            clientEmail: params.clientEmail,
            clientPhone: params.clientPhone ?? null,
            date: params.date,
            status: 'pending',
            paymentStatus: 'unpaid',
            paymentRequired: params.paymentRequired,
            agreementRequired: params.agreementRequired,
            price: 0,
            conciergeStatus,
            createdAt: new Date(),
        });
        logger.info('concierge.createBooking', {
            tenantId: params.tenantId,
            inspectionId,
            status: conciergeStatus,
        });

        // 5. Branch on mode: mint token + email client OR notify inspector.
        if (!reviewRequired) {
            await this.mintTokenAndEmailClient(
                inspectionId,
                params.tenantId,
                params.clientEmail,
                {
                    propertyAddress: params.propertyAddress,
                    date: params.date,
                    inspectorName: inspector.name ?? inspector.email ?? 'your inspector',
                },
            );
            return { inspectionId, status: 'awaiting_client' };
        }
        try {
            await this.email.sendConciergeInspectorReview(inspector.email, {
                inspectionId,
                clientName: params.clientName,
                propertyAddress: params.propertyAddress,
                date: params.date,
                reviewUrl: `${this.appBaseUrl.replace(/\/$/, '')}/dashboard`,
            });
        } catch (err) {
            logger.warn('concierge.inspectorReviewEmail.failed', {
                tenantId: params.tenantId,
                inspectionId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
        return { inspectionId, status: 'awaiting_inspector' };
    }

    /**
     * Step 2 (reviewer mode only). Inspector approves the draft: flips
     * `concierge_status` from 'awaiting_inspector' to 'awaiting_client',
     * mints the magic-link token, sends the client confirm email.
     */
    async approveByInspector(inspectionId: string, tenantId: string): Promise<void> {
        const db = this.getDrizzle();
        const insp = await db
            .select()
            .from(inspections)
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
            .get();
        if (!insp) throw Errors.NotFound('Inspection not found');
        if (insp.conciergeStatus !== 'awaiting_inspector') {
            throw Errors.Conflict('Inspection is not awaiting inspector approval');
        }
        if (!insp.clientEmail) {
            throw Errors.BadRequest('Inspection has no client email on file');
        }

        // Resolve inspector for the email payload.
        let inspectorName = 'your inspector';
        if (insp.inspectorId) {
            const inspector = await db
                .select({ name: users.name, email: users.email })
                .from(users)
                .where(eq(users.id, insp.inspectorId))
                .get();
            inspectorName = inspector?.name ?? inspector?.email ?? inspectorName;
        }

        await db
            .update(inspections)
            .set({ conciergeStatus: 'awaiting_client' })
            .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)));

        await this.mintTokenAndEmailClient(inspectionId, tenantId, insp.clientEmail, {
            propertyAddress: insp.propertyAddress,
            date: insp.date,
            inspectorName,
        });
        logger.info('concierge.approveByInspector', { tenantId, inspectionId });
    }

    /**
     * Step 3 (final). Client redeems the magic link. Verifies token validity
     * (exists, not expired, not yet redeemed), clears the concierge_status,
     * sets inspection.status='confirmed', marks the token confirmed_at, and
     * notifies the agent who originally booked it.
     */
    async confirmByClient(token: string): Promise<{ inspectionId: string }> {
        const db = this.getDrizzle();
        const row = await db
            .select()
            .from(conciergeConfirmTokens)
            .where(eq(conciergeConfirmTokens.token, token))
            .get();
        if (!row) throw Errors.NotFound('Token not found');
        if (row.confirmedAt) throw Errors.Conflict('Token already used');
        const expMs = toMs(row.expiresAt);
        if (expMs <= Date.now()) throw Errors.BadRequest('Token has expired');

        // Flip inspection state.
        await db
            .update(inspections)
            .set({ conciergeStatus: null, status: 'confirmed' })
            .where(
                and(
                    eq(inspections.id, row.inspectionId),
                    eq(inspections.tenantId, row.tenantId),
                ),
            );
        // Mark token used.
        await db
            .update(conciergeConfirmTokens)
            .set({ confirmedAt: new Date() })
            .where(eq(conciergeConfirmTokens.token, token));

        // Notify the originating agent. The referredByAgentId on the
        // inspection points at the agent's contact row in this tenant; the
        // contact carries the agent's email.
        try {
            const insp = await db
                .select({
                    referredByAgentId: inspections.referredByAgentId,
                    propertyAddress: inspections.propertyAddress,
                    date: inspections.date,
                })
                .from(inspections)
                .where(eq(inspections.id, row.inspectionId))
                .get();
            if (insp?.referredByAgentId) {
                const agentContact = await db
                    .select({ email: contacts.email, name: contacts.name })
                    .from(contacts)
                    .where(
                        and(
                            eq(contacts.id, insp.referredByAgentId),
                            eq(contacts.tenantId, row.tenantId),
                        ),
                    )
                    .get();
                if (agentContact?.email) {
                    await this.email.sendConciergeConfirmedToAgent(agentContact.email, {
                        propertyAddress: insp.propertyAddress,
                        date: insp.date,
                        clientName: row.clientEmail,
                    });
                }
            }
        } catch (err) {
            // Email failures must not block the state transition.
            logger.warn('concierge.confirmedAgentEmail.failed', {
                token,
                error: err instanceof Error ? err.message : String(err),
            });
        }

        logger.info('concierge.confirmByClient', {
            tenantId: row.tenantId,
            inspectionId: row.inspectionId,
        });
        return { inspectionId: row.inspectionId };
    }

    /**
     * Read-only token resolution for the public /confirm/<token> page. Returns
     * a view-friendly summary (inspector + property + date + agreement flag),
     * along with `expired` and `alreadyConfirmed` flags so the page can render
     * the right state. Returns null when the token does not exist.
     */
    async resolveToken(token: string): Promise<ConciergeTokenView | null> {
        const db = this.getDrizzle();
        const row = await db
            .select()
            .from(conciergeConfirmTokens)
            .where(eq(conciergeConfirmTokens.token, token))
            .get();
        if (!row) return null;

        const insp = await db
            .select()
            .from(inspections)
            .where(eq(inspections.id, row.inspectionId))
            .get();
        if (!insp) return null;

        const tenantRow = await db
            .select({ subdomain: tenants.subdomain })
            .from(tenants)
            .where(eq(tenants.id, insp.tenantId))
            .get();
        const tenantSubdomain = tenantRow?.subdomain ?? '';

        let inspector: ConciergeTokenView['inspector'] = null;
        if (insp.inspectorId) {
            const u = await db
                .select({ name: users.name, photoUrl: users.photoUrl, email: users.email })
                .from(users)
                .where(eq(users.id, insp.inspectorId))
                .get();
            if (u) {
                inspector = {
                    name: u.name ?? null,
                    photoUrl: u.photoUrl ?? null,
                    email: u.email ?? null,
                };
            }
        }

        const expMs = toMs(row.expiresAt);
        return {
            inspection: {
                id: insp.id,
                tenantId: insp.tenantId,
                tenantSubdomain,
                propertyAddress: insp.propertyAddress,
                date: insp.date,
                clientName: insp.clientName ?? null,
                clientEmail: insp.clientEmail ?? null,
                agreementRequired: !!insp.agreementRequired,
                inspectorId: insp.inspectorId ?? null,
            },
            inspector,
            expired: expMs <= Date.now(),
            alreadyConfirmed: row.confirmedAt !== null && row.confirmedAt !== undefined,
        };
    }

    /**
     * Lists awaiting_inspector concierge inspections for the inspector
     * dashboard's UPCOMING substate. Used by GET /api/inspections/dashboard
     * + the dashboard count widget.
     */
    async listAwaitingInspector(tenantId: string): Promise<{ count: number }> {
        const db = this.getDrizzle();
        const rows = await db
            .select({ id: inspections.id })
            .from(inspections)
            .where(
                and(
                    eq(inspections.tenantId, tenantId),
                    eq(inspections.conciergeStatus, 'awaiting_inspector'),
                ),
            )
            .all();
        return { count: rows.length };
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private async mintTokenAndEmailClient(
        inspectionId: string,
        tenantId: string,
        clientEmail: string,
        emailPayload: { propertyAddress: string; date: string; inspectorName: string },
    ): Promise<void> {
        const db = this.getDrizzle();
        const token = mintToken();
        await db.insert(conciergeConfirmTokens).values({
            token,
            inspectionId,
            tenantId,
            clientEmail,
            expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
            confirmedAt: null,
            createdAt: new Date(),
        });
        const confirmUrl = `${this.appBaseUrl.replace(/\/$/, '')}/confirm/${encodeURIComponent(token)}`;
        try {
            await this.email.sendConciergeClientConfirm(clientEmail, {
                token,
                confirmUrl,
                propertyAddress: emailPayload.propertyAddress,
                date: emailPayload.date,
                inspectorName: emailPayload.inspectorName,
            });
        } catch (err) {
            // Surface the token via DB even if email delivery flakes; an inspector
            // can copy the link manually from a future admin tool. For A3 we just
            // log + continue so the state transition isn't blocked.
            logger.warn('concierge.clientConfirmEmail.failed', {
                tenantId,
                inspectionId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
}

// re-export for any future callsite that wants to filter by NULL conciergeStatus
export { isNull };

/* ------------------------------------------------------------------ */
/*  Public booking flow (Tasks 15-17 of typed-hono-dead-routes-cleanup) */
/* ------------------------------------------------------------------ */
//
// Stand-alone helpers for the unauthenticated /book-info, /book, /confirm-info
// endpoints. These intentionally bypass the `ConciergeService` class — the
// class models the agent → inspector → client state machine, whereas these
// helpers model the simpler invite-token-to-booking flow opened by a public
// magic link.

import { conciergeInvites, conciergeBookings } from '../lib/db/schema';

interface BookingInviteRow {
    token: string;
    tenantId: string;
    inspectorId: string | null;
    expiresAt: string;
    createdAt: string | null;
}

interface BookingRow {
    id: string;
    confirmationToken: string;
    tenantId: string;
    inviteToken: string;
    slotStart: string;
    slotEnd: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string | null;
    address: string;
    notes: string | null;
    createdAt: string | null;
}

interface TenantRow {
    id: string;
    name: string;
}

export interface BookInfoResult {
    tenant: { name: string; brand: Record<string, unknown> | null };
    inspector: { id: string; name: string } | null;
    availableSlots: Array<{ start: string; end: string }>;
    expiresAt: string;
}

export interface CreateBookingInput {
    token: string;
    slot: { start: string; end: string };
    contactName: string;
    contactEmail: string;
    contactPhone?: string | undefined;
    address: string;
    notes?: string | undefined;
}

export interface CreateBookingResult {
    bookingId: string;
    confirmationToken: string;
}

export interface ConfirmInfoResult {
    booking: {
        id: string;
        start: string;
        end: string;
        address: string;
        contactName: string;
        tenant: { name: string };
    };
}

/**
 * Read the tenant brand + (placeholder) available slots for a booking page
 * keyed by a public invite token. Throws on missing or expired token.
 *
 * NOTE: `availableSlots` is currently a stub empty array — calendar
 * integration is tracked in a separate plan. The route is wired and the
 * frontend renders so the customer can still submit a free-form slot.
 */
export async function getBookInfo(db: DrizzleD1Database, token: string): Promise<BookInfoResult> {
    const invite = (await db
        .select()
        .from(conciergeInvites)
        .where(eq(conciergeInvites.token, token))
        .get()) as BookingInviteRow | undefined;
    if (!invite) throw new Error('Invalid token');
    if (new Date(invite.expiresAt) < new Date()) throw new Error('Token expired');

    const tenant = (await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, invite.tenantId))
        .get()) as (TenantRow & { brand?: Record<string, unknown> }) | undefined;

    return {
        tenant: {
            name: tenant?.name ?? 'Unknown',
            // Tenant brand column is not yet on the schema; surface null until
            // the brand-on-tenant migration lands.
            brand: null,
        },
        inspector: null,
        availableSlots: [],
        expiresAt: invite.expiresAt,
    };
}

/**
 * Insert a `concierge_bookings` row keyed by an invite token + a freshly minted
 * confirmation token. Throws on missing/expired invite.
 */
export async function createBooking(
    db: DrizzleD1Database,
    input: CreateBookingInput,
): Promise<CreateBookingResult> {
    const invite = (await db
        .select()
        .from(conciergeInvites)
        .where(eq(conciergeInvites.token, input.token))
        .get()) as BookingInviteRow | undefined;
    if (!invite) throw new Error('Invalid token');
    if (new Date(invite.expiresAt) < new Date()) throw new Error('Token expired');

    const bookingId = crypto.randomUUID();
    const confirmationToken = crypto.randomUUID().replace(/-/g, '');

    await db.insert(conciergeBookings).values({
        id: bookingId,
        confirmationToken,
        tenantId: invite.tenantId,
        inviteToken: input.token,
        slotStart: input.slot.start,
        slotEnd: input.slot.end,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone ?? null,
        address: input.address,
        notes: input.notes ?? null,
        createdAt: new Date().toISOString(),
    });

    return { bookingId, confirmationToken };
}

/**
 * Fetch a just-created booking by its confirmation token for the
 * /confirm-info page. Throws on missing token.
 */
export async function getConfirmInfo(
    db: DrizzleD1Database,
    confirmationToken: string,
): Promise<ConfirmInfoResult> {
    const booking = (await db
        .select()
        .from(conciergeBookings)
        .where(eq(conciergeBookings.confirmationToken, confirmationToken))
        .get()) as BookingRow | undefined;
    if (!booking) throw new Error('Invalid confirmation token');

    const tenant = (await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, booking.tenantId))
        .get()) as TenantRow | undefined;

    return {
        booking: {
            id: booking.id,
            start: booking.slotStart,
            end: booking.slotEnd,
            address: booking.address,
            contactName: booking.contactName,
            tenant: { name: tenant?.name ?? 'Unknown' },
        },
    };
}
