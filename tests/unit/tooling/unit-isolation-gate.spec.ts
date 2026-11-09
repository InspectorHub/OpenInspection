/**
 * The unit-isolation gate decides which specs may run with `isolate: false`.
 * A gate that misses a hazard lets one spec poison its neighbours in a way that
 * shows up in a different file, so each rule is pinned here with a spec that
 * must be rejected AND a near-identical one that must pass (a rejection test
 * alone would also pass for a gate that rejects everything).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type Check = (root: string, manifest: unknown, specs: string[]) => { errors: string[]; shared: number; total: number };
let checkManifest: Check;
let root: string;

function put(rel: string, body: string) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
}

function verdict(spec: string, body: string, extra: Record<string, string> = {}) {
    put(spec, body);
    for (const [rel, text] of Object.entries(extra)) put(rel, text);
    return checkManifest(root, { shared: [spec] }, [spec]).errors;
}

beforeAll(async () => {
    const url = pathToFileURL(path.join(process.cwd(), 'scripts/check-unit-isolation.mjs')).href;
    // @vite-ignore: native load, the script is plain ESM outside the vitest transform.
    ({ checkManifest } = await import(/* @vite-ignore */ url));
    root = mkdtempSync(path.join(tmpdir(), 'unit-isolation-'));
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('unit-isolation gate: spec-level hazards', () => {
    it('accepts a spec that only calls pure code', () => {
        expect(verdict('tests/unit/a/pure.spec.ts', "import { x } from '../../../server/pure';\nit('x', () => expect(x()).toBe(1));\n", {
            'server/pure.ts': 'export const x = () => 1;\n',
        })).toEqual([]);
    });

    it.each([
        ['a module mock', "vi.mock('../../../server/pure', () => ({}));", 'module mock'],
        ['a registry reset', 'vi.resetModules();', 'module registry reset'],
        ['a global stub', "vi.stubGlobal('fetch', () => 1);", 'global stub'],
        ['a global write', 'globalThis.flag = 1;', 'global write'],
        ['fake timers', 'vi.useFakeTimers();', 'fake timers'],
        ['an env write', "process.env.FOO = 'x';", 'process.env write'],
        ['a spy on a global', "vi.spyOn(console, 'log');", 'spy on a global'],
        ['an environment docblock', '// @vitest-environment happy-dom\n', 'environment docblock'],
        ['a performance.now bound', 'const t0 = performance.now();', 'wall-clock bound'],
        ['a process.hrtime bound', 'const t0 = process.hrtime.bigint();', 'wall-clock bound'],
        ['a Date.now difference', 'const dt = Date.now() - start;', 'wall-clock bound'],
        ['a Date.now difference that is not inside new Date(', 'const waited = Date.now() - new Date(0).getTime();', 'wall-clock bound'],
        ['a fake API app loader', "registerApiAppLoader(async () => app);", 'api app loader registration'],
        ['a bracket write to the global object', "globalThis['flag'] = 1;", 'global write'],
        ['a write through an alias of the global object', 'const g = globalThis;\ng.flag = 1;', 'global write'],
        ['Object.assign onto the global object', 'Object.assign(globalThis, { flag: 1 });', 'global write'],
        ['a spy on an imported object with no restore', "import { logger } from '../../../server/pure';\nvi.spyOn(logger, 'info');", 'spy without restore'],
    ])('rejects %s', (_label, line, reason) => {
        const errors = verdict('tests/unit/a/bad.spec.ts', `${line}\nit('x', () => {});\n`);
        expect(errors.join('\n')).toContain(reason);
    });

    it.each([
        ['a Date.now() read that is not a difference', 'const stamp = Date.now();'],
        ['a timestamp built in the past from Date.now()', 'const past = new Date(Date.now() - 60_000);'],
        ['a read of the global object', 'const g = globalThis;\nconst v = g.flag;'],
        ['a bracket read of the global object', "const v = globalThis['flag'];"],
        ['a comparison against a global property', 'const same = globalThis.flag === 1;'],
        ['a spy that is restored', "import { logger } from '../../../server/pure';\nconst s = vi.spyOn(logger, 'info');\ns.mockRestore();"],
        ['a spy restored by restoreAllMocks', "import { logger } from '../../../server/pure';\nvi.spyOn(logger, 'info');\nafterEach(() => vi.restoreAllMocks());"],
    ])('accepts %s', (_label, line) => {
        const errors = verdict('tests/unit/a/ok.spec.ts', `${line}\nit('x', () => {});\n`, { 'server/pure.ts': 'export const logger = { info: () => 1 };\n' });
        expect(errors).toEqual([]);
    });

    it('rejects an import of the worker entry, static or dynamic, and accepts a lookalike path', () => {
        const stat = verdict('tests/unit/a/entry-static.spec.ts', "import '../../../workers/app';\nit('x', () => {});\n");
        expect(stat.join('\n')).toContain('worker entry import');
        const dyn = verdict('tests/unit/a/entry-dynamic.spec.ts', "it('x', async () => { await import('../../../workers/app.ts'); });\n");
        expect(dyn.join('\n')).toContain('worker entry import');
        const named = verdict('tests/unit/a/entry-named.spec.ts', "import { x } from '../../../workers/app';\nit('x', () => x);\n");
        expect(named.join('\n')).toContain('worker entry import');
        const lookalike = verdict('tests/unit/a/entry-lookalike.spec.ts', "import { x } from '../../../server/workers/app-state';\nit('x', () => x);\n", {
            'server/workers/app-state.ts': 'export const x = 1;\n',
        });
        expect(lookalike).toEqual([]);
    });

    it('still catches an elapsed-time probe next to a past timestamp, and one wrapped in a Date', () => {
        const sameLine = verdict('tests/unit/a/probe-same-line.spec.ts', "const a = new Date(Date.now() - 5); const dt = Date.now() - a.getTime();\nit('x', () => {});\n");
        expect(sameLine.join('\n')).toContain('wall-clock bound');
        const wrapped = verdict('tests/unit/a/probe-wrapped.spec.ts', "it('x', () => { expect(new Date(Date.now() - t0).getTime()).toBeLessThan(50); });\n");
        expect(wrapped.join('\n')).toContain('wall-clock bound');
        const stamp = verdict('tests/unit/a/probe-stamp.spec.ts', "const past = new Date(Date.now() - 5);\nit('x', () => past);\n");
        expect(stamp).toEqual([]);
    });

    it('rejects a spec that opens a harness and never closes it, and accepts one that does', () => {
        const open = verdict('tests/unit/a/harness-open.spec.ts', "it('x', async () => { const h = await createHarness('saas'); h.sqlite.exec('select 1'); });\n");
        expect(open.join('\n')).toContain('createHarness without close()');
        const closed = verdict('tests/unit/a/harness-closed.spec.ts', "it('x', async () => { const h = await createHarness('saas'); h.close(); });\n");
        expect(closed).toEqual([]);
    });

    it('does not trip on a comment that merely mentions a hazard', () => {
        const body = "// we do not call vi.mock( or vi.useFakeTimers() here\nit('x', () => {});\n";
        expect(verdict('tests/unit/a/comment.spec.ts', body)).toEqual([]);
    });
});

