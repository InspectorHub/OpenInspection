// Spec 4D — default event types seeded on every new tenant.
// Slugs are stable identifiers — never rename. Names are display-only and may be customized per tenant.

export const EVENT_TYPE_SEEDS = [
    { slug: 'radon_dropoff', name: 'Radon Drop-off', defaultDurationMin: 15, defaultPriceCents: 0,     color: '#10b981', sortOrder: 10 },
    { slug: 'radon_pickup',  name: 'Radon Pickup',   defaultDurationMin: 15, defaultPriceCents: 0,     color: '#10b981', sortOrder: 20 },
    { slug: 'mold_test',     name: 'Mold Test',      defaultDurationMin: 30, defaultPriceCents: 15000, color: '#a855f7', sortOrder: 30 },
    { slug: 'water_test',    name: 'Water Test',     defaultDurationMin: 20, defaultPriceCents: 12500, color: '#0ea5e9', sortOrder: 40 },
    { slug: 'sewer_scope',   name: 'Sewer Scope',    defaultDurationMin: 60, defaultPriceCents: 25000, color: '#f59e0b', sortOrder: 50 },
] as const;
