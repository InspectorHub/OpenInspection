/**
 * Four starter tags per the Trial Sample-Data Mode spec (2026-05-20).
 *
 * The `tags.color` column is plain TEXT (no enum) — colors are display
 * tokens consumed by the inspector UI. Names chosen to be distinct from
 * the legacy TagService.SEED_TAGS so both sets can coexist if a tenant is
 * seeded through both paths.
 */

export interface StarterTagFixture {
    name:  string;
    color: string;
}

export const TAGS: ReadonlyArray<StarterTagFixture> = [
    { name: 'Safety concern',    color: 'red'    },
    { name: 'Needs maintenance', color: 'yellow' },
    { name: 'Cosmetic',          color: 'gray'   },
    { name: 'Follow-up needed',  color: 'blue'   },
];
