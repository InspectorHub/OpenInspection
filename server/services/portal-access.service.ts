import { drizzle } from 'drizzle-orm/d1';
import { eq, and, or, gt, isNull, count, inArray } from 'drizzle-orm';
import { inspectionAccessTokens } from '../lib/db/schema/portal-access';
import { contactRoleProfiles, tenantConfigs, inspections } from '../lib/db/schema';
import { resolveReportLinkTtl, reportLinkExpiresAt } from '../lib/report-link-ttl';
import type { RoleKind } from '../lib/people/capabilities';
import type { PortalAccessRow, PortalRole } from '../lib/public-access';
// Leaf module on purpose — `public-access` is in an import cycle with the DI
// service types, and this file needs the VALUE, not just the type.
import { portalLinkState, type PortalLinkState } from '../lib/portal-link-state';

/** A row EXISTS here, so 'unknown' (nothing to speak for) cannot occur. */
type IssuedLinkState = Exclude<PortalLinkState, 'unknown'>;
import { mintToken, hashToken, deadTokenSentinel, resolveTokenRow } from '../lib/token-hash';
import { sealToken, openToken } from '../lib/config-crypto';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * Issues + resolves the PERSISTENT per-(recipient, order) portal tokens.
 * The token is STABLE for the (inspection, recipient) pair — re-issuing returns
 * the existing live token so old emails keep working. See memory
 * project_client_portal_token_model.
 *
 * Track I-a — hash-at-rest (tier-2). The plaintext token is never stored: the
 * row carries `token_hash` (lookup) + `token_enc` (KEK-sealed, so the server
 * can RECONSTRUCT the same link for re-issue / reminders). The legacy `token`
 * column is cleared to a per-row sentinel on new writes and lazily on lookup of
 * legacy plaintext rows (permanent fallback so OSS self-hosts upgrade with zero
 * ops steps).
 */
export class PortalAccessService {
    constructor(
        private db: D1Database,
        private secrets?: { jwtSecret: string; jwtSecretPrevious?: string },
    ) {}

    private getDrizzle() { return drizzle(this.db); }

    private newToken(): string {
        return mintToken();
    }

    private requireSecrets(): { jwtSecret: string; jwtSecretPrevious?: string } {
        if (!this.secrets) throw Errors.Internal('Token sealing key unavailable');
        return this.secrets;
    }

    /**
     * Reconstruct the plaintext link for a row. Prefers a non-sentinel legacy
     * plaintext column (row not yet upgraded); otherwise opens the sealed
     * token_enc (current → previous secret). Mirrors AgreementService.getSignerLink.
     */
    private async reconstruct(row: typeof inspectionAccessTokens.$inferSelect): Promise<string> {
        const sentinel = deadTokenSentinel(row.id);
        if (row.token && row.token !== sentinel) return row.token; // legacy not-yet-upgraded
        if (!row.tokenEnc) throw Errors.Internal('Portal token cannot be reconstructed (no token_enc)');
        const s = this.requireSecrets();
        return openToken(row.tokenEnc, row.tenantId, s.jwtSecret, s.jwtSecretPrevious);
    }

    /**
     * Resolve a portal grant's role KEY to its role-profile KIND
     * (client / agent / other). The `role` on a token is a free-form key, so a
     * caller that needs to know "is this an agent?" must map key → kind here
     * rather than hardcode the seed keys (which misses tenant-custom profiles).
     * Returns null when the key has no active profile for the tenant.
     */
    async getRoleKind(tenantId: string, roleKey: string): Promise<RoleKind | null> {
        const db = this.getDrizzle();
        const row = await db.select({ kind: contactRoleProfiles.kind }).from(contactRoleProfiles)
            .where(and(
                eq(contactRoleProfiles.tenantId, tenantId),
                eq(contactRoleProfiles.key, roleKey),
                eq(contactRoleProfiles.active, true),
            ))
            .get();
        return (row?.kind as RoleKind | undefined) ?? null;
    }

    /**
     * The `role` column is a free-form role-profile KEY, not a fixed enum —
     * validate it against the tenant's active `contact_role_profiles` so a
     * typo'd/retired key can never be written. `client` is a seeded default so
     * this lookup passes for it too (no special-casing).
     */
    private async validateRole(tenantId: string, role: string): Promise<void> {
        const db = this.getDrizzle();
        const profile = await db.select({ id: contactRoleProfiles.id }).from(contactRoleProfiles)
            .where(and(
                eq(contactRoleProfiles.tenantId, tenantId),
                eq(contactRoleProfiles.key, role),
                eq(contactRoleProfiles.active, true),
            ))
            .get();
        if (!profile) throw Errors.BadRequest('Unknown role for tenant: ' + role);
    }

