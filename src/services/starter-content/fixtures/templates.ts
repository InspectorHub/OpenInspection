/**
 * Three minimal inspection templates seeded into every new trial tenant.
 *
 * Intentionally bare — the goal is "templates exist as a starting point",
 * not "fully populated production templates". Users either populate the
 * sections themselves or import from the marketplace.
 *
 * Schema shape matches the v2 inspection template schema declared in
 * `src/lib/validations/template.schema.ts`. The seeder stringifies before
 * inserting (templates.schema is `text(... mode: 'json')`).
 */

export interface StarterTemplateFixture {
    name:        string;
    description: string;
    schema:      unknown;
}

export const INSPECTION_TEMPLATES: ReadonlyArray<StarterTemplateFixture> = [
    {
        name: 'Residential',
        description:
            'Standard single-family residential inspection — covers exterior, roof, ' +
            'plumbing, electrical, HVAC, interior, and basement / crawlspace.',
        schema: {
            schemaVersion: 2,
            sections: [
                { id: 's_exterior',  title: 'Exterior',              items: [] },
                { id: 's_roof',      title: 'Roof',                  items: [] },
                { id: 's_plumbing',  title: 'Plumbing',              items: [] },
                { id: 's_electrical',title: 'Electrical',            items: [] },
                { id: 's_hvac',      title: 'HVAC',                  items: [] },
                { id: 's_interior',  title: 'Interior',              items: [] },
                { id: 's_basement',  title: 'Basement / Crawlspace', items: [] },
            ],
        },
    },
    {
        name: 'Pre-Listing',
        description:
            'Pre-listing inspection — performed for the seller before going to market.',
        schema: {
            schemaVersion: 2,
            sections: [
                { id: 's_exterior', title: 'Exterior',      items: [] },
                { id: 's_systems',  title: 'Major Systems', items: [] },
                { id: 's_interior', title: 'Interior',      items: [] },
            ],
        },
    },
    {
        name: 'Sewer Scope',
        description:
            'Sewer line camera inspection — 60-minute focused inspection of the main sewer line.',
        schema: {
            schemaVersion: 2,
            sections: [
                { id: 's_sewer', title: 'Sewer Scope', items: [] },
            ],
        },
    },
];
