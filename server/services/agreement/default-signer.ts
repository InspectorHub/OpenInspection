import type { agreementRequests, agreementSigners } from '../../lib/db/schema';

/** The id of the one default signer of a legacy envelope that has no signer rows: fixed, so it can be created only once. */
export function defaultSignerId(envelopeId: string): string {
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
