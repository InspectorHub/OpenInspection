/**
 * One door for the agent terms, in front of all three ways into an agent
 * session.
 *
 * An agent is a third party: they are not the operator, not the operator's
 * staff, and not the client. There is a document written for them and the rule
 * is that they accept it before they use the product — not before they REGISTER,
 * which is a narrower rule that the shape of this system does not satisfy.
 * There are three ways to hold an agent session:
 *
 *   1. signup            `POST /api/agent-signup`      — records the acceptance
 *   2. password login    `POST /api/agent/login`       — for an account that exists
 *   3. emailed link      `GET  /agent/magic-login`     — for an account that exists
 *
 * Only the first passes through a screen that can collect an acceptance. Two and
 * three mint a 24-hour cookie for an account that already exists and ask it
 * nothing, so a checkbox on the signup form leaves both of them open. The check
 * therefore lives after the three paths converge — on the authenticated request,
 * keyed on the ACTOR rather than on any list of routes.
 *
 * ── Why keyed on the actor, and why that is the un-skippable position ────────
 * Mounted on `*` and gated on `c.var.agentUserId`, which only the JWT middleware
 * sets and only for a verified agent token. A new agent route added next year is
 * behind this without anyone remembering, because there is no route list to
 * forget to update. The cost of that choice is that the exemptions below must be
 * exact and few, and they are.
 *
 * ── Four states, not a boolean ──────────────────────────────────────────────
 * `agentTermsStatus` answers with one of `ACCEPTED`, `NOT_IN_FORCE`, `REQUIRED`
 * or `UNREADABLE`, and this file switches on all four by name. Two of them pass
 * and they are NOT the same event: `ACCEPTED` is an agent bound by a document,
 * `NOT_IN_FORCE` is a deployment with no document to be bound by. They used to
 * share one `satisfied: true`, which is exactly the shape in which "this control
 * is not configured" reads as "this control is green".
 *
 * ── Fail closed ─────────────────────────────────────────────────────────────
 * A registry that cannot be read refuses, as its own state (`UNREADABLE`) and
 * never as `NOT_IN_FORCE`. Passing on an unreadable registry would mean the gate
 * is off precisely when nobody is watching, and an agent with no acceptance is
 * an account that should not have existed — letting it through is the original
 * defect happening again, quietly. `agentTermsStatus` owns that decision,
 * including the one case that is deliberately NOT a refusal (a deployment that
 * has published no agent terms has none for anyone to accept, and cannot gain a
 * new agent either); its doc comment carries the argument.
 *
 * ── What is exempt, and the principle that decides it ───────────────────────
 * A gate with no way out is a lockout, so the way out is exempt: the page that
 * shows the text and the endpoint that records the acceptance.
 *
 * The list below is short and exact, but it is a consequence, not the rule. The
 * rule, so the next person reasons instead of consulting a list:
 *
 *   The Agent Terms gate may restrict access to functionality whose use
 *   requires the agent to be bound by the Agent Terms, but it must not
 *   condition account exit or applicable privacy-rights mechanisms on
 *   acceptance of those terms.
 *
 * Both halves matter. Account exit is the first: a gate whose only exits are
 * "agree" and "keep an account you no longer want" is coercion. Privacy-rights
 * mechanisms are the second, and they are a separate test rather than a special
 * case of the first — a data export is not an exit, the agent may well intend to
 * stay, and access to their own data is not something they can be made to buy
 * with a signature. Anything ADDED here in future has to answer that rule out
 * loud; anything that fails it does not need a new entry, it needs the entry it
 * is missing.
 *
 * The report-token track needs no entry here and that is structural, not lucky.
 * A client or agent opening a report link presents an `inspection_access_tokens`
 * bearer, not a session; the JWT middleware short-circuits those paths before
 * classifying anyone, so `agentUserId` is unset and this middleware returns
 * immediately. `tests/unit/legal/agent-terms-gate.spec.ts` pins that, because
 * gating a homebuyer's report link would be a customer-facing outage caused by
 * an agent-only rule.
 */

import type { MiddlewareHandler } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { Errors } from '../errors';
import { logger } from '../logger';
import type { HonoConfig } from '../../types/hono';
import { agentTermsStatus } from '../../services/agent/terms-acceptance';

/**
 * Where a gated agent is sent to read the text and accept it.
 *
 * Not exported. It travels to clients in the refusal payload (`acceptPath`)
 * rather than as a constant anyone imports, so a client following it does not
 * have to be rebuilt when a deployment moves the page.
 */
const AGENT_ACCEPT_TERMS_PATH = '/agent-accept-terms';

/**
 * Exact paths, never prefixes.
 *
 * The JWT middleware beside this one learned that the hard way: `path ===
 * '/api/agent-signup'` does not cover `/api/agent-signup/terms`, and the fix was
 * to list the child rather than to loosen the match. A prefix here would exempt
 * every future path underneath it, which for `/api/agent` would be the whole
 * agent API.
 */
