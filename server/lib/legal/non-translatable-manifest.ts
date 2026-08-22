/**
 * OI #58 — the non-translatable content registry.
 *
 * review review (`[redacted]`) ruled on
 * eight categories of content that ride inside the inspection report and the
 * inspection agreement: reliance clauses, limitation of liability, arbitration,
 * warranty disclaimer, governing law, contract terms, signatures and
 * acknowledgements. The ruling is one sentence long and it is the reason this
 * file exists: *"These are not 'content'. These are a legal instrument."*
 *
 * English is authoritative for every entry below. None of it is eligible for
 * machine translation, and none of it is eligible for the message catalogue
 * either — a courtesy translation of a term is still the term arriving in a
 * language nobody agreed to be bound in.
 *
 * ## This registry has NO runtime effect today, and that is the point
 *
 * The `translation` output class is now RELEASED on a workspace's own provider
 * key and still refused on a platform key
 * (`server/lib/ai/output-classification.ts`; `legal_text` stays `prohibited` on
 * both). What does NOT exist is a pipeline: nothing segments a report and
 * nothing calls for a translation of one, so there is still no consumer for
 * this list. It remains a PRECONDITION of #23 rather than a feature of it: the
 * register has to exist, and be enforced, before the pipeline that would
 * otherwise have to remember all eight categories at review time.
 *
 * ⚠️ The release is why this file matters more than it did, not less. While the
 * capability was refused outright, an omission here could not reach a client;
 * now the only thing between the eight categories and a model is that no
 * caller has been written yet.
 *
 * ⚠️ Read the direction of the rule correctly. This is NOT an exemption list
 * carved out of a permission — today nothing may be machine-translated at all.
 * It is an enumeration of what stays English **even after** #23 opens the door.
 * Nothing here licenses translating anything that is not here; the out-of-scope
 * register (`non-translatable-out-of-scope.ts`) is where "translatable, and here
 * is why" is written down, and it is deliberately short.
 *
 * ## Platform notices are a DIFFERENT module — do not merge them in
 *
 * `server/lib/legal/report-view-disclosure.ts` (the Art. 13 report-view notice)
 * and `server/lib/legal/agreement-language-disclosure.ts` (the neutral
 * disclosure shown alongside an agreement) are platform notices. review
 * positioned the second as a *"neutral platform disclosure"* on 2026-08-02, and
 * it states a fact while deciding nothing. A notice ABOUT the instrument is not
 * a term OF the instrument, and conflating the two would either freeze copy that
 * benefits from being read in the recipient's language or license translating
 * terms that must not be. Both are listed in the out-of-scope register with the
 * reason, so the boundary is written down rather than remembered.
 *
 * ## Why entries reference a PATH and a LOCATOR instead of importing anything
 *
 * Two reasons, and the first one is not aesthetic.
 *
 *  1. `server/services/inspection/inspection-report.service.ts` and
 *     `server/api/public-report.ts` sit at their large-file-ratchet cap with
 *     ZERO headroom (`scripts/file-size-baseline.json`). One added import line
 *     fails `npm run lint:filesize`. The signature block genuinely lives in the
 *     first of those, so the registry names it by path and the gate reads the
 *     file as text.
 *  2. Half the subjects are not importable values at all. They are D1 columns
 *     (`agreements.content`, `agreement_signers.signature_base64`), a template
 *     field a tenant fills in (`disclaimerText`), and prose inside a seeded
 *     fixture. A registry of content KINDS is compile-time knowledge that is
 *     identical for every tenant; it is not a table and it is not a module
 *     graph.
 *
 * The cost of naming things by string is that a rename silently empties the
 * register. That is what the gate is for: it fails when a `source` no longer
 * exists, when a `locator` no longer appears in it, and when it parses zero
 * entries. See `scripts/check-non-translatable.mjs`.
 */

/**
 * The eight categories review named. A CLOSED set.
 *
 * The gate carries its own copy of this list and compares the two in both
 * directions, because a gate whose scope is a private constant is a gate that
 * can be narrowed by editing the thing it checks.
 *
 * @gateConsumed read as source text by `scripts/check-non-translatable.mjs`.
 */
export const NON_TRANSLATABLE_CATEGORIES = [
    'reliance_clause',
    'limitation_of_liability',
    'arbitration',
    'warranty_disclaimer',
    'governing_law',
    'contract_terms',
    'signature',
    'acknowledgement',
] as const;

