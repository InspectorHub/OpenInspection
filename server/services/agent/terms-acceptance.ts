/**
 * Whether a signed-in agent has accepted the agent terms in force, and how one
 * accepts them after the account already exists.
 *
 * Signup answers the same question at the moment an account is born
 * (`server/services/agent/signup.ts` refuses to insert a `users` row without an
 * acceptance). This module answers it for every request afterwards, because
 * signup is only one of the three doors into an agent session: password login
 * and the emailed magic link both mint a 24-hour cookie for an account that
 * already exists, and neither of them passes through a signup screen. An account
 * created before this rule existed reaches the product through those two doors
 * with no acceptance at all, which is the hole this closes.
 *
 * ── Where the acceptance lives: a ledger, and a projection of it ────────────
 * `agent_terms_acceptances` is the evidence of record — append-only, one row per
 * acceptance, tenant-less for the same reason `deployment_legal_versions` is.
 * (The general ledger next door, `account_acceptances`, cannot hold these: its
 * `tenant_id` is NOT NULL and an agent is global, so a row there would need a
 * tenant id invented for the occasion — a guess that later reads as a fact.)
 *
 * `users.terms_accepted` — the same JSON blob signup writes — stays, demoted to
 * a PROJECTION of the newest row. It is what the request-path gate reads, and a
 * gate that runs on every agent request should not run a join. It holds ONE
 * acceptance by construction, which is fine for the question it answers ("is
 * this agent bound by the text in force") and was never enough for the other one
 * ("what did this agent accept, and when") — that one is `agentTermsHistory`.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { users } from '../../lib/db/schema/tenant';
import { agentTermsAcceptances, deploymentLegalVersions } from '../../lib/db/schema/compliance';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { DeploymentLegalService } from '../deployment-legal.service';

type Db = DrizzleD1Database<Record<string, unknown>>;

/**
 * The live-global-agent predicate, in the same shape
 * `server/services/agent/account.ts` uses for lookups by email and by id:
 * tenant-less, role agent, not soft-deleted.
 *
 * Spelled out rather than keyed on the id alone. Both statements below run
 * against `users`, a table that also holds every staff account, and an id-only
 * WHERE is the shape that writes to the wrong kind of row the day an id arrives
 * from somewhere less careful than the JWT middleware.
 */
const liveGlobalAgent = (userId: string) => and(
    eq(users.id, userId),
    eq(users.role, 'agent'),
    isNull(users.tenantId),
    isNull(users.deletedAt),
);

/**
 * What this module can say about a signed-in agent — as distinct facts, not as
 * one boolean with a footnote.
 *
 * This used to be `{ satisfied: boolean, reason }`, and the comment that stood
 * here said "`no_document` is a SATISFIED reason". That spelling made two
 * unrelated facts indistinguishable to anyone who read the boolean:
 *
 *   NOT_IN_FORCE  this deployment has published no agent terms, so there is no
 *                 contract to be bound by and none applies to anyone
 *   ACCEPTED      there is a contract in force and this agent has accepted it
 *
 * Both PASS — see `agentTermsStatus` for why the first one must, which is the
 * load-bearing decision in this file, and which is UNCHANGED. What changed is
 * only what they are CALLED: a caller can no longer write `if (status.satisfied)`
 * and, without noticing, treat "there is no contract" as "the contract is
 * signed". Those are the two sentences an operator, an auditor and a log reader
 * all need told apart, and a boolean tells them apart to nobody.
 *
 * The other two are refusals, and they are also not each other:
 *
 *   REQUIRED      a document IS in force and this agent is not bound by it.
 *                 `requirement` says which way — see below.
 *   UNREADABLE    the registry did not answer. Deliberately NOT folded into
 *                 NOT_IN_FORCE: "the registry says there is nothing" and "the
 *                 registry said nothing at all" are different observations, and
 *                 only the second one is an outage. Fails closed.
 */
type AgentTermsState =
    | 'NOT_IN_FORCE'
    | 'ACCEPTED'
    | 'REQUIRED'
    | 'UNREADABLE';

