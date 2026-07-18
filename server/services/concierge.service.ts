import { drizzle } from 'drizzle-orm/d1';
import { and, eq, or } from 'drizzle-orm';
import {
    inspections,
    tenantConfigs,
    conciergeConfirmTokens,
    agentTenantLinks,
    contacts,
    users,
    tenants,
    contactRoleProfiles,
} from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';
import { syncInspectionAssignments } from '../lib/db/assignment-links';
import { hashToken, deadTokenSentinel, resolveTokenRow } from '../lib/token-hash';
import { PeopleService } from './people.service';
import { ContactService } from './contact.service';
import type { EmailService } from './email.service';
import type { PlanQuotaGuard } from '../features/plan-quota/guard';

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
        tenantSlug: string;
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
    /**
     * Free-tier usage-quota guard (optional). Present only in SaaS deploys
     * with `hasUsageQuota` (see deployment-profile.ts); undefined in
     * standalone, where concierge booking stays unlimited. See the
     * `consumeInspection` call site in createBooking.
     */
    constructor(
        private db: D1Database,
        private email: EmailService,
        private appBaseUrl: string,
        private planQuota?: PlanQuotaGuard,
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
        // Quota is consumed only after every precondition check above (agent
        // link active, inspector contact resolved, inspector user resolved)
        // has passed and immediately before the insert that actually creates
        // the inspection — a failed validation must never burn a free
        // tenant's lifetime slot.
        await this.planQuota?.consumeInspection(params.tenantId);
        await db.insert(inspections).values({
            id: inspectionId,
            tenantId: params.tenantId,
            inspectorId: inspector.id,
            propertyAddress: params.propertyAddress,
            date: params.date,
            status: 'scheduled',
            paymentStatus: 'unpaid',
            paymentRequired: params.paymentRequired,
            agreementRequired: params.agreementRequired,
            price: 0,
            conciergeStatus,
            createdAt: new Date(),
        });
        // DB-8: mirror assignment into inspection_inspectors link table.
        await syncInspectionAssignments(db, params.tenantId, inspectionId, { inspectorId: inspector.id });

        // Task 7b (people-role-profiles), FIXED (Task 9b regression) — mirror
        // both the client and the referring agent into inspection_people
        // (client / buyer_agent). Task 13 dropped the legacy clientName/
        // clientEmail/clientPhone/referredByAgentId columns from inspections,
        // so this is now the ONLY persistence of WHO. The client contact is
        // resolved via the same idempotent upsert booking.service/core.ts use
        // (matches by tenant + normalized email), so approveByInspector's
        // PeopleService.getPrimaryClient join (Task 9b) always resolves a
        // client for a concierge booking.
        // Non-fatal: a people-write failure must never roll back an
        // already-committed inspection row.
        try {
            const roleRows = await db.select({ id: contactRoleProfiles.id, key: contactRoleProfiles.key })
                .from(contactRoleProfiles)
                .where(and(eq(contactRoleProfiles.tenantId, params.tenantId), eq(contactRoleProfiles.active, true)));
            const roleIdByKey = new Map(roleRows.map(r => [r.key, r.id]));
            const people = new PeopleService({ DB: this.db });

            let clientContactId: string | null = null;
            if (params.clientEmail || params.clientName) {
                const { id } = await new ContactService(this.db).upsertClientContact(params.tenantId, {
                    name: params.clientName,
                    email: params.clientEmail,
                    type: 'client',
                    ...(params.clientPhone ? { phone: params.clientPhone } : {}),
                });
                clientContactId = id;
            }

            const links: Array<[string | null, string | undefined]> = [
                [clientContactId, roleIdByKey.get('client')],
                [link.inspectorContactId, roleIdByKey.get('buyer_agent')],
            ];
            for (const [contactId, roleProfileId] of links) {
                if (contactId && roleProfileId) {
                    await people.addPerson(params.tenantId, inspectionId, contactId, roleProfileId);
                }
            }
        } catch (err) {
            logger.error('inspection-people write from concierge create failed', { inspectionId }, err instanceof Error ? err : undefined);
        }

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
                reviewUrl: `${this.appBaseUrl.replace(/\/$/, '')}/inspections`,
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
        // Resolve the client via the inspection_people primary-client join
        // (insp.clientEmail is a frozen legacy cache, dropped Task 13).
        const client = await new PeopleService({ DB: this.db }).getPrimaryClient(tenantId, inspectionId);
        if (!client?.email) {
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

        await this.mintTokenAndEmailClient(inspectionId, tenantId, client.email, {
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
        const row = await this.resolveConfirmToken(token);
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
        // Mark token used. resolveConfirmToken returns the PRE-upgrade snapshot,
        // so row.token may be the original plaintext while the DB column was just
        // rewritten to a sentinel by the lazy upgrade. Key on the hash (set by
        // both hash-native creation and the upgrade) OR the snapshot token
        // (covers a legacy row whose upgrade write failed) — exactly one row
        // can match either.
        await db
            .update(conciergeConfirmTokens)
            .set({ confirmedAt: new Date() })
            .where(
                or(
                    eq(conciergeConfirmTokens.tokenHash, await hashToken(token)),
                    eq(conciergeConfirmTokens.token, row.token),
                ),
            );

        // Notify the originating agent. The buyer's-agent contact is resolved
        // via the inspection_people (buyer_agent) join (Task 9c-X2) — not the
        // legacy inspections.referredByAgentId column (frozen cache, dropped
        // Task 13) — then looked up in contacts as before.
        try {
            const insp = await db
                .select({
                    propertyAddress: inspections.propertyAddress,
                    date: inspections.date,
                })
                .from(inspections)
                .where(eq(inspections.id, row.inspectionId))
                .get();
            const buyerAgentContactId = await new PeopleService({ DB: this.db })
                .contactIdForRole(row.tenantId, row.inspectionId, 'buyer_agent');
            if (insp && buyerAgentContactId) {
                const agentContact = await db
                    .select({ email: contacts.email, name: contacts.name })
                    .from(contacts)
                    .where(
                        and(
                            eq(contacts.id, buyerAgentContactId),
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
                tenantId: row.tenantId,
                inspectionId: row.inspectionId,
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
     * Track I-a — resolve a presented confirm token to its row. Hash-first
     * (token_hash) with a permanent legacy plaintext fallback that lazily
     * upgrades the row in place. `token` is the PK; the upgrade rewrites it to a
     * random sentinel and stores token_hash. Tier-1: hash only (single-use).
     */
    private async resolveConfirmToken(token: string): Promise<typeof conciergeConfirmTokens.$inferSelect | null> {
        const db = this.getDrizzle();
        return resolveTokenRow<typeof conciergeConfirmTokens.$inferSelect>({
            presented: token,
            byHash: async (hash) =>
                (await db.select().from(conciergeConfirmTokens).where(eq(conciergeConfirmTokens.tokenHash, hash)).get()) ?? null,
            byPlaintext: async (t) =>
                (await db.select().from(conciergeConfirmTokens).where(eq(conciergeConfirmTokens.token, t)).get()) ?? null,
            upgrade: async (legacy, hash) => {
                await db.update(conciergeConfirmTokens)
                    .set({ tokenHash: hash, token: deadTokenSentinel(crypto.randomUUID()) })
                    .where(eq(conciergeConfirmTokens.token, legacy.token));
            },
        });
    }

    /**
     * Read-only token resolution for the public /confirm/<token> page. Returns
     * a view-friendly summary (inspector + property + date + agreement flag),
     * along with `expired` and `alreadyConfirmed` flags so the page can render
     * the right state. Returns null when the token does not exist.
     */
    async resolveToken(token: string): Promise<ConciergeTokenView | null> {
        const db = this.getDrizzle();
        const row = await this.resolveConfirmToken(token);
        if (!row) return null;

        const insp = await db
            .select()
            .from(inspections)
            .where(eq(inspections.id, row.inspectionId))
            .get();
        if (!insp) return null;

        const tenantRow = await db
            .select({ slug: tenants.slug })
            .from(tenants)
            .where(eq(tenants.id, insp.tenantId))
            .get();
        const tenantSlug = tenantRow?.slug ?? '';

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

        // Task 9c (people-role-profiles) — clientName/clientEmail are sourced
        // from the inspection_people primary-client join (PeopleService), not
        // the legacy inspections.client_name/_email columns (frozen cache,
        // dropped Task 13). Hard cutover, no legacy-column fallback, mirroring
        // approveByInspector's PeopleService.getPrimaryClient use above.
        const primaryClient = await new PeopleService({ DB: this.db }).getPrimaryClient(insp.tenantId, insp.id);

        const expMs = toMs(row.expiresAt);
        return {
            inspection: {
                id: insp.id,
                tenantId: insp.tenantId,
                tenantSlug,
                propertyAddress: insp.propertyAddress,
                date: insp.date,
                clientName: primaryClient?.name ?? null,
                clientEmail: primaryClient?.email ?? null,
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
            // `token` is the PK; the plaintext is never stored. A per-row random
            // sentinel keeps the PK unique while the real token lives only in the
            // email + token_hash. Tier-1: hash only (single-use magic link).
            token: deadTokenSentinel(crypto.randomUUID()),
            tokenHash: await hashToken(token),
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
