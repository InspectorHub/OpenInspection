/**
 * #23 — the classification the segmenter reads.
 *
 * A report payload is a tree of VALUES. The non-translatable registry
 * (`server/lib/legal/non-translatable-manifest.ts`) is a register of KINDS.
 * This module is the join between them: every top-level key the report payload
 * carries, answered with one of three dispositions and a reason.
 *
 * ## Why an enumeration of PERMITTED keys, and never a filter
 *
 * A filter is a deny-list. A deny-list written against a payload shape re-opens
 * silently the moment the payload grows a field, and nothing downstream would
 * notice: the response invariant at the model seam checks segment COUNT, which
 * a widened segment list satisfies perfectly.
 *
 * This is not a hypothetical. The assembled reliance block reaches the payload
 * as `relianceText`. It appeared on no exclusion list anywhere in the tree, and
 * no code path would have kept it out of a translation request. That is the
 * whole argument for the shape of this file: a key with no entry FAILS the
 * totality test rather than defaulting in either direction, so the next field
 * added to the payload cannot become eligible by being forgotten.
 *
 * ## The three dispositions
 *
 * - `convenience_translation` — machine translation is permitted, and what it
 *   produces is delivered under a notice saying the English is the record. It
 *   is never authoritative.
 * - `authoritative_english` — the text IS the instrument, or is evidence of
 *   one. It stays English wherever it is rendered, including inside a
 *   translated deliverable, and that must look deliberate rather than like an
 *   untranslated remnant.
 * - `not_text` — there is no prose here to translate: identifiers, numbers,
 *   dates, enum values, colours, URLs, and vocabularies looked up by id.
 *
 * ## A key-level answer is not enough, so there is a leaf enumeration too
 *
 * `sections` is permitted, and a per-section `disclaimerText` sits three levels
 * inside it — registered instrument text that a key-level answer would have
 * shipped straight to a model. So the fields that may be READ out of a
 * permitted key are enumerated as well, in `PERMITTED_LEAF_FIELDS`, and the
 * segmenter reads nothing else.
 *
 * ⚠️ When in doubt, a key is NOT permitted. Widening is a small, reviewable
 * edit to one entry; narrowing after something has been sent to a provider is
 * not an edit at all.
 */
import type { InspectionReportService } from '../../services/inspection/inspection-report.service';

/** The report payload, named from the service that builds it. */
export type ReportData = Awaited<ReturnType<InspectionReportService['getReportData']>>;

type ReportSpanDisposition =
    | 'convenience_translation'
    | 'authoritative_english'
    | 'not_text';

export interface ReportSpanRegisterEntry {
    /**
     * A top-level key of the report payload.
     *
     * Typed against the payload rather than as a bare string, so an entry for a
     * key that no longer exists is a compile error. The reverse — a payload key
     * with no entry — is what the totality test catches, because a type cannot
     * demand that an array be exhaustive.
     */
    key: keyof ReportData & string;
    disposition: ReportSpanDisposition;
    /** Why. An entry without one is a shrug, including for `not_text`. */
    reason: string;
}