/** Which way an agent falls short of a document that IS in force. */
type AgentTermsRequirement =
    /** The account has never recorded an acceptance of anything. */
    | 'never_accepted'
    /** It accepted words that are no longer the words in force. */
    | 'superseded';

interface AgentTermsVersions {
    /** The version the account holds an acceptance of, or null. */
    acceptedVersion: string | null;
    /** The version in force, or null when the deployment has published none. */
    requiredVersion: string | null;
    /** SHA-256 hex of the body in force, or null. */
    requiredContentHash: string | null;
}

/**
 * A discriminated union rather than a struct with optional fields, because that
 * is what makes the distinction hold at the TYPE level rather than by
 * convention: `requirement` exists only on `REQUIRED`, so the compiler refuses
 * to read "which way did they fall short" in a branch where the question has no
 * answer — and a caller that wants to pass traffic has to name the states it is
 * passing.
 */
type Branch<S extends AgentTermsState, Extra = unknown> = AgentTermsVersions & { state: S } & Extra;

export type AgentTermsStatus =
    | Branch<'NOT_IN_FORCE'>
    | Branch<'ACCEPTED'>
    | Branch<'REQUIRED', { requirement: AgentTermsRequirement }>
    | Branch<'UNREADABLE'>;

/**
 * Does this agent hold an acceptance of the agent terms in force?
 *
 * ── Comparison is on the CONTENT HASH, not the version string ────────────────
 * The version is what a reader is shown; the hash is what they agreed to. The
 * publish path already refuses to change a published version's body, so in
 * practice the two move together — but the hash is the one that cannot be made
 * to lie, so it is the one compared.
 *
 * ── Staleness counts, and this is the decision ───────────────────────────────
 * A superseded acceptance fails, not just a missing one. Signup already refuses
 * a form whose rendered text is no longer in force, so the rule "an acceptance
 * must name the text in force" is already this deployment's position for new
 * accounts; applying it only to new accounts would leave the two paths
 * disagreeing about the same document, and would make the version and hash on
 * the record decorative — written at signup, read by nobody, describing whatever
 * the document happened to say that day.
 *
 * A superseded agent is GATED, not locked out and not signed out: their session
 * stays valid, the refusal names the page that fixes it, and one screen later
 * they are back where they were asking. Publishing is a rare, deliberate operator
 * act, and republishing identical words returns the existing version rather than
 * minting a new one, so a no-op publish gates nobody.
 *
 * ── Nothing published is NOT a refusal, and that is deliberate ───────────────
 * When the deployment has published no agent terms at all there is no text to
 * accept, and refusing would be refusing on behalf of a document that does not
 * exist — the mirror image of recording an acceptance of an absent one, which
 * signup already refuses to do. It is also not a loophole an operator can sit in:
 * `POST /api/agent-signup` is closed in that same state, so a deployment with no
 * published terms cannot gain an agent. The population this spares is the one
 * that would otherwise be locked out by an upgrade: agents who already exist on a
 * deployment that has never had an agent-terms document. Every such pass is
 * logged as operator-actionable, because it is a state to leave, not a state to
 * be in.
 *
 * A read that FAILS is a different fact and fails closed. "The registry says
 * there is nothing" and "the registry did not answer" are not the same
 * observation, and only the second one is an outage.
 */
