/**
 * Three booking event_types aligned with the seeded inspection templates.
 * Price + duration are placeholders — the user edits each row before
 * publishing the public booking page.
 *
 * Slugs are stable identifiers — never rename; names are display-only and
 * may be customized per tenant.
 */

export interface StarterEventTypeFixture {
    name:               string;
    slug:               string;
    defaultDurationMin: number;
    defaultPriceCents:  number;
    color:              string;
    sortOrder:          number;
}

export const EVENT_TYPES: ReadonlyArray<StarterEventTypeFixture> = [
    {
        name:               'Standard Home Inspection',
        slug:               'starter_standard_home',
        defaultDurationMin: 180,
        defaultPriceCents:  0,
        color:              '#6366f1',
        sortOrder:          10,
    },
    {
        name:               'Pre-Listing Inspection',
        slug:               'starter_pre_listing',
        defaultDurationMin: 120,
        defaultPriceCents:  0,
        color:              '#22c55e',
        sortOrder:          20,
    },
    {
        name:               'Sewer Scope',
        slug:               'starter_sewer_scope',
        defaultDurationMin: 60,
        defaultPriceCents:  0,
        color:              '#f59e0b',
        sortOrder:          30,
    },
];
