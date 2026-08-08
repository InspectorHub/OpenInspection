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
 * WHAT IT ASKS ABOUT, AND WHY THAT CHANGED.
 * This gate used to key on `AiUsageKind` — the two-member COST split
 * ('translate' | 'assist'). That could not express the posture, because
 * `assist` alone spans several different kinds of writing: rewording one
 * finding, summarising a whole report, and offering upkeep advice are not the
 * same statement about a property, and a single answer attached to `assist`
 * gave all three the same treatment. The posture now lives in
 * `output-classification.ts`, keyed on what the output IS, and this function
 * reads it. Metering still uses `AiUsageKind`; the two vocabularies answer
 * different questions and are deliberately not merged.
 *
 * WHAT REMAINS HERE: the credential facts, which no classification can decide —
 * whether the tenant's own key has been confirmed. See below.
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
import { posture, type AiOutputClassification } from './output-classification';
import type { AiCredentialSource } from './resolve-provider';

/** Why a capability was refused. Machine-readable so a caller can tell
 *  "not shipped yet" apart from "not on these credentials" without matching
 *  on message text. */
export type AiCapabilityDenialReason =
    /** The capability itself has no released surface in this product. */
    | 'capability_not_released'
    /** The product does not generate this kind of output at all, on any
     *  credentials. Distinct from `capability_not_released`, which is a "not
     *  yet" — this one has no version of itself that ships. */
    | 'capability_prohibited'
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
          classification: AiOutputClassification;
          source: AiCredentialSource;
          /** Phrased for the inspector who triggered the call, not for a log. */
          message: string;
      };

/** How each class is named to the person who triggered the call. Not the enum
 *  value: 'finding_explanation' is an internal word, and an inspector reading a
 *  refusal needs to recognise the feature they just used. */
const LABEL: Record<AiOutputClassification, string> = {
    translation: 'AI translation',
    summary: 'AI summaries',
    finding_explanation: 'AI writing assistance',
    maintenance_suggestion: 'AI maintenance suggestions',
    legal_text: 'AI-written legal or agreement text',
    repair_pricing: 'AI repair cost or lifespan estimates',
};

export function checkAiCapability(
    classification: AiOutputClassification,
    credentials: AiCredentialPicture,
): AiCapabilityDecision {
    const { source } = credentials;
    const label = LABEL[classification];
    const deny = (reason: AiCapabilityDenialReason, message: string): AiCapabilityDecision => ({
        allowed: false,
        reason,
        classification,
        source,
        message,
    });

    // What the output IS, first; whose key would pay for it, second. Both are
    // answered by one table lookup that is total over both unions, so there is
    // no arm where an unstated posture resolves to "allowed".
    const p = posture(classification, source);
    if (!p.allowed) {
        switch (p.denial) {
            case 'prohibited':
                // No "yet". The product does not make these statements, and a
                // tenant supplying their own key does not release a capability.
                return deny(
                    'capability_prohibited',
                    `${label} is not something this product generates.`,
                );
            case 'source_not_offered':
                return deny(
                    'source_not_offered',
                    `${label} runs on your own provider key. Add one in Settings → Advanced → AI.`,
                );
            default:
                // Includes `not_released` and — defensively — a posture that
                // refused without saying why. Both mean "not available", and
                // the safe reading of an unexplained refusal is still refusal.
                return deny(
                    'capability_not_released',
                    `${label} is not available in this product yet.`,
                );
        }
    }

    // The tenant's own key, with nothing on file saying what their provider
    // account permits. The message names the destination and the action: a
    // workspace upgrading into this rule sees a stored, working key and would
    // otherwise have no way to learn what "unavailable" is asking of them.
    //
    // Scoped to 'byo' explicitly. A workspace confirms things about ITS OWN
    // provider account, so the question is meaningless on a platform key — and
    // the moment any class becomes allowed on 'managed', an unscoped check here
    // would refuse it for a reason that cannot apply.
    if (source === 'byo' && !credentials.tenantKeyAttested) {
        return deny(
            'tenant_key_not_attested',
            'AI is paused until your provider key is confirmed. Open Settings → Advanced → AI and confirm the statements about your provider account.',
        );
    }

    return { allowed: true };
}
