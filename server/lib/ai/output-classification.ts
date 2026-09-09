/**
 * WHAT KIND OF THING the model just wrote — and what that makes it subject to.
 *
 * This is the third axis, and the reason it had to become one is that the two
 * that already existed cannot answer the question.
 *
 *   - `AiUsageKind` ('translate' | 'assist') is a COST split. Its own comment
 *     in `usage/period.ts` says so: one translation per report against tens of
 *     assist calls, metered apart so a cap on one is not a cap on the other.
 *   - `AiCredentialSource` ('managed' | 'byo') is WHOSE KEY paid.
 *
 * Neither says what the output IS, and `assist` alone currently spans three
 * different kinds of writing. A single posture attached to `assist` would
 * therefore give the same treatment to a rewritten defect note and to a
 * maintenance tip, which are not the same kind of statement about a property.
 *
 * WHY THE CLASSES ARE THESE AND NOT SOME OTHER SET. They are not invented here.
 * The five below are the categories the product's rules are written against,
 * and the point of naming them in code is that a new capability gets sorted
 * into an existing class instead of prompting a fresh judgement call every
 * time. Adding a class is a deliberate change; picking one for a new prompt is
 * routine.
 *
 * WHY IT IS ATTACHED TO THE PROMPT AND NOT TO THE ROUTE. A route can call more
 * than one prompt and a prompt can be reached from more than one route, so a
 * classification held anywhere else describes a call path rather than the text.
 * `VersionedPrompt` requires the field, so a prompt with no class does not
 * compile — see the `satisfies` guard on `AI_PROMPTS`. The gate
 * (`scripts/check-ai-classification.mjs`) is the backstop for the cases a type
 * cannot see, not the primary enforcement.
 */
import type { AiCredentialSource } from './resolve-provider';

/**
 * What the model produced, in terms of what it asserts about a property.
 *
 * Ordered from the most constrained to the most consequential. The three
 * prohibited-or-conditional ones at the end have no prompt today; they are
 * listed because the whole value of this table is that the answer exists
 * BEFORE someone writes the prompt, not after.
 */
export type AiOutputClassification =
    /** Rendering existing text in another language. Adds no assertion. */
    | 'translation'
    /** Condensing findings that already exist elsewhere in the report. */
    | 'summary'
    /** Explaining or rephrasing one finding the inspector already made. */
    | 'finding_explanation'
    /** General upkeep guidance. NOT a finding and NOT a recommendation. */
    | 'maintenance_suggestion'
    /** Contract, agreement, disclosure or any other operative legal wording. */
    | 'legal_text'
    /** What a repair would cost, or how long it should last. */
    | 'repair_pricing'
    /**
     * The SHAPE of a template — section and item headings — read back out of a
     * document the workspace supplied.
     *
     * Its own class rather than a `summary`, because what it asserts is
     * different in kind. The other classes restate content that exists in a
     * report; this one produces a STRUCTURE that later inspections are
     * recorded against, so a heading the model invented becomes a field
     * somebody fills in and a section of a report nobody wrote. That is not a
     * statement about a property yet, which is what makes it neither a finding
     * nor a summary — it is a statement about what future findings will be
     * shaped like.
     */
    | 'template_inference';

/** Why a classification is not available on a given credential source.
 *  Not exported: `capability-policy.ts` switches on the VALUES and translates
 *  them into its own denial vocabulary, so nothing outside needs to name the
 *  type — and an exported type nobody imports is what `lint:deadcode` counts. */
type ClassificationDenial =
    /** Never offered on any credentials, at any tier. */
    | 'prohibited'
    /** Offered by the product, but not yet released on this deployment. */
    | 'not_released'
    /** Released, but not funded by these credentials. */
    | 'source_not_offered';

