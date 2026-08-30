/**
 * Marketplace library fixtures — globally seeded entries available to all
 * tenants via the marketplace import flow.
 *
 * The marketplace_libraries table is intentionally NOT tenant-scoped — it
 * is a catalogue of importable content. Idempotency in the starter-content
 * seeder is enforced by `(name)` uniqueness; running the seed on a system
 * that already has these libraries is a no-op.
 *
 * THE PACK IS DERIVED, NOT RESTATED. Its rows, its category list and its count
 * all come from `CANNED_COMMENTS` — the same 250 entries the starter-content
 * service seeds directly into a new trial tenant. Two hand-maintained copies of
 * one library is how they drift, and this file is the proof: it shipped with
 * `entries: []` under a key the importer does not read (`parseLibraryComments`
 * reads `comments`), so the catalogue advertised a featured pack that imported
 * as ZERO ROWS. Its prose was wrong in three further ways that nobody could see
 * while the array was empty — it named a severity vocabulary the product does
 * not use ("satisfactory / monitor / defect" against the canonical
 * good / marginal / significant), claimed six categories where the data has
 * thirteen, and called 250 entries "small".
 */
import { CANNED_COMMENTS } from './canned-comments';
import trecRei76 from '../../../data/seed-templates/trec-rei-7-6.json';
import flCitizensRoof from '../../../data/seed-templates/fl-citizens-roof-rcf-1.json';
import flCitizens4point from '../../../data/seed-templates/fl-citizens-4point-insp4pt.json';

export interface StarterMarketplaceLibraryFixture {
    name:      string;
    /**
     * Which local table an import writes, and how an un-import undoes it. The
     * database enum has carried three values since `statutory` arrived; this
     * type carried two, so the one kind that most needed a catalogue entry was
     * the one no fixture could express.
     */
    kind:      'comments' | 'templates' | 'statutory';
    semver:    string;
    schema:    unknown;
    changelog: string;
    featured:  boolean;
    /**
     * The state or country whose rules the pack is written to, or absent when it
     * is written to none.
     *
     * An exact-match browse filter and the only column that can say a pack is
     * not for everybody. Set on a statutory entry because a jurisdiction is what
     * a statutory form IS: an inspector in Ohio should be able to tell at a
     * glance, and the filter exists on the API already.
     */
    jurisdiction?: string;
}

/**
 * One pack entry, in the shape `parseLibraryComments` returns and
 * `MarketplaceService.insertLibraryComments` consumes.
 *
 * `category` becomes `section`: on a comment row `section` is the label a
 * library organises by (Roof, Electrical, …), while `category` carries a
 * different, independently-read vocabulary. `itemLabel` is deliberately dropped
 * — the import writes no item label, so carrying one here would promise a
 * precision the import does not deliver.
 */
const STARTER_PACK_COMMENTS = CANNED_COMMENTS.map((c) => ({
    text:    c.text,
    section: c.category,
    rating:  c.severity,
}));

/** Sorted for a stable description; `Set` preserves insertion, not order. */
const STARTER_PACK_SECTIONS = [...new Set(STARTER_PACK_COMMENTS.map((c) => c.section))].sort();

