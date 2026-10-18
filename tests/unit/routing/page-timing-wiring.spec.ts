/**
 * Wiring invariants for page timing in the worker entry. `workers/app.ts` pulls
 * in the React Router server build and cannot be executed under
 * `vitest.api.config.ts`, so, like api-seam-scope.spec.ts, this reads the source.
 * What it protects: only the page-render branch is wrapped, and API, probe,
 * status and redirect branches allocate nothing for timing.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../../../workers/app.ts', import.meta.url), 'utf8');

/** Source of one top-level `const NAME = ...` / `async function NAME` block, up to the next blank-line-separated declaration. */
function between(start: string, end: string): string {
    const a = SRC.indexOf(start);
    const b = SRC.indexOf(end, a + start.length);
    if (a < 0 || b < 0) throw new Error(`markers not found: ${start} .. ${end}`);
    return SRC.slice(a, b);
}

describe('page timing wiring in workers/app.ts', () => {
    it('is referenced only from the page-render branch (ssr)', () => {
        const ssr = between('const ssr = async', 'async function sessionMarkerForPage');
        expect(ssr).toMatch(/finishPage\(/);
        expect(ssr).toMatch(/Date\.now\(\)/);
        // Every other mention of the timing helpers sits outside ssr: the import, the tracker, the
        // session-marker helper that finishPage composes with.
        const outside = SRC.replace(ssr, '');
        expect(outside).not.toMatch(/finishPage\(/);
        expect(outside).not.toMatch(/startedAt/);
    });

    it('leaves the API dispatcher, the status route and the probe answer free of timing', () => {
        const toApi = between('const toApi', 'const app = new Hono');
        expect(toApi).not.toMatch(/page-?timing|finishPage|startedAt|Date\.now|inprocCalls/i);
        const routes = between('const app = new Hono', 'app.all("*", ssr);');
        expect(routes).not.toMatch(/page-?timing|finishPage|startedAt|Date\.now|inprocCalls/i);
    });

    it('counts in-process API calls only inside the self-binding fetch', () => {
        const ssr = between('const ssr = async', 'async function sessionMarkerForPage');
        expect(ssr).toMatch(/inprocCalls\s*\+=\s*1|inprocCalls\+\+|\+\+inprocCalls/);
        expect(ssr.match(/inprocCalls\s*\+=\s*1|inprocCalls\+\+|\+\+inprocCalls/g)).toHaveLength(1);
    });

    it('hands the server build to the request handler through the tracker, and never imports it elsewhere', () => {
        expect(SRC).toMatch(/createServerBuildTracker\(/);
        const importsOfBuild = SRC.match(/import\(\s*["']virtual:react-router\/server-build["']\s*\)/g) ?? [];
        expect(importsOfBuild).toHaveLength(1);
    });

    it('marks only the page-render env as a page-render call; the offline import never does', () => {
        expect(SRC).toMatch(/\[PAGE_RENDER_CALL\]\s*:\s*true/);
        const outbox = readFileSync(new URL('../../../server/services/offline-import-outbox.ts', import.meta.url), 'utf8');
        expect(outbox).not.toMatch(/PAGE_RENDER_CALL/);
    });

    it('keeps the entry import graph small: the helper is a plain top-level import of a leaf module', () => {
        expect(SRC).toMatch(/from "\.\.\/server\/lib\/page-timing"/);
        const helper = readFileSync(new URL('../../../server/lib/page-timing.ts', import.meta.url), 'utf8');
        const imports = [...helper.matchAll(/^import[^;]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
        // react-router is already a top-level import of the entry; the logger imports nothing.
        expect(imports.sort()).toEqual(['./logger', 'react-router']);
    });
});
