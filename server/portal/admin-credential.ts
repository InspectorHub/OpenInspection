import { drizzle } from 'drizzle-orm/d1';
import { eq, and, lt } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { users, tenants } from '../lib/db/schema';
import { deriveAuthorityBasis } from '../lib/auth/authority-basis';
import { buildAcceptanceStatement, type CapturedAcceptance } from '../services/legal/account-acceptance';

/**
 * @declarationEmit Exported so the emitted `.d.ts` can NAME it: it is the
 * parameter type of both exported functions below, and nothing imports it.
 */
export interface AdminCredentialParams {
    tenantId: string;
    adminEmail: string;
    adminPasswordHash: string;
    /**
     * The acceptance the PORTAL captured, mirroring the block on the wire
     * (`cmdTenantUpdateDataSchema.acceptance`) field for field.
     *
     * REQUIRED when this call would CREATE the account; ignored when it rotates
     * a credential on one that already exists. See the asymmetry note below.
     * Typed as the shared `CapturedAcceptance` rather than the zod inferred
     * type so this module does not depend on the envelope's parsing layer — the
     * same block arrives through `PortalProvider.handleTenantUpdate` on the RPC
     * path, which never sees an envelope.
     */
    acceptance?: CapturedAcceptance | undefined;
}

/** Admin-credential upsert — extracted verbatim from PortalProvider.handleTenantUpdate
 *  so the cmd consumer can salvage credentials off a stale command without
 *  re-applying its superseded tenant fields (A-21 review fix). Email-keyed
 *  idempotent upsert; safe to apply out of sequence order.
 *
 * ── The account and its acceptance are ONE write ────────────────────────────
 * review A2's invariant, enforced the way review review decision requires
 * rather than the obvious way. Enqueuing the acceptance atomically with the
 * account insert and letting the portal ledger catch up came back
 * `FAIL-CLOSED NOT SATISFIED`: an outbox proves *acceptance evidence was
 * durably captured*, not *acceptance was recorded in the acceptance ledger
 * before account creation*, and while the event sits unconsumed the state is
 * `account = EXISTS, acceptance_ledger = ABSENT`. So the `users` row and its
 * acceptance rows go into one `db.batch()` — D1's only atomic primitive — and
 * there is no sequential fallback for drivers that lack `batch`. A fallback
 * loop (the idiom in `lib/db/assignment-links.ts`, correct for its own
 * purposes) would silently reopen exactly the window that was refused.
 *
 * ── The asymmetry between the branches is the design ────────────────────────
 * INSERT creates an account, so it owes an acceptance and REFUSES without one.
 * UPDATE rotates a credential on an account that already exists — it creates
 * nothing, and demanding an acceptance there would refuse a password change for
 * somebody who accepted years ago.
 *
 * ── Why the refusal is loud rather than a park ──────────────────────────────
 * A credential-bearing command that would create an account with no acceptance
 * is not a message we cannot understand; it is one we understand and must not
 * obey. Throwing exhausts the queue retries and surfaces it as a `failed` row
 * against the tenant that is stuck, where somebody is still looking. Parking it
 * would file it under "shape we do not recognise", which is a different and
 * false diagnosis.
 */
export async function applyAdminCredential(
    dbBinding: D1Database,
    p: AdminCredentialParams,
): Promise<void> {
    const db = drizzle(dbBinding);
    const existingUser = await db.select()
        .from(users)
        .where(eq(users.email, p.adminEmail))
        .get();
    if (!existingUser) {
        if (!p.acceptance) {
            throw new Error(
                `refusing to create an account for ${p.adminEmail}: the command carries no `
                + 'acceptance, and an account with no acceptance is the state this path exists '
                + 'to make unreachable (review A2 / review decision)',
            );
        }
        const userId = crypto.randomUUID();
        // The portal determined the basis at the door the person actually used;
        // re-deriving it here would be a second writer for a fact the other side
        // owns, and the two would disagree the first time either door changed.
        const authorityBasis = deriveAuthorityBasis({
            path: 'portal_command',
            declared: p.acceptance.authorityBasis,
        });
        // Built BEFORE the batch is assembled, and it throws rather than
        // returning a partial list — so a document the ledger cannot hold
        // refuses while there is still no account, not after one exists.
        const acceptanceStatements = buildAcceptanceStatement(db, {
            tenantId: p.tenantId,
            userId,
            ...(p.acceptance.actorIdentityRef ? { actorIdentityRef: p.acceptance.actorIdentityRef } : {}),
            authorityBasis,
            documents: p.acceptance.documents,
        });
        const statements = [
            db.insert(users).values({
                id: userId,
                tenantId: p.tenantId,
                email: p.adminEmail,
                passwordHash: p.adminPasswordHash,
                role: 'owner',
                createdAt: new Date(),
            }),
            ...acceptanceStatements,
        ];
        // The cast is to Drizzle's non-empty-tuple batch signature. The array is
        // provably non-empty (the user insert is element 0, and
        // buildAcceptanceStatement threw above rather than return zero
        // statements), which the compiler cannot see through the spread.
        await db.batch(statements as unknown as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
    } else {
        await db.update(users)
            .set({
                passwordHash: p.adminPasswordHash,
                tenantId: p.tenantId, // Ensure it's correctly linked
            })
            .where(eq(users.id, existingUser.id));
    }
}

/** A-21 batch 2 — apply the credential iff it is fresh on the CREDENTIAL
 *  stream (`tenants.applied_cred_seq`). Credentials ride `cmd.tenant.update`
 *  sparsely, so the shared tenantseq can't order them; this independent
 *  sequence closes the batch-1 residual (a stale credential overwriting a
 *  newer one). `credseq` undefined = legacy in-flight command → apply
 *  unguarded (today's behavior), do NOT advance the high-water mark.
 *
 *  The acceptance is threaded straight through. A STALE command can still be
 *  the one that creates the account — the salvage path exists precisely because
 *  a newer, higher-seq command did not carry the credential — so dropping the
 *  acceptance here would leave the one branch that creates accounts unable to
 *  satisfy the invariant, and it would refuse instead. */
export async function applyCredentialIfFresh(
    dbBinding: D1Database,
    p: AdminCredentialParams & { credseq?: number },
): Promise<'credential-applied' | 'credential-stale'> {
    const db = drizzle(dbBinding);
    if (p.credseq !== undefined) {
        const row = await db.select({ applied: tenants.appliedCredSeq })
            .from(tenants).where(eq(tenants.id, p.tenantId)).get();
        if (row && p.credseq <= row.applied) return 'credential-stale';
    }
    await applyAdminCredential(dbBinding, {
        tenantId: p.tenantId,
        adminEmail: p.adminEmail,
        adminPasswordHash: p.adminPasswordHash,
        ...(p.acceptance !== undefined && { acceptance: p.acceptance }),
    });
    if (p.credseq !== undefined) {
        await db.update(tenants)
            .set({ appliedCredSeq: p.credseq })
            .where(and(eq(tenants.id, p.tenantId), lt(tenants.appliedCredSeq, p.credseq)));
    }
    return 'credential-applied';
}