export const REPORT_SPAN_REGISTER: readonly ReportSpanRegisterEntry[] = [
    {
        key: 'inspection',
        disposition: 'not_text',
        reason: 'The inspection row: identifiers, the property address, dates, status and the client and inspector names. An address rendered in another language is a different address, and a name is not translated at all. The prompt interface carries none of this by construction, and widening it is a classification change rather than a plumbing one.',
    },
    {
        key: 'styleProfile',
        disposition: 'not_text',
        reason: 'Design tokens and layout choices — colour values, font ids, density. Nothing here is read as prose by anyone.',
    },
    {
        key: 'inspectorCredentials',
        disposition: 'authoritative_english',
        reason: 'Licence numbers and credential titles as the issuing authority granted them. A translated credential title asserts a qualification nobody awarded, and the number it sits beside can be checked against a public register that only knows the original wording.',
    },
    {
        key: 'amendmentTrail',
        disposition: 'authoritative_english',
        reason: 'The record of what changed on a published report, when, and by whom. It is evidence about the document rather than content of it, and evidence is answered by reproducing what was recorded.',
    },
    {
        key: 'reinspection',
        disposition: 'not_text',
        reason: 'Identifiers, dates and counts linking a re-inspection to its baseline. The baseline prose a reader actually sees is reached through the sections tree, and is classified there.',
    },
    {
        key: 'coverPhotoUrl',
        disposition: 'not_text',
        reason: 'A resolved URL for the report cover image, or null when the inspector has not chosen one.',
    },
    {
        key: 'stats',
        disposition: 'not_text',
        reason: 'Four integers rolling up the findings — total, satisfactory, monitor, defect.',
    },
    {
        key: 'sections',
        disposition: 'convenience_translation',
        reason: 'The findings themselves: section and item names, the inspector free-text notes, the resolved canned information and defect prose, photo captions and repair-item summaries. This is the observational content the feature exists for — it describes a property, it allocates nothing between the parties, and nobody signs it. Not every leaf inside it is permitted; see PERMITTED_LEAF_FIELDS.',
    },
    {
        key: 'outline',
        disposition: 'convenience_translation',
        reason: 'The table-of-contents projection. Its titles are the same strings the sections tree carries, and leaving the contents page English while the body is translated makes the body unnavigable to the one reader the translation is for.',
    },
    {
        key: 'photoMode',
        disposition: 'not_text',
        reason: 'An enum choosing between inline photos and a centralized photo appendix.',
    },
    {
        key: 'photoAppendix',
        disposition: 'convenience_translation',
        reason: 'The flat photo appendix. Only the caption is read: the section title and item label it also carries are the SAME strings already emitted from the sections tree, and sending a string twice invites two different renderings of it. The renderer reuses the sections rendering for those.',
    },
    {
        key: 'ratingLevels',
        disposition: 'not_text',
        reason: 'The rating system: ids, abbreviations, colours and severity buckets, looked up by id from every item in the report. The label is display text, but it is one half of a keyed pair that also appears on each item, and translating one half would let the same rating print two ways in one document. If rating names are to reach a reader in their own language, that is the interface layer of the product, not a per-report model call.',
    },
    {
        key: 'showEstimates',
        disposition: 'not_text',
        reason: 'A boolean deciding whether cost estimates render in the report body.',
    },
    {
        key: 'enableRepairList',
        disposition: 'not_text',
        reason: 'A boolean deciding whether the repair list section renders at all.',
    },
    {
        key: 'enableCustomerRepairExport',
        disposition: 'not_text',
        reason: 'A boolean deciding whether the customer repair export is offered.',
    },
    {
        key: 'reportTimeZone',
        disposition: 'not_text',
        reason: 'An IANA time-zone identifier. It is a lookup key, and rewriting it produces a zone that does not exist.',
    },
    {
        key: 'propertyFacts',
        disposition: 'not_text',
        reason: 'Year built, square footage, foundation type, lot size, bedroom and bathroom counts. Numbers plus a small enum; the labels a reader sees around them are interface copy rendered by the report layer, not values carried here.',
    },
    {
        key: 'reportTier',
        disposition: 'not_text',
        reason: 'An enum naming the report tier, read by the renderer to decide which blocks exist at all.',
    },
    {
        key: 'costTables',
        disposition: 'not_text',
        reason: 'Opinion-of-cost and reserve-schedule rows: money in cents, quantities, years and item ids. A translated figure is a wrong figure, and the descriptions in these rows are cost-estimating shorthand that carries an opinion of value — which is not observational content.',
    },
    {
        key: 'propertyType',
        disposition: 'not_text',
        reason: 'An enum naming the property type, used to gate whole blocks of the payload.',
    },
    {
        key: 'commercialSubtype',
        disposition: 'not_text',
        reason: 'An enum naming the commercial subtype, used to select a metadata preset.',
    },
    {
        key: 'buildingProfile',
        disposition: 'not_text',
        reason: 'A facts strip: preset field ids with their values, units and grouping. The labels come from a fixed preset rather than from anything a person wrote, and the values are numbers, dates and enum ids. Nothing here is an observation.',
    },
    {
        key: 'pcaReport',
        disposition: 'authoritative_english',
        reason: 'The commercial front matter. It mixes ordinary narrative (the general description, the physical-condition summary, the reconnaissance note) with statements that are not narrative at all: the purpose, the scope of work, and the limitations and exceptions block — each of which bounds what may be claimed against the report. The block is classified at its strictest member, because permitting it whole is how a scope limitation reaches a model. Splitting it into permitted and non-permitted fields is a worthwhile change and is a classification change, reviewed as one.',
    },
    {
        key: 'unitInspectionMode',
        disposition: 'not_text',
        reason: 'An enum choosing between tagged findings and per-unit findings.',
    },
    {
        key: 'units',
        disposition: 'not_text',
        reason: 'The unit tree. Labels are building, floor and unit designations — "Building A", "Unit 101" — which are addresses within a property and are identifiers, not descriptions. They are also the join key the condition matrix and the defect counts are read against.',
    },
    {
        key: 'unitConditionMatrix',
        disposition: 'not_text',
        reason: 'A matrix of unit ids against section ids holding rating ids. Every cell is a lookup key.',
    },
    {
        key: 'defectCountsByUnit',
        disposition: 'not_text',
        reason: 'Integer counts keyed by unit id.',
    },
    {
        key: 'samplingDeclaration',
        disposition: 'authoritative_english',
        reason: 'The representative-sampling declaration: what was sampled, what was not, and on what basis. It is a statement of the boundary of the survey, which is what a dispute about coverage turns on, so it is read as written rather than as re-expressed.',
    },
    {
        key: 'isPublished',
        disposition: 'not_text',
        reason: 'A boolean saying whether this report has been published. It gates rendering; it is not read by anyone.',
    },
    {
        key: 'signature',
        disposition: 'authoritative_english',
        reason: 'The inspector signature block and the metadata stored beside it. Signature evidence is answered by reproducing what was captured, never by re-rendering it, and this block is a named subject of the non-translatable registry.',
    },
    {
        key: 'verification',
        disposition: 'authoritative_english',
        reason: 'The verification metadata a holder uses to check the signature — key fingerprint, hash basis, the verification address. It is computed over exact bytes; any other rendering fails verification as well as meaning.',
    },
    {
        key: 'astmConformance',
        disposition: 'authoritative_english',
        reason: 'A conformance determination against a published standard, with the reasons it does or does not conform. Its vocabulary is the standard\'s own, and restating it in other words states a different determination.',
    },
    {
        key: 'reportSignoffs',
        disposition: 'authoritative_english',
        reason: 'Attestations made under responsible control, signed over canonical text. The attested wording is fixed by construction, so any translation is a different attestation.',
    },
    {
        key: 'psq',
        disposition: 'authoritative_english',
        reason: 'The pre-survey questionnaire: answers given by the owner or occupant, recorded as they were given. It is one party stating facts to another, and the platform does not restate it for them.',
    },
    {
        key: 'documentReview',
        disposition: 'authoritative_english',
        reason: 'The record of which documents were requested, received and reviewed, with their own titles. A document\'s title is its identity, and a translated title names a document that was never produced.',
    },
    {
        key: 'relianceText',
        disposition: 'authoritative_english',
        reason: 'The reliance restrictions: who may rely on the report, that it fixes to the date of the site visit, and what the report is not. This is the clause that decides whether a third party has a claim at all. It is the reason this register enumerates rather than filters — it rode inside the report payload the whole time and appeared on no exclusion list anywhere.',
    },
];