    /**
     * The absolute expiry a link minted RIGHT NOW should carry, per the
     * tenant's `reportLinkTtl` policy (IA-36 ⑤). Null = open-ended.
     *
     * Read at mint time only. Nothing recomputes the expiry of a row that
     * already exists, which is what makes ⑥ true by construction: raising or
     * lowering the policy cannot silently kill (or resurrect) links that are
     * already in customers' inboxes.
     */
    private async policyExpiry(tenantId: string, from: number = Date.now()): Promise<Date | null> {
        const db = this.getDrizzle();
        const row = await db.select({ prefs: tenantConfigs.inspectionPrefs })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        const at = reportLinkExpiresAt(resolveReportLinkTtl(row?.prefs), from);
        return at == null ? null : new Date(at);
    }

    /** Idempotent: returns the existing live token for (inspection, recipient), else mints one. */
    async issueToken(input: { tenantId: string; inspectionId: string; recipientEmail: string; role?: PortalRole }): Promise<string> {
        const db = this.getDrizzle();
        const existing = await db.select().from(inspectionAccessTokens)
            .where(and(
                eq(inspectionAccessTokens.tenantId, input.tenantId),
                eq(inspectionAccessTokens.inspectionId, input.inspectionId),
                eq(inspectionAccessTokens.recipientEmail, input.recipientEmail),
            ))
            .get();
        if (existing && existing.revokedAt == null) {
            // Stable link — reconstruct the SAME plaintext rather than rotate.
            return this.reconstruct(existing);
        }

        const s = this.requireSecrets();
        const token = this.newToken();
        const tokenHash = await hashToken(token);
        const tokenEnc = await sealToken(token, input.tenantId, s.jwtSecret);
        if (existing) {
            // Revoked previously → re-arm the same row with a fresh token.
            const effectiveRole = input.role ?? existing.role;
            await this.validateRole(input.tenantId, effectiveRole);
            await db.update(inspectionAccessTokens)
                .set({
                    token: deadTokenSentinel(existing.id),
                    tokenHash,
                    tokenEnc,
                    revokedAt: null,
                    expiresAt: await this.policyExpiry(input.tenantId),
                    role: effectiveRole,
                    createdAt: new Date(),
                })
                .where(eq(inspectionAccessTokens.id, existing.id))
                .run();
            return token;
        }
        const effectiveRole = input.role ?? 'client';
        await this.validateRole(input.tenantId, effectiveRole);
        const id = crypto.randomUUID();
        await db.insert(inspectionAccessTokens).values({
            id,
            tenantId: input.tenantId,
            inspectionId: input.inspectionId,
            recipientEmail: input.recipientEmail,
            role: effectiveRole,
            // Never distributed — satisfies NOT NULL + UNIQUE on the legacy column.
            token: deadTokenSentinel(id),
            tokenHash,
            tokenEnc,
            createdAt: new Date(),
            expiresAt: await this.policyExpiry(input.tenantId),
            revokedAt: null,
        }).run();
        return token;
    }

    /** Single-row lookup for the public-access guard. */
    async resolveToken(token: string): Promise<PortalAccessRow | null> {
        const db = this.getDrizzle();
        const row = await resolveTokenRow<typeof inspectionAccessTokens.$inferSelect>({
            presented: token,
            byHash: async (hash) =>
                (await db.select().from(inspectionAccessTokens).where(eq(inspectionAccessTokens.tokenHash, hash)).get()) ?? null,
            byPlaintext: async (t) =>
                (await db.select().from(inspectionAccessTokens).where(eq(inspectionAccessTokens.token, t)).get()) ?? null,
            upgrade: async (legacy, hash) => {
                const setValues: Partial<typeof inspectionAccessTokens.$inferInsert> = {
                    tokenHash: hash,
                    token: deadTokenSentinel(legacy.id),
                };
                // Best-effort seal so re-issue can reconstruct after upgrade.
                if (this.secrets) {
                    try {
                        setValues.tokenEnc = await sealToken(token, legacy.tenantId, this.secrets.jwtSecret);
                    } catch (e) {
                        logger.warn('portal-access.upgrade.seal.failed', { error: e instanceof Error ? e.message : String(e) });
                    }
                }
                await db.update(inspectionAccessTokens).set(setValues).where(eq(inspectionAccessTokens.id, legacy.id)).run();
            },
        });
        if (!row) return null;
        return {
            id: row.id, inspectionId: row.inspectionId,
            tenantId: row.tenantId,
            role: row.role,
            recipientEmail: row.recipientEmail,
            // PortalAccessRow keeps the epoch-ms number contract (consistent
            // with Date.now(), consumed by resolvePortalAccess) independent of
            // the column's own Date storage type.
            revokedAt: row.revokedAt ? row.revokedAt.getTime() : null,
            expiresAt: row.expiresAt ? row.expiresAt.getTime() : null,
        };
    }

