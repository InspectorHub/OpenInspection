/**
 * What this product OFFERS: whether a given AI capability may run at all on a
 * given set of credentials.
 *
 * This is a different question from the two that already had answers.
 * `resolve-provider.ts` decides WHICH key a call would run on; `metering.ts`
 * counts what a call consumed. Neither one ever asks whether the capability is
 * something the product currently ships on that key — so nothing did, and the
 * answer was whatever the runtime happened to make possible.
 *
 * WHY THIS EXISTS EVEN THOUGH IT CHANGES NO BEHAVIOR TODAY.
 * The managed path is dark right now for one reason: no deployment has
 * provisioned a platform key. That is an operational fact, not a product
 * decision, and it reverses the instant someone runs a single
 * `wrangler secret put` — an action taken by whoever is provisioning
 * infrastructure, who is not choosing what the product ships. A posture that
 * holds only while a secret is missing is not a posture; it is an accident that
 * has not been corrected yet. Written down here, the same answer survives the
 * key being configured, and turning a capability on becomes an edit to this
 * table that shows up in a diff.
 *
 * WHY IT IS COMPILED IN AND NOT AN ENVIRONMENT SWITCH.
 * What the product offers is a release decision. An env flag would let one
 * deployment quietly ship a capability that was never released anywhere else,
 * and the source would no longer describe the product. Flipping any line below
 * is a code change, reviewed like one.
 *
 * CURRENT POSTURE:
 *   - `assist` on the tenant's OWN key      → offered. Unchanged; this is the
 *     only combination any caller reaches today.
 *   - `assist` on platform credentials      → not offered. Report assistance
 *     runs on the tenant's own provider account, so the tenant picks the
 *     provider and owns that relationship directly rather than through us.
 *   - `translate`, on any credentials       → not offered. The capability has a
 *     usage metric reserved for it and no released surface. A reserved slot
 *     must not double as an unlocked door.
 *   - the tenant's OWN key, unconfirmed     → not offered. See below.
 *
 * WHY AN UNCONFIRMED TENANT KEY IS REFUSED HERE AND NOT ONLY AT SAVE TIME.
 * The save path (`POST /api/admin/secrets`) will not store a new tenant key
 * without the workspace confirming what its provider account permits. That gate
 * covers keys stored from now on and nothing else: a key stored before it
 * existed has been confirmed against nothing, yet would keep calling the
 * provider forever. Two gates for one rule is not duplication — the save gate
 * decides what may be WRITTEN, this one decides what may RUN, and only the
 * second one is true of keys that were already there.
 *
 * Pure and synchronous, like `resolveAi`: no I/O, the whole policy fits on one
 * screen, and it is testable without a database. That is why the confirmation
 * arrives as an argument — it is per-tenant state, resolved once per request
 * beside the credential itself, never looked up here.
 */
import type { AiUsageKind } from '../usage/period';
import type { AiCredentialSource } from './resolve-provider';

/** Why a capability was refused. Machine-readable so a caller can tell
 *  "not shipped yet" apart from "not on these credentials" without matching
 *  on message text. */
export type AiCapabilityDenialReason =
    /** The capability itself has no released surface in this product. */
    | 'capability_not_released'
    /** The capability ships, but not funded by these credentials. */
    | 'source_not_offered'
    /** The credentials are the tenant's own, but carry no confirmation record. */
    | 'tenant_key_not_attested';

/**
 * The credential picture a call runs under: whose key, and — when it is the
 * tenant's own — whether a confirmation is on file for it.
 *
 * One object rather than two arguments because the two facts must come from the
 * SAME resolution. Split apart, a future caller can answer one and forget the
 * other, and the gate would judge a source that no longer matches the key.
 */
export interface AiCredentialPicture {
    source: AiCredentialSource;
    /**
     * Whether `tenant_configs` holds a complete confirmation record for the
     * key this call would run on. Meaningless when `source` is 'managed' — the
     * workspace confirms things about ITS OWN provider account, and a platform
     * account is not one.
     */
    tenantKeyAttested: boolean;
}

export type AiCapabilityDecision =
    | { allowed: true }
    | {
          allowed: false;
          reason: AiCapabilityDenialReason;
          capability: AiUsageKind;
          source: AiCredentialSource;
          /** Phrased for the inspector who triggered the call, not for a log. */
          message: string;
      };

export function checkAiCapability(
    capability: AiUsageKind,
    credentials: AiCredentialPicture,
): AiCapabilityDecision {
    const { source } = credentials;

    // Capability first, credentials second. Translation is refused on the
    // tenant's own key too — the gate is about what the product offers, and a
    // tenant supplying their own key does not release a feature.
    if (capability === 'translate') {
        return {
            allowed: false,
            reason: 'capability_not_released',
            capability,
            source,
            message: 'AI translation is not available in this product yet.',
        };
    }

    if (source === 'managed') {
        return {
            allowed: false,
            reason: 'source_not_offered',
            capability,
            source,
            message:
                'AI assistance runs on your own provider key. Add one in Settings → Advanced → AI.',
        };
    }

    // The tenant's own key, with nothing on file saying what their provider
    // account permits. The message names the destination and the action: a
    // workspace upgrading into this rule sees a stored, working key and would
    // otherwise have no way to learn what "unavailable" is asking of them.
    if (!credentials.tenantKeyAttested) {
        return {
            allowed: false,
            reason: 'tenant_key_not_attested',
            capability,
            source,
            message:
                'AI is paused until your provider key is confirmed. Open Settings → Advanced → AI and confirm the statements about your provider account.',
        };
    }

    return { allowed: true };
}