export async function agentTermsStatus(db: Db, userId: string): Promise<AgentTermsStatus> {
    let inForce: { version: string; contentHash: string } | null;
    let accepted: { version: string; contentHash: string } | null | undefined;

    try {
        // Sequential, not `Promise.all`. When the second read throws while the
        // first is still in flight, `Promise.all` rejects and leaves the other
        // promise to reject with nobody listening — an unhandled rejection that
        // in a Worker is a crashed request rather than a caught one, and in the
        // test suite is a warning attached to whichever test ran next.
        const legal = new DeploymentLegalService(db);
        const doc = await legal.latest('agent_terms');
        const rows = await db
            .select({ termsAccepted: users.termsAccepted })
            .from(users)
            .where(liveGlobalAgent(userId))
            .limit(1);
        inForce = doc ? { version: doc.version, contentHash: doc.contentHash } : null;
        accepted = rows[0]?.termsAccepted ?? null;
    } catch (err) {
        // Fail CLOSED. An unreadable registry is an outage, and passing on an
        // outage would mean the gate is off exactly when nobody is watching.
        logger.error(
            'agent.terms.status_unreadable',
            { userId },
            err instanceof Error ? err : undefined,
        );
        return {
            state: 'UNREADABLE',
            acceptedVersion: null,
            requiredVersion: null,
            requiredContentHash: null,
        };
    }

    if (!inForce) {
        // Said in full, every time, at warn level and under a name a log search
        // finds. This branch converts "not configured" into "compliant", which
        // is the one shape a gate can take that is indistinguishable from a
        // working gate — so it must never be silent. On a deployment that has
        // published nothing, this line is the ONLY difference between the gate
        // enforcing and the gate not existing.
        logger.warn('agent.terms.gate_not_enforcing', {
            userId,
            enforcing: false,
            // The STATE, not a "reason it was satisfied". A log reader searching
            // for the one condition under which every agent passes should find
            // the same word the type system uses, and should never find it next
            // to a record of an acceptance that does not exist.
            state: 'NOT_IN_FORCE',
            detail:
                'The agent-terms gate is NOT enforcing: this deployment has published no agent '
                + 'terms, so there is no text any agent could be asked to accept and every '
                + 'signed-in agent passes. Agent signup is closed in the same state, so no new '
                + 'agent can appear. Publish the agent terms to turn the gate on.',
        });
        return {
            state: 'NOT_IN_FORCE',
            acceptedVersion: accepted?.version ?? null,
            requiredVersion: null,
            requiredContentHash: null,
        };
    }

    const base = {
        acceptedVersion: accepted?.version ?? null,
        requiredVersion: inForce.version,
        requiredContentHash: inForce.contentHash,
    };

    if (!accepted?.contentHash) {
        return { state: 'REQUIRED', requirement: 'never_accepted', ...base };
    }
    if (accepted.contentHash !== inForce.contentHash) {
        return { state: 'REQUIRED', requirement: 'superseded', ...base };
    }
    return { state: 'ACCEPTED', ...base };
}

/**
 * Record that this agent accepted the agent terms in force.
 *
 * The version and hash are read HERE, from the registry, and never taken from
 * the caller: a caller-supplied pair is the caller asserting what it read, which
 * is the assertion this record exists to replace. `shownContentHash` is the only
 * thing the caller contributes and it is a staleness check, not evidence — a
 * page left open across a publish is refused so the acceptance cannot name a
 * version its signer was never shown.
 *
 * Returns the recorded pair. Throws when nothing is published (there is nothing
 * to accept) or when the page is stale; both are the caller's 400.
 */