    /**
     * Resolve the LIVE (non-revoked, non-expired) grant for a (recipientEmail,
     * inspectionId) pair — used by the unified-portal SESSION-cookie path, where
     * there is no URL `?token` to resolve. Returns the authoritative
     * {id, tenantId, role, recipientEmail} from the row, or null if no live grant.
     * `id` is part of the contract on BOTH paths — see PortalAccessRow.id.
     */
    async resolveByEmailAndInspection(
        email: string, inspectionId: string, now: number = Date.now(),
    ): Promise<{ id: string; tenantId: string; role: PortalRole; recipientEmail: string } | null> {
        const db = this.getDrizzle();
        const row = await db.select().from(inspectionAccessTokens)
            .where(and(
                eq(inspectionAccessTokens.recipientEmail, email),
                eq(inspectionAccessTokens.inspectionId, inspectionId),
            )).get();
        if (!row || row.revokedAt != null) return null;
        if (row.expiresAt != null && row.expiresAt.getTime() <= now) return null;
        return { id: row.id, tenantId: row.tenantId, role: row.role, recipientEmail: row.recipientEmail };
    }

    /** The single (inspection, recipient) row, tenant-scoped, or null. */
    private async rowForRecipient(tenantId: string, inspectionId: string, recipientEmail: string) {
        const db = this.getDrizzle();
        return (await db.select().from(inspectionAccessTokens)
            .where(and(
                eq(inspectionAccessTokens.tenantId, tenantId),
                eq(inspectionAccessTokens.inspectionId, inspectionId),
                eq(inspectionAccessTokens.recipientEmail, recipientEmail),
            ))
            .get()) ?? null;
    }

    /**
     * Take a recipient's access away (IA-36 ①). Called when they LEAVE the
     * inspection — `revokedAt` outranks `expiresAt` in every guard, so the link
     * is dead regardless of what the expiry policy says.
     *
     * Returns the hash of the token that was killed so the caller can reference
     * it in the audit trail. Never returns (or logs) the plaintext.
     */
    /**
     * Every inspection this email can still open in this tenant (IA-100).
     *
     * An agent or client reaches a report through a per-inspection token that
     * works with NO account, so "does this person still have access" is not
     * answerable from the contacts page — the answer lives one row per
     * inspection, in a table nothing surfaced. Archiving a contact therefore
     * looked like it cut them off and did not.
     *
     * Live means: not revoked, and not past its expiry. A token with a null
     * `expiresAt` is open by policy (the order is still active) and counts as
     * live — treating null as "expired" would under-report access, which is
     * the dangerous direction for a screen whose job is to answer "who can
     * still read this".
     *
     * Type-agnostic on purpose. Clients hold these links exactly as agents do,
     * and an operator revoking access after a sale falls through cares about
     * the person, not their contact type.
     */
    async listLiveAccessByRecipient(tenantId: string, recipientEmail: string): Promise<Array<{
        inspectionId: string;
        propertyAddress: string | null;
        role: string;
        createdAt: number | null;
    }>> {
        const db = this.getDrizzle();
        const now = new Date();
        const rows = await db
            .select({
                inspectionId:    inspectionAccessTokens.inspectionId,
                propertyAddress: inspections.propertyAddress,
                role:            inspectionAccessTokens.role,
                createdAt:       inspectionAccessTokens.createdAt,
            })
            .from(inspectionAccessTokens)
            .leftJoin(inspections, and(
                eq(inspections.id, inspectionAccessTokens.inspectionId),
                eq(inspections.tenantId, inspectionAccessTokens.tenantId),
            ))
            .where(and(
                eq(inspectionAccessTokens.tenantId, tenantId),
                eq(inspectionAccessTokens.recipientEmail, recipientEmail),
                isNull(inspectionAccessTokens.revokedAt),
                or(
                    isNull(inspectionAccessTokens.expiresAt),
                    gt(inspectionAccessTokens.expiresAt, now),
                ),
            ))
            .all();
        return rows.map((r) => ({
            inspectionId:    r.inspectionId,
            propertyAddress: r.propertyAddress ?? null,
            role:            r.role,
            createdAt:       r.createdAt instanceof Date ? r.createdAt.getTime() : (r.createdAt ? Number(r.createdAt) : null),
        }));
    }