export const MARKETPLACE_LIBRARIES: ReadonlyArray<StarterMarketplaceLibraryFixture> = [
    {
        name:      'Starter Comment Pack',
        kind:      'comments',
        semver:    '1.0.0',
        schema:    {
            description:
                `${STARTER_PACK_COMMENTS.length} pre-written inspection comments spanning ` +
                `${STARTER_PACK_SECTIONS.join(', ')}, each classified good, marginal or ` +
                'significant. Use as a baseline; edit and extend per your jurisdiction ' +
                'and inspection style.',
            comments: STARTER_PACK_COMMENTS,
        },
        changelog: 'Initial trial-onboarding starter library.',
        featured:  true,
    },
    {
        // A statutory package is here rather than in `template-seed.service.ts`'s
        // auto-seed list on purpose: a statutory template renders onto the
        // authority's own PDF, which this repository does not carry, so handing
        // one to every new workspace would mint a template that cannot produce
        // anything. The marketplace install path refuses exactly that
        // (`assertStatutoryInstallable`) and tells the operator which file to
        // upload and where. Installing is a decision an operator makes; seeding
        // is not.
        //
        // ⚠️ THREE OF THE FOUR PUBLISHED REVISIONS ARE DECLARED HERE, NOT FOUR.
        // `PUBLISHED_FORM_VERSIONS` carries `tx_trec_rei_7_6`,
        // `fl_citizens_4point`, `fl_citizens_roof` and `fl_oir_b1_1802`; this
        // catalogue declares the first three. `fl_oir_b1_1802` is not waiting on
        // a line in this file.
        //
        // A `kind: 'statutory'` entry's `schema` IS A TEMPLATE: sections, items,
        // and a `statutoryForm` declaration binding each of the form's field
        // names to one of them (`assertStatutorySchema` validates exactly that,
        // and `bindings: {}` would install a pack that produces a blank official
        // document). Publishing a revision says which PDF and where each value
        // is drawn; a catalogue entry additionally has to ask the inspector the
        // form's questions, in the form's own printed wording — 95 of them on
        // the four-point form and 96 on the 1802. The signed candidates carry
        // coordinates and field names; they do not carry those printed labels,
        // so a template cannot be generated from them and inventing the wording
        // would put a question to an inspector that the authority never asked.
        //
        // So that pack is template-authoring work with the forms in hand, not a
        // fixture edit, and until it is done a workspace gets the correct answer
        // for the 1802: the revision exists and nothing declares it.
        name:      trecRei76.name,
        kind:      'statutory',
        /**
         * ⚠️ BUMP THIS WHENEVER `trec-rei-7-6.json` CHANGES, and never otherwise.
         *
         * `seedMarketplaceLibraries` refreshes a row exactly when this string
         * differs from the one already in the database, and the "update
         * available" badge is the same equality test against what a workspace
         * imported. So a corrected binding that ships without a bump here
         * reaches no deployment that already installed the pack, and nobody is
         * told: their template keeps producing the document with the old
         * binding, and every surface reports success.
         *
         * It is NOT the authority's revision label — that lives in the
         * declaration inside the schema and answers a different question (which
         * printed form these bindings were authored against). A new TREC
         * revision is a new field map and a new pack; a bump here is us
         * correcting our own work against the same printed form.
         */
        semver:    '1.0.0',
        // The template document itself, imported rather than restated. It is the
        // single source both the local seed file and this catalogue entry read,
        // because two hand-maintained copies of one 41-section form is how the
        // last one drifted into a document with thirteen blank sections.
        schema:    trecRei76.schema,
        changelog: 'First catalogue release of the Texas TREC REI 7-6 package.',
        // Not featured. Featured is the top of the shelf for everyone, and this
        // pack is useful to inspectors in one state.
        featured:  false,
        jurisdiction: 'TX',
    },
    {
        // Citizens Property Insurance Corporation's Roof Inspection Form. Same
        // shape as the Texas entry above and for the same reasons; what differs
        // is what the form asks and how the template carries it.
        //
        // ⚠️ ITS TWELVE CHOICE QUESTIONS DO NOT SHARE ONE VOCABULARY, so there
        // is no `ratingSystem` here and there must not be one. TREC gets away
        // with a single embedded rating because all 41 of its items ask the same
        // question; this form asks twelve different ones over fourteen values
        // (`full_replacement`, `satisfactory`, `cupping_curling`, `yes`, …), and
        // each is an `item_attribute` whose stored value is the answer. Those
        // stored values are the field map's own `whenValue` strings, character
        // for character: `render.ts` matches with `===` and nothing normalises,
        // so a template storing the printed label instead ("Full replacement")
        // produces a completely blank official form with every gate green.
        //
        // ⚠️ ONE OF THE FORM'S 36 BLANKS IS DELIBERATELY UNBOUND —
        // `inspector_title`, which this product has no source for. It was three:
        // `inspector_license_type` and `inspector_signature_date` were unbound
        // for the same reason and the reason was answered rather than lived
        // with — both now read a column somebody fills in, and neither is an
        // alias of a column that already existed. The reasoning for the one
        // that is left is in
        // `server/data/seed-templates/fl-citizens-roof-rcf-1.gaps.md`, because
        // on a printed form "left blank on purpose" and "forgotten" look
        // identical and only that file can tell them apart.
        name:      flCitizensRoof.name,
        kind:      'statutory',
        // Bump whenever `fl-citizens-roof-rcf-1.json` changes, and never
        // otherwise — the reasoning is on the Texas entry above and applies
        // unchanged. It is OUR version of these bindings, not Citizens'
        // revision label, which is `RCF-1 03 25` and lives in the declaration.
        semver:    '1.1.0',
        schema:    flCitizensRoof.schema,
        changelog: 'Binds the signature date and the licence type, and takes every damage sign '
            + 'the form asks for rather than one.',
        featured:  false,
        jurisdiction: 'FL',
    },
    {
        // Citizens Property Insurance Corporation's 4-Point Inspection Form —
        // the largest of the three, and the one the other two are read against.
        // Same shape as the entries above and for the same reasons; what differs
        // is what the form asks and how the template carries it.
        //
        // ⚠️ FORTY-FOUR CHOICE QUESTIONS, FIFTY-FIVE DISTINCT VALUES, AND NO
        // AXIS BETWEEN THEM, so there is no `ratingSystem` here and there must
        // not be one. Each question is an `item_attribute` whose stored value is
        // the field map's own `whenValue`, character for character:
        // `satisfactory`, `circuit_breaker`, `n_a`, `cupping_curling`.
        // `render.ts` matches with `===` and nothing normalises, so a template
        // storing the printed label instead produces a completely blank official
        // form with every gate green.
        //
        // ⚠️ ITS ROOF BLOCK IS NOT THE ROOF FORM'S. The two Citizens forms print
        // the same twelve roof questions and word three of them differently
        // (`Overall condition:` here against `Overall condition` there). The
        // WORDING is each form's own; the stored VALUES are deliberately
        // identical, so one inspection can feed both forms without answering
        // twice.
        //
        // ⚠️ ONE OF THE FORM'S 95 BLANKS IS DELIBERATELY UNBOUND —
        // `inspector_title`, the same box the roof pack cannot fill and for the
        // same reason: this product has no source for a job title. The reasoning,
        // and the smaller gaps behind the blanks that ARE bound, are in
        // `server/data/seed-templates/fl-citizens-4point-insp4pt.gaps.md`,
        // because on a printed form "left blank on purpose" and "forgotten" look
        // identical and only that file can tell them apart.
        name:      flCitizens4point.name,
        kind:      'statutory',
        // Bump whenever `fl-citizens-4point-insp4pt.json` changes, and never
        // otherwise — the reasoning is on the Texas entry above and applies
        // unchanged. It is OUR version of these bindings, not Citizens' revision
        // label, which is `Insp4pt 03 25` and lives in the declaration.
        semver:    '1.0.0',
        schema:    flCitizens4point.schema,
        changelog: 'First catalogue release of the Florida Citizens 4-Point package.',
        featured:  false,
        jurisdiction: 'FL',
    },
];
