import type { BrandingService } from '../services/branding.service';

/**
 * Side effects an agreement-template write had on state the caller did not name.
 *
 * #84. A workspace confirms, once, that a SPECIFIC agreement template contains a
 * cancellation clause; `BrandingService.updateBranding` then refuses any
 * fee-charging cancellation policy while that confirmation is not live. Editing
 * that template bumps `agreements.version` and deleting it removes the row, and
 * either one makes `getCancellationAttestation()` return null — so a write
 * addressed to `/agreements/{id}` silently turns fee charging off.
 *
 * The response has to say so, because the UI is not the only caller. Both routes
 * are MCP tools (`updateTenantAgreement`, `deleteTenantAgreement`, `admin` scope
 * / `extended` tier) and the tool is not a second handler: the Durable Object
 * rebuilds the HTTP request, dispatches it into the same in-process API, and
 * hands the response body to the model verbatim. One signal in the response
 * reaches every caller; two hand-written warnings in two UIs drift apart.
 */
export interface AgreementWriteEffects {
    /**
     * This write invalidated the workspace's cancellation-fee attestation, so
     * fee-charging cancellation policies are refused until it is confirmed
     * again (Settings → Online Booking → Cancellation policy).
     *
     * ALWAYS PRESENT, including when false. An omitted field and a field the
     * route never learned to set are the same bytes on the wire, and neither a
     * caller nor a gate can tell them apart.
     */
    cancellationFeeAttestationRevoked: boolean;
}

/**
 * Run an agreement-template write and report what it revoked.
 *
 * ⚠️ MEASURED, NOT DERIVED. The obvious implementation — "did this id match
 * `cancellation_clause_agreement_id`?" — is a third copy of an invalidation rule
 * that already exists exactly once, inside `getCancellationAttestation()`, and a
 * copy is what eventually disagrees with the gate that does the refusing. This
 * reads that one function on both sides of the write and reports the transition,
 * so it stays correct for revocation causes nobody has thought of yet.
 *
 * The post-write read is skipped when there was no live attestation to begin
 * with: a revocation needs something to revoke, so `before === null` already
 * decides the answer.
 */
export async function withAgreementWriteEffects<T>(
    branding: Pick<BrandingService, 'getCancellationAttestation'>,
    tenantId: string,
    write: () => Promise<T>,
): Promise<{ result: T; effects: AgreementWriteEffects }> {
    const before = await branding.getCancellationAttestation(tenantId);
    const result = await write();
    const after = before === null ? null : await branding.getCancellationAttestation(tenantId);
    return {
        result,
        effects: { cancellationFeeAttestationRevoked: before !== null && after === null },
    };
}
