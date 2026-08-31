/**
 * Unit tests for the tenant-scoping anti-drift gate.
 *
 * Tests the exported `findUnscopedByIdQueries` function from
 * `scripts/check-tenant-scoping.mjs` using string fixtures.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Load the exported function from the .mjs script at runtime, inside beforeAll.
// A top-level `await import(...)` here fails the vitest/esbuild transform
// ("Invalid or unexpected token"); deferring it into an async hook avoids the
// top-level await while still letting Node natively load the .mjs via a file URL.
let findUnscopedByIdQueries: (source: string, tables: Set<string>) => Array<{ line: number; context: string }>;
let buildTenantTableIdents: (schemaDir: string) => Set<string>;

beforeAll(async () => {
    const scriptPath = path.resolve(
        import.meta.dirname ?? path.join(process.cwd()),
        '../../../scripts/check-tenant-scoping.mjs',
    );
    // @vite-ignore — load the .mjs via native Node import; vitest's transform
    // cannot process this script (esbuild target) and throws a SyntaxError.
    ({ findUnscopedByIdQueries, buildTenantTableIdents } = await import(/* @vite-ignore */ pathToFileURL(scriptPath).href));
});

// A small tenant-scoped table set for fixture tests
const TABLES = new Set(['inspections', 'contacts', 'templates', 'agreements']);

describe('findUnscopedByIdQueries', () => {
    it('returns a hit when .where(eq(TABLE.id, ...)) has no tenantId in same expression', () => {
        const source = `
const row = await db.select().from(inspections)
    .where(eq(inspections.id, inspectionId))
    .get();
`;
        const hits = findUnscopedByIdQueries(source, TABLES);
        expect(hits).toHaveLength(1);
        // source starts with \n so the first non-empty line is 2, .where( is line 3
        expect(hits[0].line).toBe(3);
        expect(hits[0].context).toContain('.where(');
    });

    it('returns no hit when .where() contains both TABLE.id and tenantId', () => {
        const source = `
const row = await db.select().from(inspections)
    .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
    .get();
`;
        const hits = findUnscopedByIdQueries(source, TABLES);
        expect(hits).toHaveLength(0);
    });

    it('returns no hit when TABLE.id appears as a value (2nd arg) not as the scoped column', () => {
        // inspections.id used as a value in a JOIN condition, not as eq(inspections.id, ...)
        const source = `
const row = await db.select().from(contacts)
    .innerJoin(inspections, eq(contacts.inspectionId, inspections.id))
    .where(eq(contacts.tenantId, tenantId))
    .get();
`;
        const hits = findUnscopedByIdQueries(source, TABLES);
        expect(hits).toHaveLength(0);
    });

    it('returns no hit when tenant_id (snake_case) is present', () => {
        const source = `
const row = await db.select().from(contacts)
    .where(and(eq(contacts.id, id), sql\`tenant_id = \${tenantId}\`))
    .get();
`;
        const hits = findUnscopedByIdQueries(source, TABLES);
        expect(hits).toHaveLength(0);
    });

    it('correctly uses bracket-balanced extraction (does not bleed into next statement)', () => {
        // The .where( on line 2 contains only tenantId — should produce no hit.
        // The second .where( on line 5 contains inspections.id but no tenantId.
        const source = `
const rows = await db.select().from(inspections)
    .where(eq(inspections.tenantId, tenantId))
    .all();
const single = await db.select().from(inspections)
    .where(eq(inspections.id, id))
    .get();
`;
        const hits = findUnscopedByIdQueries(source, TABLES);
        // Only the SECOND .where( (line 6 due to leading \n) should be flagged
        expect(hits).toHaveLength(1);
        expect(hits[0].line).toBe(6);
    });

    it('returns no hit for tables not in the tenant-scoped set', () => {
        // `users` is intentionally excluded from the check
        const source = `
const row = await db.select().from(users)
    .where(eq(users.id, userId))
    .get();
`;
        // users is NOT in TABLES
        const hits = findUnscopedByIdQueries(source, TABLES);
        expect(hits).toHaveLength(0);
    });

    it('returns no hit for an empty tenant table set', () => {
        const source = `
const row = await db.select().from(inspections)
    .where(eq(inspections.id, inspectionId))
    .get();
`;
        const hits = findUnscopedByIdQueries(source, new Set());
        expect(hits).toHaveLength(0);
    });

    it('handles multi-line .where(and(...)) correctly', () => {
        const unscopedSource = `
await db.update(agreements)
    .set({ status: 'signed' })
    .where(and(
        eq(agreements.id, envelopeId),
        sql\`status NOT IN ('signed','expired')\`,
    ));
`;
        const hits = findUnscopedByIdQueries(unscopedSource, TABLES);
        expect(hits).toHaveLength(1);
        expect(hits[0].context).toContain('.where(and(');
    });

    it('handles schema.TABLE.id pattern (namespaced import)', () => {
        const source = `
const row = await db.select().from(schema.agreements)
    .where(eq(schema.agreements.id, envelopeId))
    .get();
`;
        const hits = findUnscopedByIdQueries(source, TABLES);
        expect(hits).toHaveLength(1);
    });
});

/**
 * The classifier — which tables the gate treats as tenant-scoped at all.
 *
 * ⚠️ THIS IS THE HALF THAT WAS WRONG, AND THE HALF NOTHING COULD REACH. It read
 * a fixed 80 lines forward from each `sqliteTable` declaration looking for a
 * `tenant_id` column, which runs straight past the end of a short table into
 * whatever is declared next. `marketplace_libraries` — the platform catalogue,
 * which carries no tenant_id and holds the same rows for every workspace — was
 * classified tenant-scoped by borrowing the column of the table below it, and
 * every by-id read of the catalogue was then reported as a cross-tenant leak.
 *
 * Every test above passed throughout, because `findUnscopedByIdQueries` takes
 * its table set as an argument and was always handed a correct one by hand.
 */
describe('buildTenantTableIdents', () => {
    let dir: string;

    beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), 'oi-scope-')); });
    afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

    it('does NOT borrow the tenant_id of the table declared after a long one', () => {
        // The regression in miniature: a global table with a long body, and a
        // tenant-scoped one starting inside the old 80-line window.
        const filler = Array.from({ length: 70 }, (_, i) => `  col${i}: text('col${i}'),`);
        const source = [
            "export const globalCatalogue = sqliteTable('global_catalogue', {",
            "  id: text('id').primaryKey(),",
            ...filler,
            '});',
            '',
            "export const scopedThing = sqliteTable('scoped_thing', {",
            "  id: text('id').primaryKey(),",
            "  tenantId: text('tenant_id').notNull(),",
            '});',
        ].join('\n');
        writeFileSync(path.join(dir, 'fixture.ts'), source, 'utf8');

        const idents = buildTenantTableIdents(dir);

        // Both directions, so neither can pass on a classifier that returns
        // nothing at all or everything at all.
        expect(idents.has('scopedThing')).toBe(true);
        expect(idents.has('globalCatalogue')).toBe(false);
    });

    it('the real schema keeps the platform catalogue out and the imports in', () => {
        // The fixture proves the shape; this proves the actual pair that was
        // misclassified, so a future reordering of the schema file cannot
        // reintroduce it silently.
        const schemaDir = path.resolve(
            import.meta.dirname ?? process.cwd(),
            '../../../server/lib/db/schema',
        );
        const idents = buildTenantTableIdents(schemaDir);

        expect(idents.size).toBeGreaterThan(50);          // it really read the schema
        expect(idents.has('tenantLibraryImports')).toBe(true);
        expect(idents.has('marketplaceLibraries')).toBe(false);
    });
});
