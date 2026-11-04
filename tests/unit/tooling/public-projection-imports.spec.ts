/**
 * Two shapes the public-projection detector used to read as clean and now reads:
 *  - a schema imported from another module that passes unknown keys through, parsed in a public route;
 *  - a response helper whose value is stored in a const and returned later.
 * Each rejected case is paired with a near-identical accepted one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error -- plain .mjs helper, no types alongside it (same as the other tooling specs).
import { detectPublicProjection } from '../../../scripts/lib/public-projection-detect.mjs';
// @ts-expect-error -- plain .mjs helper.
import { makeImportReader } from '../../../scripts/lib/public-projection-imports.mjs';

interface Hit { line: number; rule: string }
const NL = String.fromCharCode(10);
const route = (...body: string[]) => ['app.get("/x", async (c) => {', '  const row = await db.get();', ...body, '});'].join(NL);

let root = '';
beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'projection-imports-'));
    mkdirSync(join(root, 'routes'));
    mkdirSync(join(root, 'schemas'));
    writeFileSync(join(root, 'schemas', 'strict.ts'), 'export const StrictSchema = z.object({ id: z.string() }).strict();' + NL);
    writeFileSync(join(root, 'schemas', 'loose.ts'), 'export const LooseSchema = z.object({ id: z.string() }).passthrough();' + NL);
    writeFileSync(join(root, 'schemas', 'derived.ts'), 'import { LooseSchema } from "./loose";' + NL + 'export const DerivedSchema = LooseSchema.extend({ name: z.string() }).openapi("Derived");' + NL);
    writeFileSync(join(root, 'schemas', 'derived-strict.ts'), 'import { StrictSchema } from "./strict";' + NL + 'export const DerivedStrictSchema = StrictSchema.extend({ name: z.string() });' + NL);
    writeFileSync(join(root, 'schemas', 'inner-unknown.ts'), 'export const OpaqueFieldSchema = z.object({ id: z.string(), blob: z.unknown() });' + NL);
    writeFileSync(join(root, 'schemas', 'cycle-a.ts'), 'import { CycleBSchema } from "./cycle-b";' + NL + 'export const CycleASchema = CycleBSchema.extend({});' + NL);
    writeFileSync(join(root, 'schemas', 'cycle-b.ts'), 'import { CycleASchema } from "./cycle-a";' + NL + 'export const CycleBSchema = CycleASchema.extend({});' + NL);
});
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

const run = (src: string) => detectPublicProjection(src, 'routes/x.ts', { readImport: makeImportReader(root, 'routes/x.ts') }) as { violations: Hit[] };
const rulesFor = (schema: string, file: string) => run([`import { ${schema} } from "../schemas/${file}";`, route(`  return c.json({ data: ${schema}.parse(row) }, 200);`)].join(NL)).violations.map((v) => v.rule);

describe('an imported schema', () => {
    it('that passes unknown keys through is not a projection, and a strict one is (near-identical pair)', () => {
        expect(rulesFor('LooseSchema', 'loose')).toEqual(['unprojected-response']);
        expect(rulesFor('StrictSchema', 'strict')).toEqual([]);
    });

    it('is followed through the schema it is built from, passthrough or strict', () => {
        expect(rulesFor('DerivedSchema', 'derived')).toEqual(['unprojected-response']);
        expect(rulesFor('DerivedStrictSchema', 'derived-strict')).toEqual([]);
    });

    it('is not rejected for one opaque field inside it (that is a value, not a row)', () => {
        expect(rulesFor('OpaqueFieldSchema', 'inner-unknown')).toEqual([]);
    });

    it('is taken at its word when the module cannot be read, and a cycle of imports ends', () => {
        const unreadable = run(['import { GoneSchema } from "../schemas/missing";', route('  return c.json({ data: GoneSchema.parse(row) }, 200);')].join(NL));
        expect(unreadable.violations).toEqual([]);
        const pkg = run(['import { PkgSchema } from "some-package";', route('  return c.json({ data: PkgSchema.parse(row) }, 200);')].join(NL));
        expect(pkg.violations).toEqual([]);
        expect(rulesFor('CycleASchema', 'cycle-a')).toEqual([]);
    });

    it('is taken at its word when the detector is given no reader (the old behaviour)', () => {
        const src = ['import { LooseSchema } from "../schemas/loose";', route('  return c.json({ data: LooseSchema.parse(row) }, 200);')].join(NL);
        expect((detectPublicProjection(src, 'routes/x.ts') as { violations: Hit[] }).violations).toEqual([]);
    });
});

describe('a response helper whose value is stored and returned later', () => {
    const rules = (src: string) => (detectPublicProjection(src, 'route.ts') as { violations: Hit[] }).violations.map((v) => v.rule);

    it('is reported when the const is returned, and not when it is only stored (near-identical pair)', () => {
        expect(rules(route('  const res = await created(c, row);', '  return res;'))).toEqual(['unknown-response-helper']);
        expect(rules(route('  const res = created(c, row);', '  return res;'))).toEqual(['unknown-response-helper']);
        expect(rules(route('  const res = await created(c, row);', '  return c.json({ data: null }, 200);'))).toEqual([]);
    });

    it('is not reported for a read of the request, a projection or a function declared in the file', () => {
        expect(rules(route('  const db = getDrizzle(c, row);', '  return db;'))).toEqual([]);
        expect(rules(route('  const view = projectFields(c, row);', '  return view;'))).toEqual([]);
        expect(rules('function created(c, v) { return c.json({ data: { id: v.id } }, 201); }' + NL + route('  const res = created(c, row);', '  return res;'))).toEqual([]);
    });

    it('is not followed when the name is returned from another function, or is a let', () => {
        expect(rules(route('  const res = created(c, row);', '  const later = () => res;', '  return c.json({ data: null }, 200);'))).toEqual([]);
        expect(rules(route('  let res = created(c, row);', '  return res;'))).toEqual([]);
    });
});
