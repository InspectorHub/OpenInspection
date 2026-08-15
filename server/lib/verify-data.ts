import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc } from 'drizzle-orm';
import type { Context } from 'hono';
import * as schema from './db/schema';
import type { HonoConfig } from '../types/hono';
import { isReportPublished } from './status/report-status';
import { resolveTenantSlug } from './url';

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
    // The key(s) THIS chain was sealed with, not the tenant's current one. An
    // offline verifier is handed these to check the export by itself, so handing
    // it a rotated-to key would make it conclude the evidence is bad when the
    // evidence is fine. Ordinarily one key; a chain that spans a rotation has
    // two, and both have to travel with the export or half of it cannot be read.
    const chainFingerprints = [...new Set(auditRows.map((r) => r.keyFingerprint))];
    const chainKeys = (await Promise.all(chainFingerprints.map((fp) =>
        c.var.services.signingKey.getPublicKeyByFingerprint(reqRow.tenantId, fp),
    ))).filter((k): k is NonNullable<typeof k> => k !== null);
    // Falls back to the active key only when the envelope has no audit rows to
    // name a key — a chain with rows always answers for itself.
    const pubKey = chainKeys[0] ?? await c.var.services.signingKey.getPublicKey(reqRow.tenantId);
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
        // Not exposed per-signer by the verifier — it decides ONE thing with it:
        // whether the page may print the current language disclosure at all.
        languageDisclosureVersion: schema.agreementSigners.languageDisclosureVersion,
    })
        .from(schema.agreementSigners)
        .where(eq(schema.agreementSigners.requestId, envelopeId))
        .orderBy(asc(schema.agreementSigners.createdAt))
        .all();
    // One PEM holding every key this chain used — a PEM file legitimately holds
    // several blocks. Assembled here rather than at the route so the endpoint
    // cannot accidentally ship only the first one and leave an offline verifier
    // unable to check rows it is entitled to check.
    const pubKeyPem = (chainKeys.length > 0 ? chainKeys.map((k) => k.pem) : [pubKey?.pem ?? '']).join('');
    return { reqRow, agreement, auditRows, verify, pubKey, chainKeys, pubKeyPem, tenantSlug, signers };
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
        tenantId: schema.inspections.tenantId,
    })
        .from(schema.inspections)
        .where(eq(schema.inspections.id, verify.inspectionId))
        .get();
    // Mask the address to a coarse form (no unit/number) for a public endpoint.
    const masked = (ins?.propertyAddress ?? '').replace(/^\S+\s/, '••• ');
    // #270 — the verifier page has no viewer to hold a display preference, so it
    // renders the published-on date in the TENANT's shape. The slug is what the
    // page needs to reach the public brand; it is already the public identifier
    // for a company (/book/:tenant), so this exposes nothing the reader of a
    // report verification link does not already know.
    const tenantSlug = ins?.tenantId ? await resolveTenantSlug(c, ins.tenantId) : '';
    return {
        verify,
        propertyAddressMasked: masked,
        notPublished: !isReportPublished(ins?.reportStatus),
        tenantSlug,
    };
}
