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
import { generateRandomToken } from '../lib/random-token';

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

export class ObserverLinkService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    async mint(tenantId: string, input: MintInput): Promise<MintOutput> {
        const db        = this.getDrizzle();
        const id        = crypto.randomUUID();
        const token     = generateRandomToken();
        const expiresAt = Math.floor(Date.now() / 1000) + (input.durationSeconds ?? DEFAULT_DURATION_SECONDS);

        await db.insert(observerLinks).values({
            id,
            tenantId,
            inspectionId: input.inspectionId,
            token,
            createdBy:    input.createdBy,
            createdAt:    new Date().toISOString(),
            expiresAt,
        });

        return { id, token, expiresAt };
    }

    /**
     * Anonymous lookup. Returns `kind:'ok'` with the row + matched tenant
     * so the route can mint a cookie. revoked / expired short-circuit.
     */
    async claim(token: string): Promise<ClaimResult> {
        const db   = this.getDrizzle();
        const link = await db.select().from(observerLinks).where(eq(observerLinks.token, token)).get();
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
        return await db.select().from(observerLinks)
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
