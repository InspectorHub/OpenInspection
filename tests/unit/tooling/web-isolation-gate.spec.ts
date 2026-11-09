/**
 * The web-isolation gate decides which web specs may run with `isolate: false`. A gate that misses a
 * hazard lets one spec poison its neighbours in a way that shows up in a different file, so each rule
 * is pinned here with a spec that must be rejected AND a near-identical one that must pass (a rejection
 * test alone would also pass for a gate that rejects everything).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

type Manifest = { shared?: { node?: string[]; dom?: string[] }; forcedIsolated?: Record<string, string> };
type Check = (root: string, manifest: Manifest, specs: string[]) => { errors: string[]; shared: number; total: number };
let checkManifest: Check;
let root: string;

function put(rel: string, body: string) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
}

/** Errors for one spec listed under the given list. */
function verdict(list: 'node' | 'dom', spec: string, body: string, extra: Record<string, string> = {}) {
    put(spec, body);
    for (const [rel, text] of Object.entries(extra)) put(rel, text);
    return checkManifest(root, { shared: { node: list === 'node' ? [spec] : ['app/other.test.ts'], dom: list === 'dom' ? [spec] : ['app/other.test.tsx'] } }, [spec, 'app/other.test.ts', 'app/other.test.tsx'])
        .errors.filter((e) => e.startsWith(spec));
}

