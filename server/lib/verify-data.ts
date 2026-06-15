import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc } from 'drizzle-orm';
import { Context } from 'hono';
import * as schema from './db/schema';
import { HonoConfig } from '../types/hono';
import { isReportPublished } from './status/report-status';

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
    // Track I-a — per-signer roster for the public verifier. NO emails are
    // exposed (privacy): only name, role, status, signedAt, channel. Ordered by
    // creation to match the signature order on the rendered document.
    const signers = await db.select({
        name: schema.agreementSigners.name,
        role: schema.agreementSigners.role,
        status: schema.agreementSigners.status,
        signedAt: schema.agreementSigners.signedAt,
        channel: schema.agreementSigners.channel,
    })
        .from(schema.agreementSigners)
        .where(eq(schema.agreementSigners.requestId, envelopeId))
        .orderBy(asc(schema.agreementSigners.createdAt))
        .all();
    return { reqRow, agreement, auditRows, verify, pubKey, tenantSlug, signers };
}

/**
 * #120 — public report-version verifier loader. Token = report_versions.
 * verification_token. No PII beyond the masked property address is exposed.
 */
export async function loadReportVerifyData(c: Context<HonoConfig>, token: string) {
    const verify = await c.var.services.reportVersion.verifyByToken(token);
    if (!verify) return null;
    const db = drizzle(c.env.DB, { schema });
    const ins = await db.select({
        propertyAddress: schema.inspections.propertyAddress,
        reportStatus: schema.inspections.reportStatus,
    })
        .from(schema.inspections)
        .where(eq(schema.inspections.id, verify.inspectionId))
        .get();
    // Mask the address to a coarse form (no unit/number) for a public endpoint.
    const masked = (ins?.propertyAddress ?? '').replace(/^\S+\s/, '••• ');
    return { verify, propertyAddressMasked: masked, notPublished: !isReportPublished(ins?.reportStatus) };
}