/**
 * @gateConsumed the alias for the field `scripts/check-non-translatable.mjs`
 * validates. It is derived from the tuple above rather than written out, so the
 * type and the gate's in-scope set cannot drift apart in the source; only the
 * gate's own copy can, and that is what the gate compares.
 */
export type NonTranslatableCategory = (typeof NON_TRANSLATABLE_CATEGORIES)[number];

/**
 * One piece of English-authoritative content inside the legal instrument.
 *
 * @gateConsumed `scripts/check-non-translatable.mjs` reads this declaration out
 * of the SOURCE TEXT rather than importing it — the gate is a plain .mjs script
 * and this is TypeScript. That consumption is invisible to a module-graph
 * analyzer, so knip would report both symbols as dead. The tag (knip
 * `tags: ["-gateConsumed"]`) says "a tool consumes this", which is true; a
 * dead-code baseline entry would have said "this is dead and we tolerate it",
 * which is not. Precedent: `ERASURE_OUT_OF_SCOPE`.
 */
export interface NonTranslatableEntry {
    /** Stable slug. Never reused, and never shared with an out-of-scope entry. */
    id: string;
    /** Which of review eight categories this is. */
    category: NonTranslatableCategory;
    /** Repo-relative path to the file that HOLDS the text or declares the column. */
    source: string;
    /** A literal string that must occur in `source` — the field, column or heading. */
    locator: string;
    /** Why English is authoritative here. An entry without one is a shrug. */
    reason: string;
}

