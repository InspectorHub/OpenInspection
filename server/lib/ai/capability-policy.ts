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
 *
 * Pure and synchronous, like `resolveAi`: no I/O, the whole policy fits on one
 * screen, and it is testable without a database.
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
    | 'source_not_offered';

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
    source: AiCredentialSource,
): AiCapabilityDecision {
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

    return { allowed: true };
}
