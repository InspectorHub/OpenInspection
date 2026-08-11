/**
 * Marketplace library fixtures — globally seeded entries available to all
 * tenants via the marketplace import flow.
 *
 * The marketplace_libraries table is intentionally NOT tenant-scoped — it
 * is a catalogue of importable content. Idempotency in the starter-content
 * seeder is enforced by `(name)` uniqueness; running the seed on a system
 * that already has these libraries is a no-op.
 */

export interface StarterMarketplaceLibraryFixture {
    name:      string;
    kind:      'comments' | 'templates';
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