/** @gateConsumed read as source text by `scripts/check-non-translatable.mjs`. */
export const NON_TRANSLATABLE_MANIFEST: NonTranslatableEntry[] = [
    // ── reliance clauses (ASTM E2018 4.2.1-4.2.4) ────────────────────────────
    // These three defaults reach the payload as `relianceText` and are editable
    // by the inspector, so the shipped English is a floor rather than a fixed
    // string. Translating either the default or the edit would put the platform
    // between a consultant and the party they are telling not to rely on them.
    {
        id: 'pca-reliance-user-reliance',
        category: 'reliance_clause',
        source: 'server/lib/pca-reliance-text.ts',
        locator: 'userReliance',
        reason: 'Names who may rely on the report and requires written authorization for anyone else. This is the clause that decides whether a third party has a claim at all, so its wording is the instrument rather than a description of one.',
    },
    {
        id: 'pca-reliance-point-in-time',
        category: 'reliance_clause',
        source: 'server/lib/pca-reliance-text.ts',
        locator: 'pointInTime',
        reason: 'Fixes the report to the date of the site visit and disclaims any duty to update. A translation that softened the duty language would extend an obligation the consultant never accepted.',
    },
    {
        id: 'report-payload-reliance-text',
        category: 'reliance_clause',
        source: 'server/services/inspection/inspection-report.service.ts',
        locator: 'relianceText',
        reason: 'The assembled reliance block as it reaches the report payload, defaults merged with the inspector edit. Named by path because this file is at its file-size cap with zero headroom and must not grow an import.',
    },

    // ── limitation of liability ──────────────────────────────────────────────
    {
        id: 'pca-reliance-site-specific',
        category: 'limitation_of_liability',
        source: 'server/lib/pca-reliance-text.ts',
        locator: 'siteSpecific',
        reason: 'States what the report is NOT — not an engineering study, not a code-compliance survey, not a warranty. Every phrase is a boundary on what can be claimed against it, which is a limitation of liability written as a scope statement.',
    },
    {
        id: 'starter-agreement-limitation-of-liability',
        category: 'limitation_of_liability',
        source: 'server/services/starter-content/fixtures/agreement-template.ts',
        locator: 'Limitation of Liability',
        reason: 'The liability-cap section of the agreement seeded into every new tenant. It ships as a jurisdiction placeholder the tenant replaces with attorney-reviewed copy, and a machine translation of either the placeholder or its replacement would be the platform drafting a cap it did not write.',
    },
    {
        id: 'agreement-body-limitation-of-liability',
        category: 'limitation_of_liability',
        source: 'server/lib/db/schema/inspection/agreements.ts',
        locator: 'content',
        reason: 'Tenant-authored agreement body. Any liability cap a real engagement uses lives in this column, is attorney-reviewed per jurisdiction, and is signed in the language it was presented in.',
    },

    // ── arbitration ──────────────────────────────────────────────────────────
    {
        id: 'agreement-body-arbitration',
        category: 'arbitration',
        source: 'server/lib/db/schema/inspection/agreements.ts',
        locator: 'content',
        reason: 'Dispute-resolution and arbitration clauses are tenant-authored and live only in this column. A clause that waives access to a court is the last text on the platform that should reach a signer in a rendering nobody reviewed.',
    },

    // ── warranty disclaimer ──────────────────────────────────────────────────
    {
        id: 'starter-agreement-not-a-warranty',
        category: 'warranty_disclaimer',
        source: 'server/services/starter-content/fixtures/agreement-template.ts',
        locator: 'warranty',
        reason: 'The seeded agreement states the inspection is not a code review, warranty, insurance policy or guarantee, and lists the exclusions. A disclaimer only disclaims in the words it was agreed in.',
    },
    {
        id: 'template-section-disclaimer-text',
        category: 'warranty_disclaimer',
        source: 'server/types/template-schema.ts',
        locator: 'disclaimerText',
        reason: 'Per-section disclaimer authored on the template and rendered verbatim in the report. It is the inspector limiting what a section covers, so it travels with the report as their words and not as a paraphrase.',
    },

    // ── governing law ────────────────────────────────────────────────────────
    {
        id: 'agreement-body-governing-law',
        category: 'governing_law',
        source: 'server/lib/db/schema/inspection/agreements.ts',
        locator: 'content',
        reason: 'Choice-of-law and choice-of-venue provisions are tenant-authored and live only in this column. The platform deliberately writes no governing-language clause of its own — see server/lib/legal/agreement-language-disclosure.ts, which explains why inserting one would make the platform a party to an allocation it is not part of.',
    },

    // ── contract terms ───────────────────────────────────────────────────────
    {
        id: 'starter-agreement-body',
        category: 'contract_terms',
        source: 'server/services/starter-content/fixtures/agreement-template.ts',
        locator: 'AGREEMENT_BODY',
        reason: 'The whole seeded pre-inspection agreement: scope, exclusions, payment, cap, acknowledgment, signature block. Seeded content is still contract text the moment a tenant sends it without editing, which the template itself warns about.',
    },
    {
        id: 'agreement-body-contract-terms',
        category: 'contract_terms',
        source: 'server/lib/db/schema/inspection/agreements.ts',
        locator: 'content',
        reason: 'The operative terms of every real engagement. The signer is bound by the bytes in this column as rendered at sign time, and nothing downstream may substitute a different rendering of them.',
    },

    // ── signature ────────────────────────────────────────────────────────────
    {
        id: 'agreement-signer-signature',
        category: 'signature',
        source: 'server/lib/db/schema/inspection/agreements.ts',
        locator: 'signature_base64',
        reason: 'The signature mark itself, plus the identity and timestamp evidence stored beside it. Signature evidence is answered by reproducing what was captured, never by re-rendering it.',
    },
    {
        id: 'agreement-on-behalf-disclaimer',
        category: 'signature',
        source: 'server/lib/db/schema/inspection/agreements.ts',
        locator: 'on_behalf_disclaimer',
        reason: 'A snapshot of the exact disclaimer shown when an authorized agent signs for someone else. Its whole purpose is to record what that person was shown, so a translated variant would answer a different question than the one a dispute asks.',
    },
    {
        id: 'report-inspector-signature-block',
        category: 'signature',
        source: 'server/services/inspection/inspection-report.service.ts',
        locator: '_inspector_signature',
        reason: 'The inspector signature block assembled into the published report payload, alongside its verification metadata. Named by path because this file is at its file-size cap with zero headroom and must not grow an import.',
    },
    {
        id: 'pca-signoff-attestation-signature',
        category: 'signature',
        source: 'server/lib/db/schema/pca-compliance.ts',
        locator: 'signature_ref',
        reason: 'The ASTM dual sign-off signature over the canonical attestation payload. The signature is computed over exact bytes, so any re-rendering of the attested text breaks verification as well as meaning.',
    },

    // ── acknowledgements ─────────────────────────────────────────────────────
    {
        id: 'starter-agreement-client-acknowledgment',
        category: 'acknowledgement',
        source: 'server/services/starter-content/fixtures/agreement-template.ts',
        locator: 'Client Acknowledgment',
        reason: 'The clause where the client states the inspector is not an insurer, guarantor or warrantor. An acknowledgement is a statement made BY the signer; the platform may not restate it for them in other words.',
    },
    {
        id: 'pca-attestation-payload',
        category: 'acknowledgement',
        source: 'server/lib/pca-attestation.ts',
        locator: 'buildAttestationPayload',
        reason: 'Builds the canonical text the field observer and PCR reviewer attest to under ASTM responsible control. It is signed byte-for-byte, so the attested wording is fixed by construction and any translation is a different attestation.',
    },
];
