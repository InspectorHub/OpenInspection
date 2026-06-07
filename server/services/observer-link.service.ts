/**
 * Design System 0520 subsystem D phase 4 task 4.3 — ObserverLinkService.
 *
 * mint / list / claim / revoke for the no-account read-only viewer flow.
 * Tokens are 32 bytes of crypto-random url-safe base64; storage row
 * carries expiresAt + revokedAt + lastViewedAt for audit purposes.
 *
 * Tenant isolation via explicit tenantId on every method that takes
 * one. /observe/:token (claim) is anonymous — the token itself is the
 * capability, so the service does the tenant lookup as a side effect
 * of finding the row by token.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { observerLinks } from '../lib/db/schema';
import { mintToken, hashToken, deadTokenSentinel, resolveTokenRow } from '../lib/token-hash';
import { sealToken, openToken } from '../lib/config-crypto';
import { Errors } from '../lib/errors';
import { logger } from '../lib/logger';

const DEFAULT_DURATION_SECONDS = 7 * 24 * 3600;     // 7 days

export interface MintInput {
    inspectionId:    string;
    createdBy:       string;
    durationSeconds?: number;
}

export interface MintOutput {
    id:        string;
    token:     string;
    expiresAt: number;
}

export type ClaimResult =
    | { kind: 'ok';        linkId: string; inspectionId: string; exp: number; tenantId: string }
    | { kind: 'expired' }
    | { kind: 'revoked' }
    | { kind: 'not_found' };

/**
 * Track I-a — hash-at-rest (tier-2). The plaintext observer token is never
 * stored: the row carries `token_hash` (lookup) + `token_enc` (KEK-sealed, so a
 * link-display path can RECONSTRUCT the same URL later). The legacy `token`
 * column is cleared to a per-row sentinel on new writes and lazily on lookup of
 * legacy plaintext rows (permanent fallback so OSS self-hosts upgrade with zero
 * ops steps).
 */
export class ObserverLinkService {
    constructor(
        private db: D1Database,
        private secrets?: { jwtSecret: string; jwtSecretPrevious?: string },
    ) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    private requireSecrets(): { jwtSecret: string; jwtSecretPrevious?: string } {
        if (!this.secrets) throw Errors.Internal('Token sealing key unavailable');
        return this.secrets;
    }

    async mint(tenantId: string, input: MintInput): Promise<MintOutput> {
        const db        = this.getDrizzle();
        const id        = crypto.randomUUID();
        const token     = mintToken();
        const expiresAt = Math.floor(Date.now() / 1000) + (input.durationSeconds ?? DEFAULT_DURATION_SECONDS);
        const s         = this.requireSecrets();

        await db.insert(observerLinks).values({
            id,
            tenantId,
            inspectionId: input.inspectionId,
            // Never distributed — satisfies NOT NULL + UNIQUE on the legacy column.
            token:        deadTokenSentinel(id),
            tokenHash:    await hashToken(token),
            tokenEnc:     await sealToken(token, tenantId, s.jwtSecret),
            createdBy:    input.createdBy,
            createdAt:    new Date().toISOString(),
            expiresAt,
        });

        return { id, token, expiresAt };
    }

    /**
     * Reconstruct the plaintext token for a stored link (tenant-scoped). Prefers
     * a non-sentinel legacy plaintext column (row not yet upgraded); otherwise
     * opens the sealed token_enc (current → previous secret). Used by any
     * link-display/copy path. Mirrors AgreementService.getSignerLink.
     */
    async getToken(tenantId: string, linkId: string): Promise<string> {
        const db  = this.getDrizzle();
        const row = await db.select().from(observerLinks)
            .where(and(eq(observerLinks.id, linkId), eq(observerLinks.tenantId, tenantId))).get();
        if (!row) throw Errors.NotFound('Observer link not found');
        const sentinel = deadTokenSentinel(row.id);
        if (row.token && row.token !== sentinel) return row.token; // legacy not-yet-upgraded
        if (!row.tokenEnc) throw Errors.Internal('Observer token cannot be reconstructed (no token_enc)');
        const s = this.requireSecrets();
        return openToken(row.tokenEnc, row.tenantId, s.jwtSecret, s.jwtSecretPrevious);
    }

    /**
     * Anonymous lookup. Returns `kind:'ok'` with the row + matched tenant
     * so the route can mint a cookie. revoked / expired short-circuit.
     */
    async claim(token: string): Promise<ClaimResult> {
        const db   = this.getDrizzle();
        const link = await resolveTokenRow<typeof observerLinks.$inferSelect>({
            presented: token,
            byHash: async (hash) =>
                (await db.select().from(observerLinks).where(eq(observerLinks.tokenHash, hash)).get()) ?? null,
            byPlaintext: async (t) =>
                (await db.select().from(observerLinks).where(eq(observerLinks.token, t)).get()) ?? null,
            upgrade: async (legacy, hash) => {
                const setValues: Partial<typeof observerLinks.$inferInsert> = {
                    tokenHash: hash,
                    token: deadTokenSentinel(legacy.id),
                };
                if (this.secrets) {
                    try {
                        setValues.tokenEnc = await sealToken(token, legacy.tenantId, this.secrets.jwtSecret);
                    } catch (e) {
                        logger.warn('observer-link.upgrade.seal.failed', { error: e instanceof Error ? e.message : String(e) });
                    }
                }
                await db.update(observerLinks).set(setValues).where(eq(observerLinks.id, legacy.id));
            },
        });
        if (!link) return { kind: 'not_found' };
        if (link.revokedAt) return { kind: 'revoked' };
        if (link.expiresAt < Math.floor(Date.now() / 1000)) return { kind: 'expired' };

        // Bump lastViewedAt for audit. Fire-and-forget would be ideal but
        // D1's writes are sub-ms locally — synchronous keeps the surface
        // simple without a meaningful latency cost.
        await db.update(observerLinks)
            .set({ lastViewedAt: Math.floor(Date.now() / 1000) })
            .where(eq(observerLinks.id, link.id));

        return {
            kind:         'ok',
            linkId:       link.id,
            inspectionId: link.inspectionId,
            exp:          link.expiresAt,
            tenantId:     link.tenantId,
        };
    }

    async list(tenantId: string, inspectionId: string) {
        const db = this.getDrizzle();
        // Token material is projected OUT: post hash-at-rest sweep the
        // plaintext column holds a dead sentinel, and tokenHash/tokenEnc must
        // never reach a client. Callers needing a shareable URL use getToken().
        return await db.select({
            id:           observerLinks.id,
            tenantId:     observerLinks.tenantId,
            inspectionId: observerLinks.inspectionId,
            createdBy:    observerLinks.createdBy,
            createdAt:    observerLinks.createdAt,
            expiresAt:    observerLinks.expiresAt,
            revokedAt:    observerLinks.revokedAt,
            lastViewedAt: observerLinks.lastViewedAt,
        }).from(observerLinks)
            .where(and(
                eq(observerLinks.tenantId, tenantId),
                eq(observerLinks.inspectionId, inspectionId),
            ))
            .all();
    }

    async revoke(tenantId: string, linkId: string): Promise<void> {
        const db = this.getDrizzle();
        await db.update(observerLinks)
            .set({ revokedAt: Math.floor(Date.now() / 1000) })
            .where(and(
                eq(observerLinks.id, linkId),
                eq(observerLinks.tenantId, tenantId),
            ));
    }
}
