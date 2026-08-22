import type { PlatformActor } from './m2m-auth';

/**
 * The two session claims that say a support session is a support session.
 *
 * WHY A MODULE AND NOT TWO STRING LITERALS. The claim is written in one place
 * (the SSO consume handler, which mints the session) and read in another (the
 * JWT middleware, which puts the actor on the request context). Those two files
 * have to agree on the spelling, on the pair rule, and on what a half-written
 * claim means — and "must stay in sync with X" written as a comment is a latent
 * bug. Here it is one function each way, so disagreement is not expressible.
 *
 * WHY TWO CLAIMS AND NOT A BOOLEAN. `custom:isImpersonated` already exists on
 * the portal side and answers "is somebody driving". Every question anyone asks
 * afterwards — who opened this workspace, and when — needs the other half.
 *
 * WHY NOT `custom:sso`. That marker is on EVERY session minted through the
 * portal, including a customer switching between their own workspaces. Reading
 * it as a support marker would stamp most SaaS traffic as platform staff.
 */
const ID_CLAIM = 'custom:platformActorId';
const EMAIL_CLAIM = 'custom:platformActorEmail';

/**
 * The claims to mint, or nothing at all.
 *
 * Spread into a token: `{ ...otherClaims, ...platformActorClaims(actor) }`. An
 * ordinary handoff therefore produces exactly the token it always produced,
 * rather than one carrying two nulls whose meaning a later reader has to decide.
 */
export function platformActorClaims(
    actor: { platformAdminId?: string | undefined; email?: string | undefined } | null | undefined,
): Record<string, string> {
    if (!actor?.platformAdminId || !actor.email) return {};
    return { [ID_CLAIM]: actor.platformAdminId, [EMAIL_CLAIM]: actor.email };
}

/**
 * The actor a verified token carries, or null.
 *
 * BOTH halves or neither. An id with no email — or the reverse — is a token
 * somebody built wrong, and reading it as a support session would file audit
 * rows against a person the other half cannot identify. Null is the safe answer
 * because the fallback is `tenant_user`, which is what the row would have said
 * before any of this existed.
 */
export function readPlatformActorClaim(payload: Record<string, unknown>): PlatformActor | null {
    const id = payload[ID_CLAIM];
    const email = payload[EMAIL_CLAIM];
    if (typeof id !== 'string' || !id) return null;
    if (typeof email !== 'string' || !email) return null;
    return { platformAdminId: id, email };
}
