/**
 * Unit tests for the status-literal anti-drift gate
 * (`scripts/check-status-literals.mjs`).
 *
 * The two status axes declare a single source of truth
 * (`server/lib/status/{inspection,report}-status.ts`) and require every
 * consumer to derive from the exported constants — "no bare status string
 * literals". This gate makes that discipline executable: it flags a member
 * value written as a bare literal directly bound to a status key (assignment
 * or comparison), so a value like `'completed'` cannot be typed by hand where
 * `INSPECTION_STATUS.COMPLETED` belongs.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let findStatusLiterals: (
    source: string,
    opts: { statusKeys: string[]; members: string[] },
) => Array<{ index: number; context: string; signature: string }>;

const OPTS = {
    statusKeys: ['status', 'reportStatus', 'conciergeStatus', 'inspectionStatus'],
    members: [
        'requested',
        'scheduled',
        'confirmed',
        'completed',
        'cancelled',
        'in_progress',
        'submitted',
        'published',
    ],
};

beforeAll(async () => {
    const scriptPath = path.resolve(HERE, '../../../scripts/check-status-literals.mjs');
    ({ findStatusLiterals } = await import(/* @vite-ignore */ pathToFileURL(scriptPath).href));
});

describe('findStatusLiterals', () => {
    it('flags an object-property assignment of a member literal', () => {
        const hits = findStatusLiterals("const patch = { status: 'confirmed' };", OPTS);
        expect(hits).toHaveLength(1);
        expect(hits[0].signature).toContain("status: 'confirmed'");
    });

    it('flags a .set({ status: MEMBER }) update', () => {
        const hits = findStatusLiterals(".set({ conciergeStatus: null, status: 'confirmed' })", OPTS);
        expect(hits).toHaveLength(1);
    });

    it('flags an equality comparison against a member literal', () => {
        const hits = findStatusLiterals("if (status === 'completed') { done(); }", OPTS);
        expect(hits).toHaveLength(1);
    });

    it('flags reportStatus comparisons too', () => {
        const hits = findStatusLiterals('return reportStatus === "published";', OPTS);
        expect(hits).toHaveLength(1);
    });

    it('does not flag use of the derived constant', () => {
        const hits = findStatusLiterals('set({ status: INSPECTION_STATUS.CONFIRMED })', OPTS);
        expect(hits).toHaveLength(0);
    });

    it('does not flag a bare literal that is not bound to a status key', () => {
        // `filter === 'in_progress'` — `filter` is not a status key; the value
        // is a UI filter token, not a status write.
        const hits = findStatusLiterals("if (filter === 'in_progress') {}", OPTS);
        expect(hits).toHaveLength(0);
    });

    it('does not flag a member word used as an object key', () => {
        const hits = findStatusLiterals('const map = { in_progress: 1, published: 2 };', OPTS);
        expect(hits).toHaveLength(0);
    });

    it('does not flag a union type annotation (declaration, not assignment)', () => {
        const hits = findStatusLiterals(
            "status: 'completed' | 'partially_completed' | 'refused';",
            OPTS,
        );
        expect(hits).toHaveLength(0);
    });

    it('does not flag a non-member value bound to a status key', () => {
        // 'delivered' is a ghost value (not in either axis) — it is not a member,
        // so this detector does not touch it; the type layer already rejects it.
        const hits = findStatusLiterals("status: 'delivered'", OPTS);
        expect(hits).toHaveLength(0);
    });

    it('skips single-line comments', () => {
        const hits = findStatusLiterals("// sets status: 'completed' when done", OPTS);
        expect(hits).toHaveLength(0);
    });

    it('finds multiple distinct hits with their own signatures', () => {
        const source = [
            "if (status === 'completed') a();",
            "if (status === 'cancelled') b();",
        ].join('\n');
        const hits = findStatusLiterals(source, OPTS);
        expect(hits).toHaveLength(2);
        expect(hits[0].signature).not.toBe(hits[1].signature);
    });
});
