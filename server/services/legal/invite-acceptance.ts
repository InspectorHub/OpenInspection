/**
 * The acceptance an INVITED member owes, resolved from the tenant's own
 * published documents.
 *
 * `joinTeam` is the engine-native door - nobody else captured this acceptance -
 * so unlike the portal-originated path there is no block travelling with a
 * command. The documents are whatever the TENANT currently has in force, which
 * is what the person is actually shown, and the versions and hashes come from
 * `tenant_legal_versions` rather than being composed here: a hash this module
 * invented would point at text nobody can produce.
 *
 * Like `buildAcceptanceStatement`, this returns STATEMENTS and executes
 * nothing. Counsel round 24 ruling 24D: the acceptance rows go into the same
 * `db.batch()` as the `users` row, because an acceptance that lands afterwards
 * leaves the state `account = EXISTS, acceptance_ledger = ABSENT` in between,
 * however briefly and whatever the intent.
 */

import { eq } from 'drizzle-orm';
import { logger } from '../../lib/logger';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { accountAcceptances } from '../../lib/db/schema';
import { deriveAuthorityBasis } from '../../lib/auth/authority-basis';
import type { UserSyncAcceptance } from '../../lib/integration/user-sync';
import { LegalVersionService, type LegalDoc } from '../legal-version.service';
import { buildAcceptanceStatement } from './account-acceptance';

/**
 * What an invited member must accept before an account exists for them.
 *
 * Both, not either. A member who accepted one of the two has a record that
 * READS as complete - a row per document, all of them present - while the other
 * document was never put to them at all. Naming the set here, once, is what
 * makes "the ledger is complete" a checkable claim instead of a coincidence of
 * whichever documents the tenant happened to publish.
 */
export const INVITE_REQUIRED_DOCS: readonly LegalDoc[] = ['terms', 'privacy'];

/**
 * Statements recording this member's acceptance, plus the block that travels
 * outward - or a throw.
 *
 * Throws when the tenant has published no current version of a required
 * document. That refusal is deliberate and it is visible to the person trying
 * to accept the invite, which is the point: the alternative is an account whose
 * acceptance ledger is empty, and an empty ledger is indistinguishable from one
 * nobody ever wrote to.
 *
 * `statements` is EMPTY only in the one case where empty is honest - a
 * reactivated member whose acceptance of these exact versions is already on
 * record. The unique index is `(user, doc, version)` precisely so a second row
 * cannot read as the person having accepted twice, so re-recording would either
 * fail the join or forge a second event.
 *
 * `acceptance` is NOT the same list. It describes what this member has accepted
 * once the batch lands - every required document, each carrying the timestamp
 * ACTUALLY on record for it, which for a skipped document is the original
 * acceptance and not this attempt. A block reporting today's date for a
 * document accepted last year would be the plumbing overwriting the legal fact,
 * which is what `accepted_at` exists separately from `created_at` to prevent.
 */
export async function buildInviteAcceptanceStatements<TSchema extends Record<string, unknown>>(
    db: DrizzleD1Database<TSchema>,
    input: { tenantId: string; userId: string; acceptedAt?: number },
): Promise<{
    statements: ReturnType<typeof buildAcceptanceStatement>;
    /** Absent when the workspace has published nothing to accept — see the gap
     *  note below. The caller must treat that as "no block to send outward",
     *  not as "an empty block". */
    acceptance?: UserSyncAcceptance | undefined;
}> {
    const legal = new LegalVersionService(db as never);
    const inForce = await Promise.all(
        INVITE_REQUIRED_DOCS.map(async (doc) => ({ doc, row: await legal.latest(input.tenantId, doc) })),
    );

    const missing = inForce.filter((d) => !d.row).map((d) => d.doc);
    if (missing.length > 0) {
        // ⚠️ ABSENCE IS NOT A REFUSAL HERE — the same known gap `/setup` carries,
        // and for the same reason. This used to throw, which was the stricter
        // reading of A2 and also a product regression with teeth: a workspace's
        // `tenant_legal_versions` rows appear only once an admin saves Privacy or
        // Terms in Settings, so a brand-new deployment could not invite ANYBODY.
        // The e2e caught it (API-10, join returning 500) and it was right to.
        //
        // Refusing when no document exists is a gate that can only ever say no.
        // It does not protect the invited member — it stops them having an account
        // at all — and it is inconsistent with the very same situation on the
        // `/setup` door, which records when it can and says plainly when it
        // cannot. Two rules for one predicament is worse than either rule.
        //
        // What closes the gap is a DOCUMENT, not a stricter check: publishing the
        // built-in Privacy/Terms at tenant creation so there is something to
        // accept. That is blocked today because the built-in text lives as JSX in
        // `app/routes/public/legal.tsx` rather than as a body that can be hashed
        // and snapshotted — a version whose `content_hash` is the hash of nothing
        // would be evidence in name only.
        // Warn and CONTINUE with whatever IS published. Returning empty here was
        // the first fix and it was still wrong in the same direction: with Privacy
        // published and Terms not, it dropped the Privacy acceptance too — losing
        // evidence that existed, to protest evidence that did not. Its own spec
        // caught it.
        logger.warn('[invite-acceptance] some documents are not published; recording the rest', {
            tenantId: input.tenantId, missing,
        });
    }
    const publishable = inForce.filter((d) => d.row);
    if (publishable.length === 0) return { statements: [] };

    // Which of these versions this user is already on record for, and WHEN they
    // accepted them. Only ever non-empty for a REACTIVATED row: a freshly
    // minted user id can have no acceptance history, and reading it costs one
    // query on a path that already does several.
    const already = new Map(
        (await db.select({
            doc: accountAcceptances.doc,
            version: accountAcceptances.version,
            acceptedAt: accountAcceptances.acceptedAt,
        })
            .from(accountAcceptances)
            .where(eq(accountAcceptances.userId, input.userId))
            .all())
            .map((r) => [`${r.doc} ${r.version}`, r.acceptedAt?.getTime() ?? 0] as const),
    );

    const acceptedAt = input.acceptedAt ?? Date.now();
    // The door decides, not the invited role. An invited ADMIN also only
    // acknowledges - operational access is not signing authority.
    const authorityBasis = deriveAuthorityBasis({ path: 'invite' });
    type Doc = { doc: string; version: string; contentHash: string; acceptedAt: number };
    const fresh: Doc[] = [];
    const onRecord: Doc[] = [];

    // `publishable`, not `inForce` — the non-null assertions below are only safe
    // on the filtered set, and iterating the full required list is what made the
    // partial case throw instead of recording the half that exists.
    for (const d of publishable) {
        const priorAcceptedAt = already.get(`${d.doc} ${d.row!.version}`);
        const entry: Doc = {
            doc: d.doc,
            version: d.row!.version,
            contentHash: d.row!.contentHash,
            acceptedAt: priorAcceptedAt ?? acceptedAt,
        };
        onRecord.push(entry);
        if (priorAcceptedAt === undefined) fresh.push(entry);
    }

    return {
        statements: fresh.length === 0 ? [] : buildAcceptanceStatement(db, {
            tenantId: input.tenantId,
            userId: input.userId,
            authorityBasis,
            documents: fresh,
        }),
        acceptance: { authorityBasis, documents: onRecord },
    };
}
