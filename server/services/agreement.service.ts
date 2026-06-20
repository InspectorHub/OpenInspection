import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import * as schema from '../lib/db/schema';
import { AgreementServiceBase } from './agreement/base';
import { SignerStateMixin } from './agreement/signer-state';
import { EnvelopeLegacyMixin } from './agreement/envelope-legacy';
import { TemplateMixin } from './agreement/template';

export { computeEnvelopeStatus } from './agreement/base';
export type { SignerInput, ResolvedSigner } from './agreement/base';

/**
 * Service to manage tenant-specific agreement templates (signatures, terms).
 *
 * Composed from focused mixins (see server/services/agreement/):
 *   - SignerStateMixin     — Track I-a signer-level state machine (innermost; holds
 *                            the atomic envelope-completion + token-upgrade unit).
 *   - EnvelopeLegacyMixin  — legacy signing requests + Spec 2A envelope state machine.
 *   - TemplateMixin        — agreement-template CRUD.
 * The public surface (class name, constructor injection, and every method) is
 * identical to the pre-split single-file service.
 */
export class AgreementService extends TemplateMixin(EnvelopeLegacyMixin(SignerStateMixin(AgreementServiceBase))) {}

/**
 * Spec 5H D1 — Inspector pre-sign.
 *
 * Writes the inspector's signature, userId, and timestamp onto the
 * agreement request row while it is still in 'pending' status (before
 * it is sent to the client). Tenant-scoped; throws if the envelope is
 * not found, belongs to a different tenant, or is not in 'pending' status.
 */
export async function applyInspectorPreSign(
    d1: D1Database,
    tenantId: string,
    envelopeId: string,
    inspectorUserId: string,
    signatureBase64: string,
): Promise<void> {
    const db = drizzle(d1, { schema });
    const row = await db.select().from(schema.agreementRequests)
        .where(and(
            eq(schema.agreementRequests.id, envelopeId),
            eq(schema.agreementRequests.tenantId, tenantId),
        )).get();
    if (!row) throw new Error('agreement request not found');
    if (row.status !== 'pending') {
        throw new Error('can only pre-sign while status is pending');
    }
    await db.update(schema.agreementRequests)
        .set({
            inspectorSignatureBase64: signatureBase64,
            inspectorSignedAt: new Date(),
            inspectorUserId,
        })
        .where(eq(schema.agreementRequests.id, envelopeId));
}