describe('unit-isolation gate: state in imported modules', () => {
    it('rejects a module whose top-level let is reachable through two imports', () => {
        const errors = verdict('tests/unit/b/deep.spec.ts', "import { a } from '../../../server/a';\nit('x', () => a());\n", {
            'server/a.ts': "import { b } from './b';\nexport const a = () => b();\n",
            'server/b.ts': 'let counter = 0;\nexport const b = () => ++counter;\n',
        });
        expect(errors.join('\n')).toContain('server/b.ts: top-level let/var');
    });

    it('rejects a module-level Map that the module itself writes to', () => {
        const errors = verdict('tests/unit/b/cache.spec.ts', "import { get } from '../../../server/cache';\nit('x', () => get('k'));\n", {
            'server/cache.ts': 'const memo = new Map<string, number>();\nexport const get = (k: string) => { memo.set(k, 1); return memo.get(k); };\n',
        });
        expect(errors.join('\n')).toContain('top-level container mutated');
    });

    it('accepts a module-level Map that is only read (a lookup table)', () => {
        const errors = verdict('tests/unit/b/table.spec.ts', "import { get } from '../../../server/table';\nit('x', () => get('k'));\n", {
            'server/table.ts': "const TABLE = new Map<string, number>([['k', 1]]);\nexport const get = (k: string) => TABLE.get(k);\n",
        });
        expect(errors).toEqual([]);
    });

    it('rejects a mutated Map whose type annotation contains an arrow function', () => {
        const errors = verdict('tests/unit/b/arrow.spec.ts', "import { on } from '../../../server/hooks';\nit('x', () => on(() => 1));\n", {
            'server/hooks.ts': 'const handlers: Map<string, () => void> = new Map();\nexport const on = (f: () => void) => handlers.set("k", f);\n',
        });
        expect(errors.join('\n')).toContain('top-level container mutated');
    });

    it('rejects a top-level instance of a class that holds a Map field', () => {
        const errors = verdict('tests/unit/b/klass.spec.ts', "import { use } from '../../../server/klass';\nit('x', () => use());\n", {
            'server/klass.ts':
                'class Memo {\n  private readonly entries = new Map<string, number>();\n  put(k: string) { this.entries.set(k, 1); }\n}\nconst memo = new Memo();\nexport const use = () => memo.put("k");\n',
        });
        expect(errors.join('\n')).toContain('top-level instance of a class with collection state');
    });

    it('accepts a class with a Map field that is only instantiated inside a function', () => {
        const errors = verdict('tests/unit/b/klass-lazy.spec.ts', "import { use } from '../../../server/klass-lazy';\nit('x', () => use());\n", {
            'server/klass-lazy.ts':
                'class Memo {\n  private readonly entries = new Map<string, number>();\n  put(k: string) { this.entries.set(k, 1); }\n}\nexport const use = () => new Memo().put("k");\n',
        });
        expect(errors).toEqual([]);
    });

    it('lets the one named memo class through, and only by its path', () => {
        const klass =
            'class Memo {\n  private readonly entries = new Map<string, number>();\n  put(k: string) { this.entries.set(k, 1); }\n}\nconst memo = new Memo();\nexport const use = () => memo.put("k");\n';
        const allowed = verdict('tests/unit/b/named.spec.ts', "import { use } from '../../../packages/field-ui/src/shared/intl-cache';\nit('x', () => use());\n", {
            'packages/field-ui/src/shared/intl-cache.ts': klass,
        });
        expect(allowed).toEqual([]);
        const sameCodeElsewhere = verdict('tests/unit/b/named2.spec.ts', "import { use } from '../../../packages/field-ui/src/shared/other-cache';\nit('x', () => use());\n", {
            'packages/field-ui/src/shared/other-cache.ts': klass,
        });
        expect(sameCodeElsewhere.join('\n')).toContain('top-level instance of a class with collection state');
    });

    it('accepts a module whose state is cleared by the shared setup file, and only by its path', () => {
        const mod = 'let count = 0;\nexport const bump = () => ++count;\nexport const resetServiceAccountTokenCache = () => { count = 0; };\n';
        const named = verdict('tests/unit/b/reset.spec.ts', "import { bump } from '../../../server/lib/ai/credentials/google-service-account';\nit('x', () => bump());\n", {
            'server/lib/ai/credentials/google-service-account.ts': mod,
        });
        expect(named).toEqual([]);
        const elsewhere = verdict('tests/unit/b/reset2.spec.ts', "import { bump } from '../../../server/lib/other-account';\nit('x', () => bump());\n", {
            'server/lib/other-account.ts': mod,
        });
        expect(elsewhere.join('\n')).toContain('top-level let/var');
    });

    it('lets the one vetted helper keep its fetch double, but no other hazard', () => {
        const helper = 'tests/unit/helpers/tenant-email-harness.ts';
        const spec = "import { arm } from '../helpers/tenant-email-harness';\nit('x', () => arm());\n";
        const vetted = verdict('tests/unit/b/vetted.spec.ts', spec, { [helper]: "export const arm = () => vi.stubGlobal('fetch', () => 1);\n" });
        expect(vetted).toEqual([]);
        const alsoTimers = verdict('tests/unit/b/vetted2.spec.ts', spec, {
            [helper]: "export const arm = () => { vi.stubGlobal('fetch', () => 1); vi.useFakeTimers(); };\n",
        });
        expect(alsoTimers.join('\n')).toContain(`helper ${helper}: fake timers`);
        const sameCodeElsewhere = verdict('tests/unit/b/vetted3.spec.ts', "import { arm } from '../helpers/other-harness';\nit('x', () => arm());\n", {
            'tests/unit/helpers/other-harness.ts': "export const arm = () => vi.stubGlobal('fetch', () => 1);\n",
        });
        expect(sameCodeElsewhere.join('\n')).toContain('helper tests/unit/helpers/other-harness.ts: global stub');
    });

    it('exempts the vetted helper for fetch only: another stub target, an env stub or a computed target fails', () => {
        const helper = 'tests/unit/helpers/tenant-email-harness.ts';
        const spec = "import { arm } from '../helpers/tenant-email-harness';\nit('x', () => arm());\n";
        const crypto = verdict('tests/unit/b/vetted-crypto.spec.ts', spec, {
            [helper]: "export const arm = () => { vi.stubGlobal('fetch', () => 1); vi.stubGlobal('crypto', {}); };\n",
        });
        expect(crypto.join('\n')).toContain(`helper ${helper}: stubs the global crypto`);
        const env = verdict('tests/unit/b/vetted-env.spec.ts', spec, {
            [helper]: "export const arm = () => { vi.stubGlobal('fetch', () => 1); vi.stubEnv('X', '1'); };\n",
        });
        expect(env.join('\n')).toContain(`helper ${helper}: stubs the environment`);
        const computed = verdict('tests/unit/b/vetted-computed.spec.ts', spec, {
            [helper]: 'export const arm = (name: string) => vi.stubGlobal(name, () => 1);\n',
        });
        expect(computed.join('\n')).toContain(`helper ${helper}: stubs a global whose name is not a string literal`);
        const fetchOnly = verdict('tests/unit/b/vetted-fetch.spec.ts', spec, {
            [helper]: "export const arm = () => { vi.stubGlobal('fetch', () => 1); vi.unstubAllGlobals(); };\n",
        });
        expect(fetchOnly).toEqual([]);
    });

    it('rejects a helper under tests/ that stubs a global', () => {
        const errors = verdict('tests/unit/b/helper.spec.ts', "import { arm } from '../helpers/arm';\nit('x', () => arm());\n", {
            'tests/unit/helpers/arm.ts': "export const arm = () => vi.stubGlobal('fetch', () => 1);\n",
        });
        expect(errors.join('\n')).toContain('helper tests/unit/helpers/arm.ts: global stub');
    });
});

