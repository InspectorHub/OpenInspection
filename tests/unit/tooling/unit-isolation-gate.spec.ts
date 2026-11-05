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
        ['a read of the global object', 'const g = globalThis;\nconst v = g.flag;'],
        ['a bracket read of the global object', "const v = globalThis['flag'];"],
        ['a comparison against a global property', 'const same = globalThis.flag === 1;'],
        ['a spy that is restored', "import { logger } from '../../../server/pure';\nconst s = vi.spyOn(logger, 'info');\ns.mockRestore();"],
        ['a spy restored by restoreAllMocks', "import { logger } from '../../../server/pure';\nvi.spyOn(logger, 'info');\nafterEach(() => vi.restoreAllMocks());"],
    ])('accepts %s', (_label, line) => {
        const errors = verdict('tests/unit/a/ok.spec.ts', `${line}\nit('x', () => {});\n`, { 'server/pure.ts': 'export const logger = { info: () => 1 };\n' });
        expect(errors).toEqual([]);
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

    it('rejects a helper under tests/ that stubs a global', () => {
        const errors = verdict('tests/unit/b/helper.spec.ts', "import { arm } from '../helpers/arm';\nit('x', () => arm());\n", {
            'tests/unit/helpers/arm.ts': "export const arm = () => vi.stubGlobal('fetch', () => 1);\n",
        });
        expect(errors.join('\n')).toContain('helper tests/unit/helpers/arm.ts: global stub');
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