const EXEMPT_PATHS = new Set<string>([
    // The way out. Records the acceptance; refusing it would be the lockout.
    '/api/agent/accept-terms',
    // The text itself. The signup page reads it with no session at all, so it is
    // already public — listed anyway, because a session-bearing read of the
    // document you are being asked to accept must never depend on that.
    '/api/agent-signup/terms',
    // Signup records an acceptance as part of creating the account. An agent who
    // is already signed in does not come through here, but a second tab might.
    '/api/agent-signup',
    // The other way out. A gate whose only exits are "agree" and "keep an
    // account you no longer want" is the coercion this whole mechanism exists to
    // avoid, so leaving is exempt even though it is an authenticated write.
    //
    // ⚠️ This string is the MOUNT plus the route path — `server/index.ts` mounts
    // identityRoutes at `/api/identities` (plural). Two comments in the tree name
    // this endpoint differently (`server/api/identity.ts` header says
    // `/api/identity/…`, `server/lib/db/schema/tenant/user.ts` said
    // `/api/account/…`); both were wrong, and both were corrected for THIS
    // endpoint when it was added. The sweep stopped at the delete line — the
    // export line beside it in `identity.ts` stayed singular until the entry
    // below was written. Because the matching here is exact, either of those
    // spellings would have compiled, passed review, and exempted nothing.
    '/api/identities/account/delete',
    // The privacy half of the principle in the header. A data export is an
    // access request: the agent is asking for their own data, and answering "not
    // until you accept these terms" would price a privacy-rights mechanism at a
    // signature. It is NOT covered by the deletion entry above — the two are
    // different acts, this one is not an exit, and an exact-match Set gives no
    // family discounts.
    //
    // ⚠️ Same mount trap as the line above, and it had NOT been swept for this
    // one: `server/index.ts` mounts identityRoutes at `/api/identities` (plural)
    // and `server/api/identity.ts` declares the route as `/account/export`, so
    // the string is `/api/identities/account/export`. That file's own header
    // said `POST /api/identity/account/export` (singular) until this entry was
    // added, and it was corrected then — the singular spelling compiles, reviews
    // clean, and exempts nothing at all.
    '/api/identities/account/export',
]);

export const agentTermsGate: MiddlewareHandler<HonoConfig> = async (c, next) => {
    const agentUserId = c.get('agentUserId');
    // Not an agent session — staff, client-portal, public token, or nobody. The
    // agent terms say nothing about any of them.
    if (!agentUserId) return next();
    if (EXEMPT_PATHS.has(c.req.path)) return next();

    const status = await agentTermsStatus(drizzle(c.env.DB), agentUserId);

    // Switched on by name, exhaustively. The two passing states are written as
    // two cases rather than one truthiness test: they let the same traffic
    // through and they mean opposite things, and a future state added to
    // `AgentTermsStatus` fails to compile here instead of falling into whichever
    // branch happened to be the default.
    switch (status.state) {
        case 'ACCEPTED':
            // Bound by the document in force. The gate is doing its job.
            return next();
        case 'NOT_IN_FORCE':
            // Passes, and is NOT the same fact as ACCEPTED: this deployment has
            // published nothing, so nobody could be bound and nobody is refused.
            // Refusing every agent on behalf of a document that does not exist
            // would lock out accounts with no action available to them, which is
            // explicitly not wanted. `agentTermsStatus` emits the operator-facing
            // `agent.terms.gate_not_enforcing` warning on this path — that line
            // is the ONLY difference between the gate enforcing and the gate not
            // existing, so it lives with the decision rather than here, where an
            // exempt path would skip it.
            return next();
        case 'REQUIRED':
        case 'UNREADABLE':
            break;
    }

    // `state` AND the finer requirement, side by side, because the status code
    // cannot say which refusal fired and an operator reading "428" learns
    // nothing. The one worth watching is `superseded`: a burst of it right after
    // a publish is the expected shape, and a burst at any other time is not.
    // `UNREADABLE` carries no requirement — nothing was read, so there is no
    // "which way did they fall short" to report, and the type says so.
    const requirement = status.state === 'REQUIRED' ? status.requirement : null;
    logger.info('agent.terms.gate_blocked', {
        userId: agentUserId,
        path: c.req.path,
        state: status.state,
        requirement,
        acceptedVersion: status.acceptedVersion,
        requiredVersion: status.requiredVersion,
    });

    throw Errors.AgentTermsRequired({
        // Both travel to the client, because they answer different questions.
        // `state` says WHICH FACT stopped this request; `reason` says what the
        // agent can do about it, and for an outage there is nothing they can do,
        // which is why `unreadable` appears there and not as a requirement.
        state: status.state,
        reason: requirement ?? 'unreadable',
        acceptPath: AGENT_ACCEPT_TERMS_PATH,
        requiredVersion: status.requiredVersion,
    });
};
