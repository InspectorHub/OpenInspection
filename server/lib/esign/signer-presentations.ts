import { and, desc, eq, like } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/d1';
import { esignAuditLogs } from '../db/schema';

/** How many of a signer's own presentation rows the signing-intent check reads. */
const INTENT_LOG_WINDOW = 50;

/**
 * The presentation rows the signing-intent check needs for one signer: this signer's, newest first, a fixed number of them.
 *
 * Presentation rows are appended on every view of the signing page, so the full set of an envelope grows with every reload by anyone
 * holding a link; the check needs just one row naming this signer and the content being signed. The signer id in the payload narrows the
 * read in the store (the exact comparison is still made in memory by `signingIntentProblem`), so another signer's reloads can never push
 * this signer's row out of the window.
 */
export async function presentationRowsOf(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: ReturnType<typeof drizzle<any>>,
    envelope: { id: string; tenantId: string },
    signerId: string,
): Promise<Array<{ event: string; payloadJson: string }>> {
    return db
        .select({ event: esignAuditLogs.event, payloadJson: esignAuditLogs.payloadJson })
        .from(esignAuditLogs)
        .where(and(
            eq(esignAuditLogs.tenantId, envelope.tenantId),
            eq(esignAuditLogs.requestId, envelope.id),
            eq(esignAuditLogs.event, 'signer.presented'),
            like(esignAuditLogs.payloadJson, `%${signerId}%`),
        ))
        .orderBy(desc(esignAuditLogs.createdAt))
        .limit(INTENT_LOG_WINDOW)
        .all();
}
