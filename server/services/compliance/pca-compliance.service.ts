// server/services/compliance/pca-compliance.service.ts
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { reportSignoff, psqResponses, documentReviewItems } from '../../lib/db/schema';
import { SigningKeyService, base64UrlEncode, base64UrlDecode } from '../signing-key.service';
import { buildAttestationPayload } from '../../lib/pca-attestation';
import { DOCUMENT_REVIEW_CATALOG } from '../../lib/pca-document-catalog';
import { logger } from '../../lib/logger';

type SignoffRole = 'field_observer' | 'pcr_reviewer';

type SignoffInput = {
    role: SignoffRole;
    personId: string;
    name: string;
    license: string | null;
    qualificationsRef: string | null;
    dualRole: boolean;
};

type DocumentReviewPatch = {
    requested?: boolean;
    received?: boolean;
    reviewed?: boolean;
    na?: boolean;
    notes?: string | null;
};

/**
 * Commercial PCA Phase M — ASTM compliance artifacts. Sign-off reuses the
 * tenant Ed25519 signing key (e-sign infra); each sign-off is a signature over
 * the canonical attestation payload (server/lib/pca-attestation.ts). All
 * reads/writes are tenant-scoped.
 */
export class ComplianceService {
    constructor(private db: D1Database, private encryptionSecret: string) {}

    private get drizzle() { return drizzle(this.db); }

    async getCompliance(tenantId: string, inspectionId: string) {
        const db = this.drizzle;
        const [signoffs, psq, docReview] = await Promise.all([
            db.select().from(reportSignoff)
                .where(and(eq(reportSignoff.tenantId, tenantId), eq(reportSignoff.inspectionId, inspectionId))).all(),
            db.select().from(psqResponses)
                .where(and(eq(psqResponses.tenantId, tenantId), eq(psqResponses.inspectionId, inspectionId))).get(),
            db.select().from(documentReviewItems)
                .where(and(eq(documentReviewItems.tenantId, tenantId), eq(documentReviewItems.inspectionId, inspectionId)))
                .orderBy(documentReviewItems.sortOrder).all(),
        ]);
        return { reportSignoffs: signoffs, psq: psq ?? null, documentReview: docReview };
    }

    async signOff(tenantId: string, inspectionId: string, input: SignoffInput) {
        const signedAtMs = Date.now();
        const payload = buildAttestationPayload({
            inspectionId, role: input.role, personId: input.personId, name: input.name,
            license: input.license, signedAt: signedAtMs,
        });
        const signing = new SigningKeyService(this.db, this.encryptionSecret);
        const { privateKey } = await signing.ensureKeypair(tenantId);
        const sigBytes = new Uint8Array(await crypto.subtle.sign(
            { name: 'Ed25519' }, privateKey, new TextEncoder().encode(payload),
        ));
        const signatureRef = base64UrlEncode(sigBytes);

        const row = {
            id: crypto.randomUUID(), tenantId, inspectionId,
            role: input.role, personId: input.personId, name: input.name,
            license: input.license, qualificationsRef: input.qualificationsRef,
            signedAt: signedAtMs, signatureRef, dualRole: input.dualRole,
        };
        // Upsert on (inspection, role) — re-signing replaces the prior attestation.
        // `signed_at` is `timestamp_ms` mode (Date <-> integer-ms), so the write
        // needs a Date instance even though the payload/return value carry the
        // raw epoch-ms number.
        await this.drizzle.insert(reportSignoff).values({ ...row, signedAt: new Date(signedAtMs) })
            .onConflictDoUpdate({
                target: [reportSignoff.inspectionId, reportSignoff.role],
                set: {
                    id: row.id, personId: row.personId, name: row.name, license: row.license,
                    qualificationsRef: row.qualificationsRef, signedAt: new Date(signedAtMs), signatureRef, dualRole: row.dualRole,
                },
            });
        logger.info('pca.signoff.recorded', { tenantId, inspectionId, role: input.role });
        return row;
    }

    async verifySignoff(tenantId: string, inspectionId: string, role: SignoffRole): Promise<boolean> {
        const row = await this.drizzle.select().from(reportSignoff)
            .where(and(eq(reportSignoff.tenantId, tenantId), eq(reportSignoff.inspectionId, inspectionId), eq(reportSignoff.role, role)))
            .get();
        if (!row) return false;
        const signing = new SigningKeyService(this.db, this.encryptionSecret);
        const pub = await signing.getPublicKey(tenantId);
        if (!pub) return false;
        const payload = buildAttestationPayload({
            inspectionId, role: row.role, personId: row.personId, name: row.name,
            license: row.license ?? null, signedAt: Number(row.signedAt),
        });
        return crypto.subtle.verify(
            { name: 'Ed25519' }, pub.publicKey,
            base64UrlDecode(row.signatureRef) as unknown as ArrayBuffer,
            new TextEncoder().encode(payload),
        );
    }

    async removeSignOff(tenantId: string, inspectionId: string, role: SignoffRole) {
        await this.drizzle.delete(reportSignoff)
            .where(and(eq(reportSignoff.tenantId, tenantId), eq(reportSignoff.inspectionId, inspectionId), eq(reportSignoff.role, role)));
    }

    async seedDocumentReview(tenantId: string, inspectionId: string) {
        const existing = await this.drizzle.select({ k: documentReviewItems.documentKey }).from(documentReviewItems)
            .where(and(eq(documentReviewItems.tenantId, tenantId), eq(documentReviewItems.inspectionId, inspectionId))).all();
        const have = new Set(existing.map((r) => r.k));
        const rows = DOCUMENT_REVIEW_CATALOG.filter((d) => !have.has(d.documentKey)).map((d) => ({
            id: crypto.randomUUID(), tenantId, inspectionId,
            documentKey: d.documentKey, label: d.label,
            requested: false, received: false, reviewed: false, na: false, notes: null, sortOrder: d.sortOrder,
        }));
        if (rows.length) await this.drizzle.insert(documentReviewItems).values(rows);
    }

    async updateDocumentReviewItem(tenantId: string, inspectionId: string, documentKey: string, patch: DocumentReviewPatch) {
        await this.drizzle.update(documentReviewItems).set(patch)
            .where(and(
                eq(documentReviewItems.tenantId, tenantId),
                eq(documentReviewItems.inspectionId, inspectionId),
                eq(documentReviewItems.documentKey, documentKey),
            ));
    }

    async upsertPsq(tenantId: string, inspectionId: string, responses: Record<string, unknown>) {
        // `sent_at`/`received_at`/`updated_at` are `timestamp_ms` mode — write Date instances.
        const now = new Date();
        await this.drizzle.insert(psqResponses)
            .values({ id: crypto.randomUUID(), tenantId, inspectionId, responses, status: 'received', sentAt: null, receivedAt: now, updatedAt: now })
            .onConflictDoUpdate({
                target: [psqResponses.tenantId, psqResponses.inspectionId],
                set: { responses, status: 'received', receivedAt: now, updatedAt: now },
            });
    }

    async setPsqStatus(tenantId: string, inspectionId: string, status: 'sent' | 'received' | 'declined') {
        const now = new Date();
        await this.drizzle.insert(psqResponses)
            .values({ id: crypto.randomUUID(), tenantId, inspectionId, responses: null, status, sentAt: status === 'sent' ? now : null, receivedAt: null, updatedAt: now })
            .onConflictDoUpdate({
                target: [psqResponses.tenantId, psqResponses.inspectionId],
                set: { status, updatedAt: now },
            });
    }
}
