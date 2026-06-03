import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc } from 'drizzle-orm';
import { Context } from 'hono';
import * as schema from './db/schema';
import { HonoConfig } from '../types/hono';

/**
 * Spec 5H P2 — Public verifier (no-auth, court-friendly) data loader.
 * Shared by the raw `/api/public/verify/*` sibling routes (in server/index.ts)
 * and the typed `GET /api/public/verify/:envelopeId` route (public-report.ts).
 * Returns null when the envelope is unknown.
 */
export async function loadVerifyData(c: Context<HonoConfig>, envelopeId: string) {
    const db = drizzle(c.env.DB, { schema });
    const reqRow = await db.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, envelopeId)).get();
    if (!reqRow) return null;
    const agreement = await db.select().from(schema.agreements).where(eq(schema.agreements.id, reqRow.agreementId)).get();
    const auditRows = await db.select().from(schema.esignAuditLogs)
        .where(and(eq(schema.esignAuditLogs.tenantId, reqRow.tenantId), eq(schema.esignAuditLogs.requestId, envelopeId)))
        .orderBy(asc(schema.esignAuditLogs.createdAt))
        .all();
    const verify = await c.var.services.auditLog.verifyChain(reqRow.tenantId, envelopeId);
    const pubKey = await c.var.services.signingKey.getPublicKey(reqRow.tenantId);
    const tenantRow = await db.select({ slug: schema.tenants.slug })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, reqRow.tenantId))
        .get();
    const tenantSlug = tenantRow?.slug ?? '';
    return { reqRow, agreement, auditRows, verify, pubKey, tenantSlug };
}
