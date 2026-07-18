import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { inspectionAccessTokens } from '../lib/db/schema/portal-access';
import { contactRoleProfiles } from '../lib/db/schema';
import type { PortalAccessRow, PortalRole } from '../lib/public-access';
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
                    expiresAt: null,
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
            expiresAt: null,
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
            inspectionId: row.inspectionId,
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
     * {tenantId, role, recipientEmail} from the row, or null if no live grant.
     */
    async resolveByEmailAndInspection(
        email: string,
        inspectionId: string,
        now: number = Date.now(),
    ): Promise<{ tenantId: string; role: PortalRole; recipientEmail: string } | null> {
        const db = this.getDrizzle();
        const row = await db.select().from(inspectionAccessTokens)
            .where(and(
                eq(inspectionAccessTokens.recipientEmail, email),
                eq(inspectionAccessTokens.inspectionId, inspectionId),
            )).get();
        if (!row || row.revokedAt != null) return null;
        if (row.expiresAt != null && row.expiresAt.getTime() <= now) return null;
        return { tenantId: row.tenantId, role: row.role, recipientEmail: row.recipientEmail };
    }

    /** Inspector "Reset access link" — revoke a recipient's current token. */
    async revokeForRecipient(tenantId: string, inspectionId: string, recipientEmail: string): Promise<void> {
        const db = this.getDrizzle();
        await db.update(inspectionAccessTokens)
            .set({ revokedAt: new Date() })
            .where(and(
                eq(inspectionAccessTokens.tenantId, tenantId),
                eq(inspectionAccessTokens.inspectionId, inspectionId),
                eq(inspectionAccessTokens.recipientEmail, recipientEmail),
            ))
            .run();
    }

    /** Lifecycle: set an expiry (e.g. delivery + 45d) on all of an order's tokens. */
    async setExpiryForInspection(tenantId: string, inspectionId: string, expiresAt: number): Promise<void> {
        const db = this.getDrizzle();
        await db.update(inspectionAccessTokens)
            .set({ expiresAt: new Date(expiresAt) })
            .where(and(
                eq(inspectionAccessTokens.tenantId, tenantId),
                eq(inspectionAccessTokens.inspectionId, inspectionId),
            ))
            .run();
    }
}
