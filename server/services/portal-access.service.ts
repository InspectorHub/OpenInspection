import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { inspectionAccessTokens } from '../lib/db/schema/portal-access';
import type { PortalAccessRow, PortalRole } from '../lib/public-access';

/**
 * Issues + resolves the PERSISTENT per-(recipient, order) portal tokens.
 * The token is STABLE for the (inspection, recipient) pair — re-issuing returns
 * the existing live token so old emails keep working. See memory
 * project_client_portal_token_model.
 */
export class PortalAccessService {
    constructor(private db: D1Database) {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private getDrizzle() { return drizzle(this.db as any); }

    private newToken(): string {
        return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    }

    /** Idempotent: returns the existing live token for (inspection, recipient), else mints one. */
    async issueToken(input: { tenantId: string; inspectionId: string; recipientEmail: string; role?: PortalRole }): Promise<string> {
        const db = this.getDrizzle();
        const existing = await db.select().from(inspectionAccessTokens)
            .where(and(
                eq(inspectionAccessTokens.inspectionId, input.inspectionId),
                eq(inspectionAccessTokens.recipientEmail, input.recipientEmail),
            ))
            .get();
        if (existing && existing.revokedAt == null) return existing.token;

        const token = this.newToken();
        if (existing) {
            // Revoked previously → re-arm the same row with a fresh token.
            await db.update(inspectionAccessTokens)
                .set({ token, revokedAt: null, expiresAt: null, role: input.role ?? existing.role, createdAt: Date.now() })
                .where(eq(inspectionAccessTokens.id, existing.id))
                .run();
            return token;
        }
        await db.insert(inspectionAccessTokens).values({
            id: crypto.randomUUID(),
            tenantId: input.tenantId,
            inspectionId: input.inspectionId,
            recipientEmail: input.recipientEmail,
            role: input.role ?? 'client',
            token,
            createdAt: Date.now(),
            expiresAt: null,
            revokedAt: null,
        }).run();
        return token;
    }

    /** Single-row lookup for the public-access guard. */
    async resolveToken(token: string): Promise<PortalAccessRow | null> {
        const db = this.getDrizzle();
        const row = await db.select().from(inspectionAccessTokens)
            .where(eq(inspectionAccessTokens.token, token))
            .get();
        if (!row) return null;
        return {
            inspectionId: row.inspectionId,
            tenantId: row.tenantId,
            role: row.role as PortalRole,
            recipientEmail: row.recipientEmail,
            revokedAt: row.revokedAt,
            expiresAt: row.expiresAt,
        };
    }

    /** Inspector "Reset access link" — revoke a recipient's current token. */
    async revokeForRecipient(inspectionId: string, recipientEmail: string): Promise<void> {
        const db = this.getDrizzle();
        await db.update(inspectionAccessTokens)
            .set({ revokedAt: Date.now() })
            .where(and(
                eq(inspectionAccessTokens.inspectionId, inspectionId),
                eq(inspectionAccessTokens.recipientEmail, recipientEmail),
            ))
            .run();
    }

    /** Lifecycle: set an expiry (e.g. delivery + 45d) on all of an order's tokens. */
    async setExpiryForInspection(inspectionId: string, expiresAt: number): Promise<void> {
        const db = this.getDrizzle();
        await db.update(inspectionAccessTokens)
            .set({ expiresAt })
            .where(eq(inspectionAccessTokens.inspectionId, inspectionId))
            .run();
    }
}
