/**
 * Unit tests for the timestamp-normalization gate.
 *
 * Tests the exported `findTimestampViolations` function from
 * `scripts/check-timestamps.mjs` using string fixtures. The DBA review
 * (2026-06-04, see CLAUDE.md "Schema Rules") requires new timestamp columns
 * to be `integer(..., { mode: 'timestamp_ms' })` (epoch milliseconds) — this
 * gate flags bare/seconds/text time columns so drift doesn't creep back in.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

// Load the exported function from the .mjs script at runtime, inside beforeAll.
// A top-level `await import(...)` here fails the vitest/esbuild transform
// ("Invalid or unexpected token"); deferring it into an async hook avoids the
// top-level await while still letting Node natively load the .mjs via a file URL.
let findTimestampViolations: (source: string, filename: string) => string[];

beforeAll(async () => {
    const scriptPath = path.resolve(
        import.meta.dirname ?? path.join(process.cwd()),
        '../../../scripts/check-timestamps.mjs',
    );
    // @vite-ignore — load the .mjs via native Node import; vitest's transform
    // cannot process this script (esbuild target) and throws a SyntaxError.
    ({ findTimestampViolations } = await import(/* @vite-ignore */ pathToFileURL(scriptPath).href));
});

describe('check-timestamps gate', () => {
    it('passes a correct timestamp_ms column', () => {
        const src = `createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),`;
        expect(findTimestampViolations(src, 'x.ts')).toEqual([]);
    });
    it('flags a bare *_at integer with no mode', () => {
        const src = `createdAt: integer('created_at').notNull(),`;
        expect(findTimestampViolations(src, 'x.ts')).toHaveLength(1);
    });
    it("flags mode: 'timestamp' (seconds)", () => {
        const src = `createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),`;
        expect(findTimestampViolations(src, 'x.ts')).toHaveLength(1);
    });
    it("flags text datetime('now')", () => {
        const src = `createdAt: text('created_at').notNull().default(sql\`(datetime('now'))\`),`;
        expect(findTimestampViolations(src, 'x.ts')).toHaveLength(1);
    });
    it("flags a text('*_at') column (ISO-string timestamp)", () => {
        const src = `confirmedAt: text('confirmed_at'),`;
        expect(findTimestampViolations(src, 'x.ts')).toHaveLength(1);
    });
    it("does NOT flag calendar/clock text columns (_date / _time / date)", () => {
        const src = [
            `dueDate: text('due_date'),`,
            `closingDate: text('closing_date'),`,
            `startTime: text('start_time').notNull(),`,
            `date: text('date').notNull(),`,
        ].join('\n');
        expect(findTimestampViolations(src, 'x.ts')).toEqual([]);
    });
    it('respects // ts-lint-ok exemption', () => {
        const src = `retainUntilAt: integer('retain_until_at'), // ts-lint-ok: raw epoch-ms number by design`;
        expect(findTimestampViolations(src, 'x.ts')).toEqual([]);
    });
});