export async function recordAgentTermsAcceptance(
    db: Db,
    input: {
        userId: string;
        /** SHA-256 hex of the body the page actually rendered. */
        shownContentHash: string;
        ip?: string | undefined;
        country?: string | undefined;
    },
): Promise<{ version: string; contentHash: string }> {
    const legal = new DeploymentLegalService(db);
    const inForce = await legal.latest('agent_terms');
    if (!inForce) {
        // Logged as well as thrown: one status code covers both refusals below,
        // and "nothing is published" is the operator's problem while "your page
        // is stale" is the signer's. A reader of the status alone cannot tell.
        logger.error('agent.terms.accept_refused_none_published', { userId: input.userId });
        throw Errors.BadRequest(
            'This deployment has not published its agent terms, so there is nothing to accept.',
        );
    }
    if (input.shownContentHash !== inForce.contentHash) {
        logger.info('agent.terms.accept_refused_stale_page', {
            userId: input.userId,
            requiredVersion: inForce.version,
        });
        throw Errors.BadRequest(
            'The agent terms were updated while this page was open. Reload and review the current version.',
        );
    }

    // ONE clock read for both writes. Two would let the ledger row and the
    // projection of it disagree by a millisecond about an event that happened
    // once, and a reader comparing them would have no way to tell which is the
    // event and which is the copy.
    const acceptedAt = new Date();

    // The ledger row FIRST. It is the evidence of record; the `users` slot below
    // is a projection of it. Writing the projection first and then failing would
    // leave the deployment asserting an acceptance it holds no record of, which
    // is the one ordering of these two statements that produces a false record
    // rather than a missing one.
    await db.insert(agentTermsAcceptances).values({
        id: crypto.randomUUID(),
        userId: input.userId,
        doc: 'agent_terms',
        version: inForce.version,
        contentHash: inForce.contentHash,
        acceptedAt,
        ip: input.ip ?? null,
        country: input.country ?? null,
    });

    await db
        .update(users)
        .set({
            termsAccepted: {
                at: acceptedAt.toISOString(),
                version: inForce.version,
                contentHash: inForce.contentHash,
                ...(input.ip ? { ip: input.ip } : {}),
                ...(input.country ? { country: input.country } : {}),
            },
        })
        .where(liveGlobalAgent(input.userId));

    logger.info('agent.terms.accepted', { userId: input.userId, version: inForce.version });
    return { version: inForce.version, contentHash: inForce.contentHash };
}

/**
 * One acceptance, as the agent who made it can read it back.
 *
 * `body` is the text that was in force AT THE TIME, taken from the version the
 * acceptance names — never the text in force now. Those are the same thing right
 * up until the day they are not, and on that day showing the current document
 * would show a signer something they never agreed to, which is the failure this
 * whole record exists to end.
 */
export interface AgentAcceptance {
    version: string;
    contentHash: string;
    /** Unix ms. */
    acceptedAt: number;
    /**
     * Whether the words themselves can still be produced. Normally true —
     * `deployment_legal_versions.body_snapshot` is NOT NULL, so a published
     * version always carries its body. It is false when the operator has removed
     * the version this acceptance names.
     */
    bodyAvailable: boolean;
    /** The archived body, or null when it is not available. Never a substitute. */
    body: string | null;
}

/**
 * Every agent terms acceptance this agent made, newest first.
 *
 * Scoped to ONE user id and nothing else. The route ahead of it also checks the
 * session, but a service that would happily answer for whoever it is asked about
 * is the shape that leaks the day a second caller passes an id from somewhere
 * less careful — so the scope is here, where the query is.
 *
 * The body is a join on `(doc, content_hash)`, which is
 * `uq_deployment_legal_versions_doc_hash`. The hash rather than the version
 * string, because the hash is the thing the acceptance actually attests to: a
 * version string is a label, and joining on a label would return whatever text
 * currently wears it.
 */
export async function agentTermsHistory(db: Db, userId: string): Promise<AgentAcceptance[]> {
    const rows = await db
        .select({
            version: agentTermsAcceptances.version,
            contentHash: agentTermsAcceptances.contentHash,
            acceptedAt: agentTermsAcceptances.acceptedAt,
            body: deploymentLegalVersions.bodySnapshot,
        })
        .from(agentTermsAcceptances)
        // LEFT, deliberately. An inner join would make an acceptance whose
        // version the operator removed vanish from the agent's own history —
        // turning "we cannot show you those words any more" into "you never
        // accepted anything", which is a different and false statement.
        .leftJoin(deploymentLegalVersions, and(
            eq(deploymentLegalVersions.doc, agentTermsAcceptances.doc),
            eq(deploymentLegalVersions.contentHash, agentTermsAcceptances.contentHash),
        ))
        .where(eq(agentTermsAcceptances.userId, userId))
        .orderBy(desc(agentTermsAcceptances.acceptedAt));

    return rows.map((r) => ({
        version: r.version,
        contentHash: r.contentHash,
        acceptedAt: r.acceptedAt.getTime(),
        bodyAvailable: r.body !== null,
        body: r.body,
    }));
}
