/**
 * The ONE list of booking event_types, aligned with the seeded inspection
 * templates and the seeded service catalogue.
 *
 * There used to be two lists. This one seeded three `starter_*` types at
 * provisioning; `server/data/event-type-seeds.ts` held five more behind the
 * manual bulk-seed endpoint, despite its own header claiming they were "seeded
 * on every new tenant" — `bulkSeed` had exactly one caller and it was a button.
 * The two disagreed: `starter_sewer_scope` and `sewer_scope` were one
 * real-world thing under two slugs, and a tenant who provisioned and then
 * pressed the button got both.
 *
 * They are merged here, keeping the bare `sewer_scope` slug because the other
 * four bare slugs are what the services catalogue and the settings UI already
 * reference. `starter_standard_home` and `starter_pre_listing` keep their names
 * — they had no counterpart, so renaming them would be churn, and slugs are
 * stable identifiers.
 *
 * Price + duration are starting points; the user edits each row before
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
        slug:               'sewer_scope',
        defaultDurationMin: 60,
        defaultPriceCents:  25000,
        color:              '#f59e0b',
        sortOrder:          30,
    },
    // The radon pair is why services carry default event-type slugs at all: a
    // radon test is two visits, and the second one — the pickup, ≥48h later —
    // is the thing that otherwise lives only in the inspector's head.
    {
        name:               'Radon Drop-off',
        slug:               'radon_dropoff',
        defaultDurationMin: 15,
        defaultPriceCents:  0,
        color:              '#10b981',
        sortOrder:          40,
    },
    {
        name:               'Radon Pickup',
        slug:               'radon_pickup',
        defaultDurationMin: 15,
        defaultPriceCents:  0,
        color:              '#10b981',
        sortOrder:          50,
    },
    {
        name:               'Mold Test',
        slug:               'mold_test',
        defaultDurationMin: 30,
        defaultPriceCents:  15000,
        color:              '#a855f7',
        sortOrder:          60,
    },
    {
        name:               'Water Test',
        slug:               'water_test',
        defaultDurationMin: 20,
        defaultPriceCents:  12500,
        color:              '#0ea5e9',
        sortOrder:          70,
    },
];