describe('unit-isolation gate: the shared setup file', () => {
    let setupProblems: (root: string) => string[];
    beforeAll(async () => {
        const url = pathToFileURL(path.join(process.cwd(), 'scripts/lib/unit-isolation.mjs')).href;
        // @vite-ignore: native load, the script is plain ESM outside the vitest transform.
        ({ setupProblems } = await import(/* @vite-ignore */ url));
    });

    const ALL_RESETS = '// resetNothing()\nresetServiceAccountTokenCache();\nresetCspReportSampling();\nresetTouchLastActiveDebounce();\n';
    const config = (shared: string, isolated = '') =>
        `export default { test: { projects: [{ test: { name: 'api-shared', ${shared} } }, { test: { name: 'api-isolated', ${isolated} } }] } };\n`;
    function fixture(name: string, setup: string | null, cfg: string): string {
        const dir = path.join(root, name);
        mkdirSync(path.join(dir, 'tests/unit'), { recursive: true });
        if (setup !== null) writeFileSync(path.join(dir, 'tests/unit/setup-shared.ts'), setup);
        writeFileSync(path.join(dir, 'vitest.api.config.ts'), cfg);
        return dir;
    }

    it('reports a missing setup file', () => {
        expect(setupProblems(path.join(root, 'no-setup')).join('\n')).toContain('tests/unit/setup-shared.ts is missing');
    });

    it('reports a reset that the setup file no longer calls, and a config that does not load it', () => {
        const dir = fixture('setup-partial', 'resetServiceAccountTokenCache();\nresetCspReportSampling();\n', 'export default {};\n');
        const errors = setupProblems(dir).join('\n');
        expect(errors).toContain('does not call resetTouchLastActiveDebounce()');
        expect(errors).not.toContain('does not call resetServiceAccountTokenCache()');
        expect(errors).toContain("vitest.api.config.ts does not list tests/unit/setup-shared.ts in the api-shared project's setupFiles");
    });

    it('is not satisfied by a comment that names the setup file', () => {
        const dir = fixture('setup-comment', ALL_RESETS, `// setupFiles: ['tests/unit/setup-shared.ts']\n${config('')}`);
        expect(setupProblems(dir).join('\n')).toContain('does not list tests/unit/setup-shared.ts');
    });

    it('is not satisfied by the setup file being listed for the other project', () => {
        const dir = fixture('setup-wrong-project', ALL_RESETS, config('', "setupFiles: ['tests/unit/setup-shared.ts']"));
        expect(setupProblems(dir).join('\n')).toContain('does not list tests/unit/setup-shared.ts');
    });

    it('is not satisfied by a reset that only a comment calls', () => {
        const dir = fixture(
            'setup-commented-call',
            '// resetTouchLastActiveDebounce();\nresetServiceAccountTokenCache();\nresetCspReportSampling();\n',
            config("setupFiles: ['tests/unit/setup-shared.ts']"),
        );
        expect(setupProblems(dir).join('\n')).toContain('does not call resetTouchLastActiveDebounce()');
    });

    it('accepts a setup file that calls every reset and a config that loads it for api-shared', () => {
        const dir = fixture('setup-full', ALL_RESETS, config("setupFiles: ['tests/unit/setup-shared.ts']"));
        expect(setupProblems(dir)).toEqual([]);
    });

    it('holds for this repository', () => {
        expect(setupProblems(process.cwd())).toEqual([]);
    });
});