export interface ClassificationPosture {
    /** Whether output of this class may be generated on this source at all. */
    readonly allowed: boolean;
    /** Set only when `allowed` is false. */
    readonly denial?: ClassificationDenial;
    /**
     * Whether a person must review this output before it reaches a client.
     *
     * PRESENT ONLY WHERE OUTPUT MAY BE PRODUCED. It used to sit on every
     * posture reading `true`, including the ones that refuse the call — a
     * denial carrying "this output must be reviewed" is a sentence about
     * nothing, and it made the field look like an unkept promise when most of
     * its occurrences described output that does not exist.
     *
     * ON THE ASSIST PATH THE REVIEW IS STRUCTURAL, not an honour system.
     * `server/api/ai.ts` writes nothing but the review row: the routes RETURN
     * `rewritten` / `suggestions` and a person puts the text into the report.
     * The assist route additionally refuses to hand the UI a suggestion with no
     * `aiCallId`, because text an inspector cannot review is text they are
     * structurally unable to accept. `AiAssistPanel` posts `intent: "review"`
     * on acceptance, so the evidence row is written by the same action.
     *
     * ON THE TRANSLATION PATH IT IS NOT, and deliberately so.
     * `report-translation.service.ts` stores machine output with no per-segment
     * review. What governs that is not review but the courtesy-translation
     * architecture: the English stays authoritative, the notice travels with the
     * translation, and a freshness hash withholds one made from text that has
     * since changed. The rule that shape satisfies is that machine translation
     * must not be DELIVERED AS AUTHORITATIVE LEGAL TEXT — a reader must never be
     * left relying on a legal meaning no person checked. Marking the English as
     * the record answers that; requiring a reviewer per segment of descriptive
     * narrative would not, and is not what the rule asks for.
     */
    readonly requiresReview?: boolean;
    /**
     * Conditions the output must satisfy, in the product's own words. Prose on
     * purpose — these constrain what a prompt may ASK FOR, which is a review
     * question at the time the prompt is written, not a runtime assertion.
     */
    readonly conditions?: readonly string[];
}

/** Conditions shared by everything that restates inspection content. */
const NO_NEW_ASSERTIONS = [
    'must introduce no fact not already in the report',
    'must not change any severity',
    'must not add a recommendation the inspector did not make',
] as const;

/**
 * What a courtesy translation may ask a model for, on top of the restatement
 * floor every class in this group carries.
 *
 * The first two are the reason translation is a class of its own rather than
 * another kind of restatement: it produces a SECOND DOCUMENT that a reader may
 * take for the report, so the constraints are about the standing of the output
 * and not only about its contents. The third is the boundary the
 * non-translatable content registry draws — legal instruments stay in the
 * language they were agreed in, and `legal_text` is refused outright on both
 * sources so no prompt may reach for them a second way either.
 */
const COURTESY_TRANSLATION = [
    ...NO_NEW_ASSERTIONS,
    'must render the English source and nothing else: no gloss, no clarification, no footnote, no reordering',
    'must be labelled a courtesy translation, stating that the English report is the inspection record',
    'must never be asked to render reliance clauses, limitation of liability, arbitration, warranty disclaimers, governing law, contract terms, signatures or acknowledgements',
    'must reproduce addresses, personal names, dates, measurements and currency amounts verbatim, so a reader can match them against the English document',
] as const;

/**
 * The posture table. Two entries per class, because whose key paid changes the
 * answer for everything except the two that are refused outright.
 *
 * ⚠️ `legal_text` and `repair_pricing` are `prohibited` on BOTH sources, and
 * that is not a "not yet". A tenant supplying their own provider key does not
 * release a capability — the product either makes these statements or it does
 * not, and it does not.
 */
const POSTURE: Record<
    AiOutputClassification,
    Record<AiCredentialSource, ClassificationPosture>
