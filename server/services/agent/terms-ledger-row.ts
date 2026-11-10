import type { agentTermsAcceptances } from '../../lib/db/schema/compliance';

/**
 * The one shape of an `agent_terms_acceptances` row.
 *
 * Both doors write it: `recordAgentTermsAcceptance` (`./terms-acceptance.ts`), for an account that
 * already exists, and `signup` (`./signup.ts`), which inserts it in the same
 * `db.batch()` as the new `users` row. One builder, so the two cannot drift on
 * which fields are evidence.
 */
export function agentTermsLedgerRow(input: {
    userId: string;
    version: string;
    contentHash: string;
    acceptedAt: Date;
    ip?: string | undefined;
    country?: string | undefined;
}): typeof agentTermsAcceptances.$inferInsert {
    return {
        id: crypto.randomUUID(),
        userId: input.userId,
        doc: 'agent_terms',
        version: input.version,
        contentHash: input.contentHash,
        acceptedAt: input.acceptedAt,
        ip: input.ip ?? null,
        country: input.country ?? null,
    };
}

