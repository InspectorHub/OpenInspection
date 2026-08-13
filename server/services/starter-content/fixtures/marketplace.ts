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

export interface StarterMarketplaceLibraryFixture {
    name:      string;
    kind:      'comments' | 'templates';
    semver:    string;
    schema:    unknown;
    changelog: string;
    featured:  boolean;
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
];