    /**
     * Revoke this recipient's access to the named inspections, or to ALL of
     * them when `inspectionIds` is omitted (IA-100).
     *
     * One statement rather than a loop over revokeForRecipient: a partial
     * failure midway through a bulk revoke would leave the operator believing
     * they had cut access off when some links still worked, and that is the
     * failure mode least acceptable here.
     *
     * Returns how many rows it actually revoked, so the caller can report the
     * real number instead of echoing what was asked for.
     */
    async revokeAccessForRecipient(
        tenantId: string,
        recipientEmail: string,
        inspectionIds?: string[],
    ): Promise<number> {
        const db = this.getDrizzle();
        if (inspectionIds && inspectionIds.length === 0) return 0;

        const live = await this.listLiveAccessByRecipient(tenantId, recipientEmail);
        const targets = inspectionIds
            ? live.filter((l) => inspectionIds.includes(l.inspectionId))
            : live;
        if (targets.length === 0) return 0;

        await db.update(inspectionAccessTokens)
            .set({ revokedAt: new Date() })
            .where(and(
                eq(inspectionAccessTokens.tenantId, tenantId),
                eq(inspectionAccessTokens.recipientEmail, recipientEmail),
                inArray(inspectionAccessTokens.inspectionId, targets.map((t) => t.inspectionId)),
                isNull(inspectionAccessTokens.revokedAt),
            ))
            .run();
        return targets.length;
    }

    async revokeForRecipient(tenantId: string, inspectionId: string, recipientEmail: string): Promise<{ previousTokenHash: string | null }> {
        const db = this.getDrizzle();
        const existing = await this.rowForRecipient(tenantId, inspectionId, recipientEmail);
        await db.update(inspectionAccessTokens)
            .set({ revokedAt: new Date() })
            .where(and(
                eq(inspectionAccessTokens.tenantId, tenantId),
                eq(inspectionAccessTokens.inspectionId, inspectionId),
                eq(inspectionAccessTokens.recipientEmail, recipientEmail),
            ))
            .run();
        return { previousTokenHash: existing?.tokenHash ?? null };
    }

    /**
     * Inspector "Reset access link" (IA-36 ②) — the link was forwarded to the
     * wrong person, or sent to a mistyped address. Mints a NEW secret for the
     * same (inspection, recipient) pair; the old URL stops working immediately.
     *
     * Rotation must happen IN PLACE. `idx_iat_recipient` is UNIQUE on
     * (inspection_id, recipient_email), so "revoke the old row and insert a new
     * one" is not available — it collides. That is also why the old secret
     * cannot be kept for forensics, and why the caller writes an audit event
     * carrying `previousTokenHash` instead.
     *
     * Distinct from `issueToken`, which deliberately does NOT rotate: automation
     * emails, reminders and copy-pay-link all re-issue and must keep handing out
     * the SAME link a customer already has. Reset is the explicit, operator-
     * initiated break of that continuity.
     *
     * Returns null when the recipient has no link (nothing to reset).
     */
    async rotateForRecipient(
        tenantId: string, inspectionId: string, recipientEmail: string,
    ): Promise<{ token: string; previousTokenHash: string | null } | null> {
        const db = this.getDrizzle();
        const existing = await this.rowForRecipient(tenantId, inspectionId, recipientEmail);
        if (!existing) return null;

        const s = this.requireSecrets();
        const token = this.newToken();
        const tokenHash = await hashToken(token);
        const tokenEnc = await sealToken(token, tenantId, s.jwtSecret);
        await db.update(inspectionAccessTokens)
            .set({
                token: deadTokenSentinel(existing.id),
                tokenHash,
                tokenEnc,
                // A reset RESTORES access for a recipient who is still on the
                // inspection — a previously revoked row is re-armed.
                revokedAt: null,
                // Re-dated from the policy in force NOW: this is a new link.
                expiresAt: await this.policyExpiry(tenantId),
                createdAt: new Date(),
            })
            // The id came from a tenant-scoped read above; re-stating the tenant
            // filter keeps the write self-evidently scoped at the call site.
            .where(and(
                eq(inspectionAccessTokens.id, existing.id),
                eq(inspectionAccessTokens.tenantId, tenantId),
            ))
            .run();
        return { token, previousTokenHash: existing.tokenHash };
    }

