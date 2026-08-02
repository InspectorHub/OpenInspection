/**
 * The starter service catalogue — what a new tenant can actually sell.
 *
 * Production had 43 event types, 7 templates and ZERO services, because
 * starter content seeded templates and event types but never the catalogue.
 * Service lines can only be attached at inspection-create time from a
 * catalogue, so an empty catalogue is why no inspection had ever had one. A
 * product gap, not slow adoption.
 *
 * Three artefacts describing the same thing now line up by construction: each
 * entry names the template it produces and the event-type slugs it implies.
 *
 * **Prices are real starting numbers, not placeholders.** `services.price` is
 * NOT NULL and `inspection_services.price_snapshot` copies it, so "seed the
 * entry with no price" was never available. These are plausible US market
 * rates that a tenant is expected to edit — the settings UI is where they do
 * that, and it should make them easy to find.
 *
 * Event types are referenced by SLUG, not id. Slugs survive a tenant deleting
 * and re-creating a type, they do not depend on seed ordering inside
 * `seedStarterContent`, and an unmatched slug degrades to "propose nothing"
 * rather than to a dangling id.
 */

export interface StarterServiceFixture {
    name:                  string;
    description:           string;
    /** Exact `templates.name` this service produces a report from. */
    templateName:          string;
    priceCents:            number;
    durationMinutes:       number;
    /** `event_types.slug` values this service implies, in visit order. */
    defaultEventTypeSlugs: string[];
    sortOrder:             number;
}

export const STARTER_SERVICES: ReadonlyArray<StarterServiceFixture> = [
    {
        name:                  'Standard Home Inspection',
        description:           'Full residential inspection of the home’s systems and structure.',
        templateName:          'Standard Residential Inspection',
        priceCents:            45000,
        durationMinutes:       180,
        defaultEventTypeSlugs: ['starter_standard_home'],
        sortOrder:             10,
    },
    {
        name:                  'Pre-Listing Inspection',
        description:           'Inspection for a seller preparing to put the home on the market.',
        templateName:          'Pre-Listing Inspection',
        priceCents:            40000,
        durationMinutes:       120,
        defaultEventTypeSlugs: ['starter_pre_listing'],
        sortOrder:             20,
    },
    {
        name:                  'New Construction Pre-Drywall',
        description:           'Inspection before drywall closes the framing, wiring and plumbing in.',
        templateName:          'New Construction Pre-Drywall Inspection',
        priceCents:            50000,
        durationMinutes:       150,
        defaultEventTypeSlugs: [],
        sortOrder:             30,
    },
    {
        name:                  'New Construction Final Walkthrough',
        description:           'Final walkthrough before closing on a newly built home.',
        templateName:          'New Construction Final Walkthrough',
        priceCents:            35000,
        durationMinutes:       120,
        defaultEventTypeSlugs: [],
        sortOrder:             40,
    },
    {
        name:                  'Sewer Scope',
        description:           'Camera inspection of the sewer lateral from the home to the main.',
        templateName:          'Sewer Scope Inspection',
        priceCents:            25000,
        durationMinutes:       60,
        defaultEventTypeSlugs: ['sewer_scope'],
        sortOrder:             50,
    },
    {
        // The reason services carry visits at all. A radon test is a drop-off
        // and a pickup at least 48 hours apart, and the pickup is the one that
        // otherwise lives only in the inspector's head.
        name:                  'Radon Testing',
        description:           'Continuous radon monitor placed and collected at least 48 hours later.',
        templateName:          'Radon Measurement Report',
        priceCents:            15000,
        durationMinutes:       15,
        defaultEventTypeSlugs: ['radon_dropoff', 'radon_pickup'],
        sortOrder:             60,
    },
    {
        name:                  'Mold Inspection',
        description:           'Visual mold assessment with sampling where conditions warrant it.',
        templateName:          'Mold Inspection',
        priceCents:            35000,
        durationMinutes:       90,
        defaultEventTypeSlugs: ['mold_test'],
        sortOrder:             70,
    },
];
