/**
 * Unit tests for the idempotency-coverage gate's classification (#107).
 *
 * "Verified" changed meaning: it used to be "a replay spec quotes this path as a
 * string literal", which scored a route on the strength of a grep. It is now
 * "this route is in the table the suite drives", and the evidence that the table
 * is real is the WIRING — the suite file exists and imports `collect` from this
 * very script, so both sides walk one source of paths.
 *
 * That is weaker than an artifact handshake (suite writes a JSON, gate reads
 * it), and deliberately so: CI runs `lint` BEFORE `test:unit`, so a handshake
 * artifact would be stale or missing on every clean run. These tests pin the
 * wiring check, because a wiring check that cannot fail is decoration.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

type Wiring = { ok: boolean; reason: string | null };
type Classification = 'unreachable' | 'byDesign' | 'excluded' | 'verified' | 'pending';

let checkSuiteWiring: (suiteFile: string) => Wiring;
let classifyRoute: (
    route: string,
    ctx: {
        unreachableKeys: string[];
        byDesignKeys: string[];
        exclusionKeys: string[];
        suiteWired: boolean;
    },
) => Classification;
let findReasonlessEntries: (map: Record<string, string>) => string[];
let SUITE_FILE: string;

let dir: string;

beforeAll(async () => {
    const scriptPath = path.resolve(
        import.meta.dirname ?? path.join(process.cwd()),
        '../../../scripts/check-idempotency-coverage.mjs',
    );
    // @vite-ignore — load the .mjs via native Node import.
    ({ checkSuiteWiring, classifyRoute, findReasonlessEntries, SUITE_FILE } = await import(
        /* @vite-ignore */ pathToFileURL(scriptPath).href
    ));
    dir = mkdtempSync(path.join(tmpdir(), 'idem-gate-'));
});

afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('checkSuiteWiring', () => {
    it('FAILS when the suite file is absent', () => {
        const res = checkSuiteWiring(path.join(dir, 'nope.spec.ts'));
        expect(res.ok).toBe(false);
        expect(res.reason).toMatch(/missing/i);
    });

    it('FAILS when the suite does not reference this script', () => {
        const p = path.join(dir, 'unwired.spec.ts');
        writeFileSync(p, `import { app } from '../../../server/index';\nit('x', () => {});\n`);
        const res = checkSuiteWiring(p);
        expect(res.ok).toBe(false);
        expect(res.reason).toMatch(/check-idempotency-coverage\.mjs/);
    });

    it('PASSES when the suite imports collect from this script', () => {
        const p = path.join(dir, 'wired.spec.ts');
        writeFileSync(p, `const { collect } = await import(pathToFileURL('../../../scripts/check-idempotency-coverage.mjs').href);\n`);
        expect(checkSuiteWiring(p)).toEqual({ ok: true, reason: null });
    });

    it('PASSES on the real tree', () => {
        expect(checkSuiteWiring(SUITE_FILE).ok).toBe(true);
    });
});

describe('classifyRoute', () => {
    const wired = {
        unreachableKeys: ['POST /api/gone'],
        byDesignKeys: ['POST /api/webhooks/*'],
        exclusionKeys: ['POST /api/weird'],
        suiteWired: true,
    };

    it('scores an ordinary route verified once the suite is wired', () => {
        expect(classifyRoute('POST /api/inspections', wired)).toBe('verified');
    });

    it('keeps knownUnreachable ahead of everything else', () => {
        expect(classifyRoute('POST /api/gone', wired)).toBe('unreachable');
    });

    it('honours a by-design wildcard', () => {
        expect(classifyRoute('POST /api/webhooks/stripe', wired)).toBe('byDesign');
    });

    it('scores a table exclusion as excluded, not verified', () => {
        expect(classifyRoute('POST /api/weird', wired)).toBe('excluded');
    });

    it('drops EVERY ordinary route to pending when the suite is not wired', () => {
        // The whole population resting on one file is the point: if the suite is
        // deleted or renamed, the gate must go loudly red rather than keep
        // scoring routes verified on evidence that no longer exists.
        expect(classifyRoute('POST /api/inspections', { ...wired, suiteWired: false })).toBe('pending');
    });
});

describe('findReasonlessEntries', () => {
    it('names entries with no written reason', () => {
        expect(findReasonlessEntries({ a: 'because.', b: '', c: '   ' })).toEqual(['b', 'c']);
    });

    it('is empty for a fully annotated map', () => {
        expect(findReasonlessEntries({ a: 'because.' })).toEqual([]);
    });
});
