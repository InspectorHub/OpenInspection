import type { Context } from 'hono';
import { Errors } from '../errors';
import { logger } from '../logger';
import { errorSummary } from '../error-summary';
import { runEnvelopeCompletionPipeline } from '../sign-effects';
import type { AgreementService } from '../../services/agreement.service';
import type { agreementRequests, agreementSigners } from '../db/schema';
import type { HonoConfig } from '../../types/hono';

export { errorSummary };

/** Identifiers only. Nothing a person typed or was sent from belongs in these log lines. */
export interface SigningIds { tenantId: string; requestId: string; signerId: string }

/**
 * A signature was claimed but its audit row could not be written: put the claim back and refuse with 503, so the signer retries.
 *
 * `release` reverts only a row that still shows this very claim (see `claimSignedBySigner`). If even that fails, the signer is left
 * showing as signed with no audit row, which is the one state this flow is built to avoid, so it raises an alert (ids only).
 */
export async function refuseUnrecordedSignature(claim: { release: () => Promise<void> }, ids: SigningIds, cause: unknown): Promise<never> {
    try {
        await claim.release();
    } catch (releaseError) {
        logger.alert('signing_claim_not_released', 'A signature was claimed but its audit row failed and the claim could not be put back; the signer shows as signed with no audit row.', { ...ids, error: errorSummary(releaseError) });
    }
    logger.error('audit.append.signer-signed.failed — signing refused', { ...ids, error: errorSummary(cause) });
    throw Errors.ServiceUnavailable('We could not record your signature just now. Please try again.');
}

/** What a signing page or checkout may be told about a signer: a signature still being recorded reads as viewed, never as signed. */
export function publicSignerStatus(status: string): 'pending' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired' {
    return (status === 'signing' ? 'viewed' : status) as 'pending' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired';
}

/**
 * A request for a signer whose signing was already CONFIRMED (the append succeeded). The answer is the same 200 as before, but the
 * envelope is rolled forward first if an earlier attempt died between the confirm and the roll-forward; the completion pipeline runs
 * only if THIS call completed the envelope (the transition is a single conditional update, so a second retry finds nothing to do).
 */
export async function resumeConfirmedSigning(
    c: Context<HonoConfig>,
    svc: Pick<AgreementService, 'resumeConfirmedSigning'>,
    signer: typeof agreementSigners.$inferSelect,
    envelope: typeof agreementRequests.$inferSelect,
): Promise<void> {
    const result = await svc.resumeConfirmedSigning(signer, envelope);
    if (!result?.envelopeCompletedNow) return;
    await runEnvelopeCompletionPipeline(c, {
        requestId: result.requestId, tenantId: result.tenantId, inspectionId: result.inspectionId,
        clientEmail: envelope.clientEmail ?? null, clientName: envelope.clientName ?? null, agreementId: envelope.agreementId,
    });
}