    /**
     * IA-36 ⑥ — the tenant-wide backlog a policy change deliberately does NOT
     * touch: links that are alive RIGHT NOW.
     *
     * "Alive" means not revoked and not already past its expiry. Both
     * exclusions are load-bearing, and this predicate is shared with
     * `setExpiryForTenant` on purpose: the count is rendered INTO the button
     * ("Expire 47 links"), so if the two ever disagreed the button would be
     * lying about its own blast radius — which is the exact failure ⑥ exists
     * to prevent.
     *
     * Excluding already-expired rows also means a bulk apply can never
     * resurrect a link that has already died. Handing a dead URL back to
     * whoever still has it in an inbox is not a side effect anyone asked for.
     */
    private liveLinkFilter(tenantId: string, now: number) {
        return and(
            eq(inspectionAccessTokens.tenantId, tenantId),
            isNull(inspectionAccessTokens.revokedAt),
            or(
                isNull(inspectionAccessTokens.expiresAt),
                gt(inspectionAccessTokens.expiresAt, new Date(now)),
            ),
        );
    }

    /** How many report links across the whole tenant are usable right now. */
    async countLiveLinksForTenant(tenantId: string, now: number = Date.now()): Promise<number> {
        const db = this.getDrizzle();
        const row = await db
            .select({ n: count() })
            .from(inspectionAccessTokens)
            .where(this.liveLinkFilter(tenantId, now))
            .get();
        return row?.n ?? 0;
    }

    /**
     * IA-36 ⑥ — apply an expiry to the tenant's EXISTING live links.
     *
     * Never called as a side effect of saving the tenant policy: changing
     * `reportLinkTtl` only governs links minted afterwards. Retroactively
     * re-dating links already sitting in customers' inboxes would silently
     * kill them in bulk, which is the accident IA-36 was opened about — so
     * acting on the backlog is a separate, explicitly confirmed verb.
     *
     * Returns the number of rows changed so the caller can report what it
     * actually did rather than what it intended to do.
     */
    async setExpiryForTenant(tenantId: string, expiresAt: number | null, now: number = Date.now()): Promise<number> {
        const db = this.getDrizzle();
        // Count first, under the same predicate, in the same logical step:
        // D1 does not report an affected-row count we can trust across drivers.
        const affected = await this.countLiveLinksForTenant(tenantId, now);
        await db.update(inspectionAccessTokens)
            .set({ expiresAt: expiresAt == null ? null : new Date(expiresAt) })
            .where(this.liveLinkFilter(tenantId, now))
            .run();
        return affected;
    }

    /** Lifecycle: set an expiry on all of an order's tokens; null lifts it again. */
    async setExpiryForInspection(tenantId: string, inspectionId: string, expiresAt: number | null): Promise<void> {
        const db = this.getDrizzle();
        await db.update(inspectionAccessTokens)
            .set({ expiresAt: expiresAt == null ? null : new Date(expiresAt) })
            .where(and(
                eq(inspectionAccessTokens.tenantId, tenantId),
                eq(inspectionAccessTokens.inspectionId, inspectionId),
            ))
            .run();
    }

    /**
     * Per-recipient link state for the People card (IA-36 ⑪). The card lists
     * people; before it can offer "reset this person's link" it has to say what
     * that link's state IS — otherwise the operator is acting blind.
     *
     * Carries no secret material: only when the link was minted, when it dies,
     * and the resolved status. `revoked` outranks `expired` (③) so the two
     * never disagree with the guard.
     */
    async listAccessForInspection(
        tenantId: string, inspectionId: string, now: number = Date.now(),
    ): Promise<Array<{ recipientEmail: string; sentAt: number; expiresAt: number | null; status: IssuedLinkState }>> {
        const db = this.getDrizzle();
        const rows = await db.select({
            recipientEmail: inspectionAccessTokens.recipientEmail,
            createdAt: inspectionAccessTokens.createdAt,
            expiresAt: inspectionAccessTokens.expiresAt,
            revokedAt: inspectionAccessTokens.revokedAt,
        }).from(inspectionAccessTokens)
            .where(and(
                eq(inspectionAccessTokens.tenantId, tenantId),
                eq(inspectionAccessTokens.inspectionId, inspectionId),
            ))
            .all();
        return rows.map((r) => {
            const expiresAt = r.expiresAt ? r.expiresAt.getTime() : null;
            const revokedAt = r.revokedAt ? r.revokedAt.getTime() : null;
            return {
                recipientEmail: r.recipientEmail,
                sentAt: r.createdAt.getTime(),
                expiresAt,
                status: portalLinkState({ revokedAt, expiresAt }, now) as IssuedLinkState,
            };
        });
    }
}