/**
 * The ONLY field names the segmenter may read out of each permitted key.
 *
 * Enumerated, for the same reason the keys are. Two of the fields deliberately
 * absent from `sections` are worth naming, because a later reader will wonder:
 *
 *  - `disclaimerText` — the per-section disclaimer. It is a named subject of
 *    the non-translatable registry, and it sits INSIDE a permitted key, which
 *    is the case a key-level answer alone cannot see.
 *  - `limitations` — the per-item limitations tab. It states what a section's
 *    coverage did not include, which is the same kind of statement as the
 *    site-specific reliance clause the registry already holds, one scale down.
 *    It stays English until it is separated from that, and separating it is a
 *    classification change.
 *
 * Also absent: `ratingLabel`, which is the rating vocabulary reached through
 * every item, and every `*Category` / `*Trade` / `*Timeframe` field, which are
 * resolved labels from tenant-configured vocabularies looked up by slug.
 */
export const PERMITTED_LEAF_FIELDS = {
    /** On a section object. */
    section: ['title'],
    /** On an item object inside a section. */
    item: ['label', 'notes', 'notInspectedReason', 'recommendation', 'followupNotes'],
    /** On a resolved information or defect entry inside an item. */
    comment: ['title', 'effectiveComment', 'effectiveLocation'],
    /** On a repair item inside an item. */
    repairItem: ['summary'],
    /** On a photo, wherever one appears. */
    photo: ['caption'],
    /** On the baseline finding a re-inspection item carries. */
    original: ['notes'],
    /** On an outline entry. */
    outline: ['title'],
    /** On a photo-appendix entry. */
    appendix: ['caption'],
} as const satisfies Record<string, readonly string[]>;