describe('unit-isolation gate: the files exempted from the module-state rules are pinned', () => {
    type Pins = Record<string, number>;
    let exemptStateProblems: (root: string, pins?: Pins, exempt?: string[]) => string[];
    beforeAll(async () => {
        const url = pathToFileURL(path.join(process.cwd(), 'scripts/lib/unit-isolation.mjs')).href;
        // @vite-ignore: native load, the script is plain ESM outside the vitest transform.
        ({ exemptStateProblems } = await import(/* @vite-ignore */ url));
    });

    it('accepts an exempt file whose state count matches its pin', () => {
        put('server/pinned/ok.ts', 'let memo = 0;\nexport const read = () => memo;\n');
        expect(exemptStateProblems(root, { 'server/pinned/ok.ts': 1 }, ['server/pinned/ok.ts'])).toEqual([]);
    });

    it('rejects an exempt file that gained one more top-level cache', () => {
        put('server/pinned/grown.ts', 'let memo = 0;\nconst seen = new Map<string, number>();\nexport const touch = (k: string) => { seen.set(k, memo); };\n');
        const errors = exemptStateProblems(root, { 'server/pinned/grown.ts': 1 }, ['server/pinned/grown.ts']).join('\n');
        expect(errors).toContain('has 2 top-level state statement(s), pinned at 1');
    });

    it('rejects an exempt file with no pin and one that is not on disk', () => {
        put('server/pinned/unpinned.ts', 'let memo = 0;\n');
        const errors = exemptStateProblems(root, {}, ['server/pinned/unpinned.ts', 'server/pinned/gone.ts']).join('\n');
        expect(errors).toContain('server/pinned/unpinned.ts: exempt from the module-state rules with no pinned state count (it has 1)');
        expect(errors).toContain('server/pinned/gone.ts: exempt from the module-state rules but not a file on disk');
    });

    it('holds for this repository', () => {
        expect(exemptStateProblems(process.cwd())).toEqual([]);
    });
});

