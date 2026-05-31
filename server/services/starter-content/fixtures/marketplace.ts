/**
 * Marketplace library fixtures — globally seeded entries available to all
 * tenants via the marketplace import flow.
 *
 * The marketplace_libraries table is intentionally NOT tenant-scoped — it
 * is a catalogue of importable content. Idempotency in the starter-content
 * seeder is enforced by `(name)` uniqueness; running the seed on a system
 * that already has these libraries is a no-op.
 *
 * The starter-content flow only seeds a small bootstrap catalogue. The
 * legacy `scripts/seed-marketplace.js` script remains the source of the
 * full curated template catalogue (residential, TREC, commercial, etc.)
 * and is run as a deploy-time operation.
 */

export interface StarterMarketplaceLibraryFixture {
    name:      string;
    kind:      'comments' | 'snippets';
    semver:    string;
    schema:    unknown;
    changelog: string;
    featured:  boolean;
}

export const MARKETPLACE_LIBRARIES: ReadonlyArray<StarterMarketplaceLibraryFixture> = [
    {
        name:      'Starter Comment Pack',
        kind:      'comments',
        semver:    '1.0.0',
        schema:    {
            description:
                'A small starter pack of pre-written inspection comments — covers ' +
                'Roof, Electrical, Plumbing, HVAC, Interior, and Exterior with ' +
                'satisfactory / monitor / defect severities. Use as a baseline; ' +
                'edit and extend per your jurisdiction and inspection style.',
            entries: [],
        },
        changelog: 'Initial trial-onboarding starter library.',
        featured:  true,
    },
];
