/**
 * Build the acceptance rows that ride the SAME write as the account.
 *
 * ── Why this returns statements instead of writing them ─────────────────────
 * Counsel round 24, ruling 24D. The original design enqueued the acceptance
 * atomically with the account insert and let the ledger become consistent
 * afterwards; it came back `FAIL-CLOSED NOT SATISFIED`. Their distinction: an
 * outbox proves *acceptance evidence was durably captured*, but it cannot prove
 * *acceptance was recorded in the acceptance ledger before account creation* —
 * and while the event is unconsumed the state is `account = EXISTS,
 * acceptance_ledger = ABSENT`, which violates A2 whatever the envelope holds.
 *
 * So this function does not own a transaction and cannot start one. It hands back
 * statements for the caller to place in the `db.batch()` that also inserts the
 * `users` row — D1's only atomic primitive. If the account write rolls back, so
 * does the acceptance, because they are the same write. A version of this that
 * executed its own insert would be correct-looking and would reintroduce exactly
 * the window counsel refused.
 *
 * ── Fail closed, and fail HERE ──────────────────────────────────────────────
 * Every refusal below happens before any statement is produced, so a caller
 * cannot half-build a batch. An account with no acceptance is the state this
 * exists to make unreachable; an acceptance with no version or no content hash
 * is worse than none, because it points at nothing checkable while reading as
 * evidence.
 */

import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { accountAcceptances } from '../../lib/db/schema';
import { AUTHORITY_BASES, type AuthorityBasis } from '../../lib/auth/authority-basis';

/** One document the person accepted. Mirrors the portal's block, field for field. */
export interface AcceptedDocument {
    doc: string;
    version: string;
    contentHash: string;
    /** Epoch ms — when the HUMAN accepted, never when this row is built. */
    acceptedAt: number;
}

export interface AcceptanceInput {
    tenantId: string;
    userId: string;
    /** The portal identity the acceptance was captured against, when it was. */
    actorIdentityRef?: string | undefined;
    authorityBasis: AuthorityBasis;
    documents: readonly AcceptedDocument[];
}

const HASH64 = /^[0-9a-f]{64}$/;

/**
 * Statements to insert this account's acceptance rows, or a throw.
 *
 * Returns an array because a person accepts several documents as separate facts
 * with separate versions — see the schema note on why that is not one row with a
 * list. The caller spreads them into its own batch.
 */
export function buildAcceptanceStatement(
    db: DrizzleD1Database<Record<string, unknown>>,
    input: AcceptanceInput,
) {
    if (!input.tenantId) throw new Error('acceptance requires a tenant');
    if (!input.userId) throw new Error('acceptance requires the user it is committed with');

    if (!AUTHORITY_BASES.includes(input.authorityBasis)) {
        // A basis this side cannot hold is refused at the boundary rather than
        // stored and discovered later. The two repositories duplicate this list
        // because they cannot import from each other, so drift is possible and
        // this is where it surfaces.
        throw new Error(
            `unknown authority basis '${input.authorityBasis}' — the seam's vocabulary has drifted`,
        );
    }

    if (input.documents.length === 0) {
        // Not a silent no-op. A caller reaching here believes it is recording an
        // acceptance; handing back an empty batch would let the account be
        // created with nothing beside it and look successful.
        throw new Error('acceptance carries no documents — refusing to create an account without one');
    }

    const now = new Date();
    return input.documents.map((d) => {
        if (!d.doc) throw new Error('acceptance document has no name');
        if (!d.version) throw new Error(`acceptance for '${d.doc}' carries no version`);
        if (!HASH64.test(d.contentHash ?? '')) {
            // An acceptance without a hash points at nothing checkable. Storing
            // one would create a row that reads as evidence and proves nothing.
            throw new Error(`acceptance for '${d.doc}' carries no usable content hash`);
        }
        if (!Number.isFinite(d.acceptedAt) || d.acceptedAt <= 0) {
            throw new Error(`acceptance for '${d.doc}' carries no acceptance time`);
        }
        return db.insert(accountAcceptances).values({
            id: crypto.randomUUID(),
            tenantId: input.tenantId,
            userId: input.userId,
            ...(input.actorIdentityRef ? { actorIdentityRef: input.actorIdentityRef } : {}),
            doc: d.doc,
            version: d.version,
            contentHash: d.contentHash,
            authorityBasis: input.authorityBasis,
            acceptedAt: new Date(d.acceptedAt),
            createdAt: now,
        });
    });
}