describe('unit-isolation gate: the manifest itself', () => {
    it('refuses an empty shared list instead of reporting OK', () => {
        const { errors } = checkManifest(root, { shared: [] }, ['tests/unit/a/pure.spec.ts']);
        expect(errors.join('\n')).toContain('lists no shared specs');
    });

    it('rejects a listed file that is not a spec on disk', () => {
        const { errors } = checkManifest(root, { shared: ['tests/unit/a/gone.spec.ts'] }, ['tests/unit/a/pure.spec.ts']);
        expect(errors.join('\n')).toContain('not a spec in tests/unit');
    });

    it('rejects a spec that is both shared and forced isolated', () => {
        put('tests/unit/a/both.spec.ts', "it('x', () => {});\n");
        const { errors } = checkManifest(
            root,
            { shared: ['tests/unit/a/both.spec.ts'], forcedIsolated: { 'tests/unit/a/both.spec.ts': 'flaked' } },
            ['tests/unit/a/both.spec.ts'],
        );
        expect(errors.join('\n')).toContain('both shared and forcedIsolated');
    });

    it('rejects a forcedIsolated entry with no reason', () => {
        put('tests/unit/a/why.spec.ts', "it('x', () => {});\n");
        const { errors } = checkManifest(
            root,
            { shared: ['tests/unit/a/pure.spec.ts'], forcedIsolated: { 'tests/unit/a/why.spec.ts': ' ' } },
            ['tests/unit/a/pure.spec.ts', 'tests/unit/a/why.spec.ts'],
        );
        expect(errors.join('\n')).toContain('has no reason');
    });
});
