import type { AgreementService } from '../../../server/services/agreement.service';

type SignedOpts = Parameters<AgreementService['claimSignedBySigner']>[2];

/**
 * What a signing does to the state, without the audit append between the steps: claim, confirm, then roll the envelope forward.
 * A request that finds the signer already signed changes nothing and reports no completion.
 */
export async function signViaClaim(svc: AgreementService, presented: string, signatureBase64: string, opts: SignedOpts) {
    const claim = await svc.claimSignedBySigner(presented, signatureBase64, opts);
    if (claim.kind === 'already_signed') {
        return {
            tenantId: claim.envelope.tenantId, inspectionId: claim.envelope.inspectionId, requestId: claim.envelope.id,
            signerId: claim.signer.id, envelopeCompletedNow: false, envelopeStatus: claim.envelope.status,
        };
    }
    await claim.confirm();
    return svc.finishSignedBySigner(claim.signer, claim.envelope, opts.signedAtMs);
}
