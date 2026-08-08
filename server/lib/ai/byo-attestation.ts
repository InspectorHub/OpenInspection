/**
 * Bring-your-own AI key — what the tenant confirms, and the record it leaves.
 *
 * A workspace can point AI features at its own provider key. The credential and
 * the provider account are theirs. This codebase, however, ships the API client
 * that calls the provider and turns the integration on, so "who made this AI
 * capability available" has no purely tenant-side answer. What follows from that
 * is a narrow posture: state the fact we know, ask the tenant to confirm the
 * facts only they can know, and keep the answer.
 *
 * The fact only they can know is the SERVICE TIER. Provider terms differ by tier
 * — some tiers allow the provider to use submitted content to improve its models
 * and to have that content reviewed by people; paid tiers generally do not. The
 * tier is a property of the billing project the key belongs to. It is not carried
 * on the key, and no endpoint this client calls reports it. Detection is not an
 * option that was weighed and rejected; it is not available.
 *
 * `termsVersion` is why this is a module and not three booleans. Provider terms
 * change. A confirmation captured this month cannot be read back a year later
 * unless the record says WHICH revision it was made against — so the revision is
 * an addressable constant that moves in a commit, never a string assembled at
 * the moment of the write.
 */

/**
 * Revision of the AI provider terms the on-screen disclosure describes.
 *
 * Bump this when a provider publishes terms whose substance differs from what
 * the disclosure says. The bump is what keeps older rows legible as "confirmed
 * against the earlier revision" instead of silently restating them under wording
 * the tenant never saw.
 */
export const AI_PROVIDER_TERMS_VERSION = '2026-08';

/**
 * Revision of the statements the tenant confirms. Independent of the terms
 * revision — our wording can change while the provider's terms do not, and the
 * reverse. Bump when a statement is added, removed, or changes meaning.
 */
export const AI_KEY_ATTESTATION_POLICY_VERSION = '2026-08';

/**
 * The statements. Each is something the tenant asserts; none is advice from us,
 * and none disclaims anything on our behalf.
 */
export interface AiKeyAttestation {
    /** They have reviewed their AI provider's terms. */
    reviewedProviderTerms: boolean;
    /** The service tier on their provider account permits their intended use. */
    tierPermitsIntendedUse: boolean;
    /** They understand inspection content is processed by that provider. */
    understandsProviderProcessing: boolean;
}

/**
 * Every statement, in display order. One source for the UI, the validator and
 * the completeness check, so a fourth statement cannot be added to the form and
 * left out of the gate.
 */
const AI_KEY_ATTESTATION_STATEMENTS = [
    'reviewedProviderTerms',
    'tierPermitsIntendedUse',
    'understandsProviderProcessing',
] as const satisfies ReadonlyArray<keyof AiKeyAttestation>;

/**
 * True only when every statement is confirmed. Two of three is not a weaker
 * attestation, it is none: each statement covers ground the others do not.
 */
export function isAiKeyAttested(
    value: AiKeyAttestation | undefined | null,
): value is AiKeyAttestation {
    if (!value) return false;
    return AI_KEY_ATTESTATION_STATEMENTS.every((statement) => value[statement] === true);
}

/**
 * The stored evidence.
 *
 * `provider`, `mode` and `accountOwner` are recorded even though exactly one
 * combination is reachable today. The row has to answer "what was attested, by
 * whom, about which arrangement" on its own — a reader a year from now cannot be
 * expected to know what the code was capable of in the month it was written.
 */
export interface AiKeyAttestationRecord {
    provider: 'gemini';
    mode: 'tenant_key';
    accountOwner: 'tenant';
    termsVersion: string;
    attestedAt: Date;
    policyVersion: string;
}

/**
 * The six stored columns, as they come back from `tenant_configs` — every one
 * nullable, because "no confirmation on file" is the state the columns are in
 * for every workspace that has never been through the confirm step.
 */
export interface StoredAiKeyAttestation {
    provider: string | null;
    mode: string | null;
    accountOwner: string | null;
    termsVersion: string | null;
    attestedAt: Date | null;
    policyVersion: string | null;
}

/**
 * Whether a COMPLETE confirmation is on file. The runtime gate reads this.
 *
 * All six are checked, not one. They are written in a single statement, so in
 * practice they move together — but "in practice" is the assumption every
 * partially-written row was allowed by, and a gate that inspects one column
 * while claiming to check the record is the kind that reports green about
 * something it never looked at.
 *
 * Deliberately NOT invalidated by a `termsVersion` that no longer equals
 * `AI_PROVIDER_TERMS_VERSION`. Bumping that constant should be a decision to
 * ask people to re-confirm, carried out on purpose; wiring it to this check
 * would turn a one-character edit into an immediate outage for every workspace
 * on its own key. The stored revision stays visible to whoever runs that pass.
 */
export function isAiKeyAttestationOnFile(
    stored: StoredAiKeyAttestation | null | undefined,
): boolean {
    if (!stored) return false;
    return (
        !!stored.provider &&
        !!stored.mode &&
        !!stored.accountOwner &&
        !!stored.termsVersion &&
        !!stored.attestedAt &&
        !!stored.policyVersion
    );
}

/** Builds the record for a tenant-supplied Gemini key confirmed at `attestedAt`. */
export function buildAiKeyAttestationRecord(attestedAt: Date): AiKeyAttestationRecord {
    return {
        provider: 'gemini',
        mode: 'tenant_key',
        accountOwner: 'tenant',
        termsVersion: AI_PROVIDER_TERMS_VERSION,
        attestedAt,
        policyVersion: AI_KEY_ATTESTATION_POLICY_VERSION,
    };
}
