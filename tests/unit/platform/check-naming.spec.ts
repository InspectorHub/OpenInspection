/**
 * Unit tests for the boolean-column naming gate.
 *
 * Tests the exported `findNamingViolations` function from
 * `scripts/check-naming.mjs` using string fixtures. Per CLAUDE.md "Schema
 * Rules" → Naming (#227), every `integer(..., { mode: 'boolean' })` SQL column
 * name MUST start with `is_`/`has_`. The gate inspects only the SQL-name
 * string, not the camelCase JS property.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Load the exported function from the .mjs script at runtime, inside beforeAll
// (see check-timestamps.spec.ts for why the import is deferred).
let findNamingViolations: (source: string, filename: string) => string[];

beforeAll(async () => {
    const scriptPath = path.resolve(
        import.meta.dirname ?? path.join(process.cwd()),
        '../../../scripts/check-naming.mjs',
    );
    // @vite-ignore — load the .mjs via native Node import; vitest's transform
    // cannot process this script (esbuild target) and throws a SyntaxError.
    ({ findNamingViolations } = await import(/* @vite-ignore */ pathToFileURL(scriptPath).href));
});

describe('check-naming gate', () => {
    it('passes an is_ boolean column', () => {
        const src = `active: integer('is_active', { mode: 'boolean' }).notNull(),`;
        expect(findNamingViolations(src, 'x.ts')).toEqual([]);
    });
    it('passes a has_ boolean column', () => {
        const src = `x: integer('has_sender_attached', { mode: 'boolean' }),`;
        expect(findNamingViolations(src, 'x.ts')).toEqual([]);
    });
    it('flags a bare boolean column name', () => {
        const src = `active: integer('active', { mode: 'boolean' }).notNull(),`;
        expect(findNamingViolations(src, 'x.ts')).toHaveLength(1);
    });
    it('flags a verb-prefixed boolean (enable_/block_/show_)', () => {
        const src = [
            `enableRepairList: integer('enable_repair_list', { mode: 'boolean' }),`,
            `blockUnpaid: integer('block_unpaid', { mode: 'boolean' }),`,
            `showEstimates: integer('show_estimates', { mode: 'boolean' }),`,
        ].join('\n');
        expect(findNamingViolations(src, 'x.ts')).toHaveLength(3);
    });
    it('does NOT flag non-boolean integer columns', () => {
        const src = `sortOrder: integer('sort_order').notNull().default(0),`;
        expect(findNamingViolations(src, 'x.ts')).toEqual([]);
    });
    it('respects // naming-lint-ok exemption', () => {
        const src = `legacyFlag: integer('active', { mode: 'boolean' }), // naming-lint-ok: frozen legacy column`;
        expect(findNamingViolations(src, 'x.ts')).toEqual([]);
    });
});
