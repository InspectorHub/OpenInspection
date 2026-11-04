import { and, eq } from 'drizzle-orm';
import { agreementSigners, type agreementRequests } from '../../lib/db/schema';
import type { AgreementServiceBase } from './base';

/** The id of the one default signer of a legacy envelope that has no signer rows: fixed, so it can be created only once. */
function defaultSignerId(envelopeId: string): string {
    return `${envelopeId}:default`;
}

/** The default signer of a finished legacy envelope as a value only; nothing is written for it. */
export function defaultSignerView(envelope: typeof agreementRequests.$inferSelect): typeof agreementSigners.$inferSelect {
    return {
        id: defaultSignerId(envelope.id), tenantId: envelope.tenantId, requestId: envelope.id,
        name: envelope.clientName || envelope.clientEmail || 'Client', email: envelope.clientEmail || '', role: 'client',
        contactId: null, tokenHash: null, tokenEnc: null, status: envelope.status, signatureBase64: null,
        signedAt: envelope.signedAt ?? null, viewedAt: null, ipAddress: null, userAgent: null, channel: null, onBehalfOf: null,
        onBehalfDisclaimer: null, lastRemindedAt: null, createdAt: envelope.createdAt, expiresAt: null, revokedAt: null,
        languageDisclosureVersion: null, attributionBasis: null, attributionSource: null, attributedAt: null,
    };
}

/**
 * Inserts the one default client signer of a legacy envelope that has none (created before signer links) and returns it. The signer
 * mirrors the envelope's client and status and carries no link token; the id is fixed per envelope and the insert ignores a conflict, so
 * two requests opening the same signer-less envelope together end with one and the same signer.
 */
export async function insertDefaultSigner(
    db: ReturnType<AgreementServiceBase['getDrizzle']>,
    envelope: typeof agreementRequests.$inferSelect,
): Promise<typeof agreementSigners.$inferSelect> {
    const id = defaultSignerId(envelope.id);
    await db.insert(agreementSigners).values({
        id, tenantId: envelope.tenantId, requestId: envelope.id,
        name: envelope.clientName || envelope.clientEmail || 'Client', email: envelope.clientEmail || '', role: 'client',
        tokenHash: null, tokenEnc: null, status: envelope.status, createdAt: new Date(),
    }).onConflictDoNothing();
    return (await db.select().from(agreementSigners).where(and(eq(agreementSigners.id, id), eq(agreementSigners.tenantId, envelope.tenantId))).limit(1))[0]!;
}