beforeAll(async () => {
    const url = pathToFileURL(path.join(process.cwd(), 'scripts/check-web-isolation.mjs')).href;
    // @vite-ignore: native load, the script is plain ESM outside the vitest transform.
    ({ checkManifest } = await import(/* @vite-ignore */ url));
    root = mkdtempSync(path.join(tmpdir(), 'web-isolation-'));
    put('app/other.test.ts', "it('x', () => {});\n");
    put('app/other.test.tsx', "// @vitest-environment happy-dom\nit('x', () => {});\n");
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

const DOM = '// @vitest-environment happy-dom\n';

describe('web-isolation gate: spec-level hazards', () => {
    it('accepts a pure node spec and a plain happy-dom spec', () => {
        expect(verdict('node', 'app/lib/pure.test.ts', "import { x } from '~/lib/pure';\nit('x', () => expect(x()).toBe(1));\n", { 'app/lib/pure.ts': 'export const x = () => 1;\n' })).toEqual([]);
        expect(verdict('dom', 'app/components/Plain.test.tsx', `${DOM}it('x', () => expect(document.body.childNodes.length).toBe(0));\n`)).toEqual([]);
    });

    it.each([
        ['a module mock', "vi.mock('~/lib/pure', () => ({}));", 'module mock'],
        ['a global stub', "vi.stubGlobal('fetch', () => 1);", 'global stub'],
        ['fake timers', 'vi.useFakeTimers();', 'fake timers'],
        ['a global write', 'globalThis.flag = 1;', 'global write'],
        ['a browser API replacement', 'window.matchMedia = () => null;', 'browser API replacement'],
        ['a prototype write on any element class', 'HTMLImageElement.prototype.decode = () => null;', 'browser API replacement'],
        ['a spy on any element prototype', "vi.spyOn(HTMLImageElement.prototype, 'complete', 'get');", 'spy on a browser object'],
        ['a localStorage write', "localStorage.setItem('k', 'v');", 'localStorage write'],
        ['a sessionStorage use', "sessionStorage.getItem('k');", 'browser storage write'],
        ['a location write', "window.location = 'http://x';", 'navigator/location/history write'],
        ['a body mutation', "document.body.appendChild(document.createElement('div'));", 'document head/body mutation'],
        ['a hand-made React root', "createRoot(document.body);", 'manual mount'],
        ['a spy on window with no restore', "vi.spyOn(window, 'open');", 'spy on a browser object'],
    ])('rejects %s', (_label, line, reason) => {
        const errors = verdict('dom', 'app/components/Bad.test.tsx', `${DOM}${line}\nit('x', () => {});\n`);
        expect(errors.join('\n')).toContain(reason);
    });

    it('rejects an environment other than node or happy-dom', () => {
        const errors = verdict('dom', 'app/components/Jsdom.test.tsx', "// @vitest-environment jsdom\nit('x', () => {});\n");
        expect(errors.join('\n')).toContain('environment jsdom');
    });

    it('does not trip on a comment that merely mentions a hazard', () => {
        expect(verdict('node', 'app/lib/comment.test.ts', "// we do not call vi.mock( or localStorage.setItem( here\nit('x', () => {});\n")).toEqual([]);
    });
});

describe('web-isolation gate: environment and project must agree', () => {
    it('rejects a happy-dom spec listed under node', () => {
        const errors = verdict('node', 'app/components/Dom.test.tsx', `${DOM}it('x', () => {});\n`);
        expect(errors.join('\n')).toContain('docblock asks for happy-dom');
    });

    it('rejects a spec with no docblock listed under dom', () => {
        const errors = verdict('dom', 'app/lib/NoDoc.test.ts', "it('x', () => {});\n");
        expect(errors.join('\n')).toContain('docblock asks for node');
    });
});

describe('web-isolation gate: state in imported modules', () => {
    it('rejects a reached module with a top-level let, even through a second import', () => {
        const errors = verdict('node', 'app/lib/deep.test.ts', "import { a } from '~/lib/a';\nit('x', () => a());\n", {
            'app/lib/a.ts': "import { b } from './b';\nexport const a = () => b();\n",
            'app/lib/b.ts': 'let counter = 0;\nexport const b = () => ++counter;\n',
        });
        expect(errors.join('\n')).toContain('app/lib/b.ts: top-level let/var');
    });

    it('follows an @core/shared-ui import', () => {
        const errors = verdict('node', 'app/lib/ui.test.ts', "import { v } from '@core/shared-ui/state';\nit('x', () => v());\n", {
            'packages/shared-ui/src/state.ts': 'let n = 0;\nexport const v = () => ++n;\n',
        });
        expect(errors.join('\n')).toContain('packages/shared-ui/src/state.ts: top-level let/var');
    });

    it('ignores a type-only import, which loads nothing', () => {
        const errors = verdict('node', 'app/lib/types.test.ts', "import type { T } from '~/lib/typed';\nit('x', () => { const t: T = 1; expect(t).toBe(1); });\n", {
            'app/lib/typed.ts': 'let counter = 0;\nexport type T = number;\nexport const bump = () => ++counter;\n',
        });
        expect(errors).toEqual([]);
    });

    it.each([
        ['import type with a named list', "import type { T } from '~/lib/typed';"],
        ['import type of a default', "import type T from '~/lib/typed';"],
        ['import type of a namespace', "import type * as T from '~/lib/typed';"],
        ['export type with a named list over several lines', "export type {\n  T,\n  U,\n} from '~/lib/typed';"],
        ['export type *', "export type * from '~/lib/typed';"],
    ])('skips %s', (_label, line) => {
        const errors = verdict('node', 'app/lib/skip.test.ts', `${line}\nit('x', () => {});\n`, {
            'app/lib/typed.ts': 'let counter = 0;\nexport type T = number;\nexport type U = number;\nexport const bump = () => ++counter;\n',
        });
        expect(errors).toEqual([]);
    });

    it('still follows a value re-export that comes after an `export type` alias', () => {
        const errors = verdict('node', 'app/lib/alias.test.ts', "import { bump } from '~/lib/barrel';\nit('x', () => bump());\n", {
            'app/lib/barrel.ts': "export type A = 1;\n\nexport { bump } from './typed';\n",
            'app/lib/typed.ts': 'let counter = 0;\nexport const bump = () => ++counter;\n',
        });
        expect(errors.join('\n')).toContain('app/lib/typed.ts: top-level let/var');
    });

    it('follows an import that only marks one name as a type', () => {
        const errors = verdict('node', 'app/lib/mixed.test.ts', "import { type T, bump } from '~/lib/typed';\nit('x', () => bump());\n", {
            'app/lib/typed.ts': 'let counter = 0;\nexport type T = number;\nexport const bump = () => ++counter;\n',
        });
        expect(errors.join('\n')).toContain('app/lib/typed.ts: top-level let/var');
    });

    it('still follows a value import from the same module', () => {
        const errors = verdict('node', 'app/lib/value.test.ts', "import { bump } from '~/lib/typed';\nit('x', () => bump());\n");
        expect(errors.join('\n')).toContain('app/lib/typed.ts: top-level let/var');
    });

    it('accepts a reviewed module by its path, and only by its path', () => {
        const state = 'let mountedNavs = 0;\nexport const mount = () => ++mountedNavs;\n';
        const allowed = verdict('node', 'app/lib/benign.test.ts', "import { mount } from '~/hooks/useToast';\nit('x', () => mount());\n", { 'app/hooks/useToast.ts': state });
        expect(allowed).toEqual([]);
        const elsewhere = verdict('node', 'app/lib/benign2.test.ts', "import { mount } from '~/hooks/useOther';\nit('x', () => mount());\n", { 'app/hooks/useOther.ts': state });
        expect(elsewhere.join('\n')).toContain('top-level let/var');
    });

    it('rejects a fixture module that stubs a global', () => {
        const errors = verdict('node', 'app/lib/fixture.test.ts', "import { arm } from '~/lib/thing.fixtures';\nit('x', () => arm());\n", {
            'app/lib/thing.fixtures.ts': "export const arm = () => vi.stubGlobal('fetch', () => 1);\n",
        });
        expect(errors.join('\n')).toContain('helper app/lib/thing.fixtures.ts: global stub');
    });
});

describe('web-isolation gate: the manifest itself', () => {
    it('refuses an empty list instead of reporting OK', () => {
        const { errors } = checkManifest(root, { shared: { node: [], dom: ['app/other.test.tsx'] } }, ['app/other.test.tsx']);
        expect(errors.join('\n')).toContain('lists no shared.node specs');
    });

    it('rejects a listed file that is not a spec on disk', () => {
        const { errors } = checkManifest(root, { shared: { node: ['app/gone.test.ts'], dom: ['app/other.test.tsx'] } }, ['app/other.test.tsx']);
        expect(errors.join('\n')).toContain('not a web spec on disk');
    });

    it('rejects a spec listed twice, or in both lists', () => {
        const { errors } = checkManifest(
            root,
            { shared: { node: ['app/other.test.ts', 'app/other.test.ts'], dom: ['app/other.test.ts'] } },
            ['app/other.test.ts'],
        );
        expect(errors.join('\n')).toContain('listed twice');
    });

    it('rejects a spec that is both shared and forced isolated', () => {
        const { errors } = checkManifest(
            root,
            { shared: { node: ['app/other.test.ts'], dom: ['app/other.test.tsx'] }, forcedIsolated: { 'app/other.test.ts': 'flaked' } },
            ['app/other.test.ts', 'app/other.test.tsx'],
        );
        expect(errors.join('\n')).toContain('both shared and forcedIsolated');
    });

    it('rejects a forcedIsolated entry with no reason, or naming no spec', () => {
        const { errors } = checkManifest(
            root,
            { shared: { node: ['app/other.test.ts'], dom: ['app/other.test.tsx'] }, forcedIsolated: { 'app/other.test.ts': ' ', 'app/gone.test.ts': 'why' } },
            ['app/other.test.ts', 'app/other.test.tsx'],
        );
        expect(errors.join('\n')).toContain('has no reason');
        expect(errors.join('\n')).toContain('names no spec');
    });

    it('reports a clean manifest as clean', () => {
        const { errors, shared } = checkManifest(root, { shared: { node: ['app/other.test.ts'], dom: ['app/other.test.tsx'] } }, ['app/other.test.ts', 'app/other.test.tsx']);
        expect(errors).toEqual([]);
        expect(shared).toBe(2);
    });
});