> = {
    translation: {
        // Released on a workspace's OWN provider key. The deployment that
        // supplies the key selects the provider, holds the account and owns
        // the vendor relationship, so the arrangement behind a translated
        // document is one the workspace chose and can describe.
        //
        // "Allowed" here means RELEASED, not unconditional: `capability-policy`
        // still refuses an own key with no confirmation on file, after this
        // lookup. Both answers are needed — this table says what the product
        // ships, that check says what these credentials may run.
        byo: { allowed: true, requiresReview: true, conditions: COURTESY_TRANSLATION },
        // The platform key stays refused, and `source_not_offered` rather than
        // `not_released` is the deliberate half of that: the capability ships,
        // so the refusal names the credentials, which is the part a workspace
        // can act on. It is refused per PROVIDER, not per feature — a platform
        // key may only carry output classes whose provider record is complete
        // for the provider that would actually serve the call, and that record
        // is kept with the deployment rather than in this table.
        managed: { allowed: false, denial: 'source_not_offered' },
    },
    summary: {
        byo: { allowed: true, requiresReview: true, conditions: NO_NEW_ASSERTIONS },
        managed: { allowed: false, denial: 'source_not_offered' },
    },
    finding_explanation: {
        byo: { allowed: true, requiresReview: true, conditions: NO_NEW_ASSERTIONS },
        managed: { allowed: false, denial: 'source_not_offered' },
    },
    maintenance_suggestion: {
        byo: {
            allowed: true,
            requiresReview: true,
            conditions: [
                ...NO_NEW_ASSERTIONS,
                'must be labelled general educational information, not an inspection finding and not a professional recommendation',
                'must state no repair interval, no cost, and no construction method',
            ],
        },
        managed: { allowed: false, denial: 'source_not_offered' },
    },
    legal_text: {
        byo: { allowed: false, denial: 'prohibited' },
        managed: { allowed: false, denial: 'prohibited' },
    },
    repair_pricing: {
        byo: { allowed: false, denial: 'prohibited' },
        managed: { allowed: false, denial: 'prohibited' },
    },
    template_inference: {
        // NOT RELEASED on either source today, and the two refusals say
        // different things because the answers have different causes.
        //
        // On a workspace's own key it is `not_released`: the code exists, it is
        // classified, it is metered by the same chokepoint as everything else,
        // and nothing about the credentials is the obstacle. What is missing is
        // the product decision to ship it, and this line is where that decision
        // gets made — an edit here, reviewed like any other, rather than an
        // environment flag that would let one deployment ship a capability no
        // other deployment has.
        byo: {
            allowed: false,
            denial: 'not_released',
            // No `requiresReview`: this class is not released, so there is no
            // output. The review it WILL need when it ships is stated in the
            // conditions below — "must not be treated as a template until a
            // person has reviewed it" — which is where a not-yet-built
            // capability's obligations belong, since conditions constrain what
            // the prompt may ask for and this flag describes text that exists.
            conditions: [
                'must produce section and item headings only: no comment text, no ratings, no severities',
                'must introduce no section or item the supplied document does not contain',
                'must not be treated as a template until a person has reviewed it',
            ],
        },
        // On a platform key it is `source_not_offered`, the same answer every
        // other class gives there and for the same reason: a platform key may
        // only carry output classes whose provider record is complete for the
        // provider that would actually serve the call, and that record is kept
        // with the deployment rather than in this table. Releasing the class
        // above does NOT release it here — these are two entries, and they are
        // separate so that turning one on cannot turn the other on by accident.
        managed: { allowed: false, denial: 'source_not_offered' },
    },
};

/**
 * The posture for one (class, source) pair.
 *
 * Total by construction: `POSTURE` is a `Record` over both unions, so adding a
 * classification without a posture fails to compile and there is no default
 * arm to fall through to. That is the whole design — a capability whose posture
 * nobody stated must not resolve to "allowed" because a lookup missed.
 */
export function posture(
    classification: AiOutputClassification,
    source: AiCredentialSource,
): ClassificationPosture {
    return POSTURE[classification][source];
}
