/**
 * Unit tests for the dynamic-import placement gate (`scripts/check-test-imports.mjs`).
 *
 * The defect the gate exists for: `await import()` of a module whose graph
 * reaches `~/paraglide/messages` costs 1.9-3.7 s of transform on the ONE main
 * thread every vitest worker shares. Inside an `it()` body that wait is billed
 * against the 5000 ms `testTimeout`, so the first spec to ask for it while the
 * workers start goes red for reasons unrelated to what it asserts.
 *
 * Nothing here is allowed to pass vacuously:
 *   - the PRE-FIX shape of `app/routes/settings-automations.test.ts` MUST be
 *     reported (if the scanner ever stops matching, this is the test that goes
 *     red);
 *   - `?raw` has the SAME SHAPE and NONE of the cost, so it must NOT be
 *     reported — and the run must show it was EXAMINED, not skipped;
 *   - a spec with no dynamic import at all is a counted PASS, never an absence;
 *   - the real-tree scan pins how many files it examined, so a moved directory
 *     cannot turn "clean" into "saw nothing".
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

type Violation = { path: string; line: number; via: string | null; spec: string };
type Cheap = Violation & { why: string };
type Unresolved = Omit<Violation, 'spec'> & { why: string };
type File = { path: string; source: string };

let gate: {
    TIMED_ROOTS: Set<string>;
    classifySpecifier(spec: string): { kind: 'cheap' | 'graph'; why: string };
    specFiles(root: string, dir?: string): string[];
    analyze(input: { files: File[] }): {
        examined: number;
        clean: number;
        sites: number;
        violations: Violation[];
        cheap: Cheap[];
        unresolved: Unresolved[];
        unparsed: Array<{ path: string; errors: number }>;
    };
};

beforeAll(async () => {
    const scriptPath = path.resolve(ROOT, 'scripts/check-test-imports.mjs');
    gate = await import(/* @vite-ignore */ pathToFileURL(scriptPath).href);
});

const spec = (source: string, p = 'app/routes/fixture.test.ts'): File => ({ path: p, source });
const scan = (...files: File[]) => gate.analyze({ files });

/* ------------------------------------------------------------------ *
 * The fixture: the PRE-FIX form of app/routes/settings-automations.test.ts
 * ------------------------------------------------------------------ */

/**
 * Reconstructed from what the landed file (commit `3a436d82`) says it replaced:
 * the route module was imported from inside the FIRST `it()` rather than from
 * `beforeAll`. Only the placement matters to the gate, so this keeps that shape
 * and drops the assertions.
 */
const PRE_FIX_SETTINGS_AUTOMATIONS = `// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { automations } from '../../server/lib/db/schema';

describe('Automations editor covers the schema', () => {
    it('every recipient kind the column accepts has a label', async () => {
        const { RECIPIENT_KIND_LABELS } = await import('./settings-automations');
        for (const kind of getTableColumns(automations).recipientKind.enumValues) {
            expect(Object.keys(RECIPIENT_KIND_LABELS)).toContain(kind);
        }
    });
});
`;

/** The same file as it ships today: the import hoisted into `beforeAll`. */
const POST_FIX_SETTINGS_AUTOMATIONS = PRE_FIX_SETTINGS_AUTOMATIONS.replace(
    /    it\('every[\s\S]*?\n    \}\);\n/,
    `    let RECIPIENT_KIND_LABELS: Record<string, unknown>;
    beforeAll(async () => {
        ({ RECIPIENT_KIND_LABELS } = await import('./settings-automations'));
    });
    it('has labels', () => expect(Object.keys(RECIPIENT_KIND_LABELS)).toBeTruthy());
`,
);

describe('the fixture that proves the gate is not asleep', () => {
    it('POSITIVE CONTROL: reports the pre-fix settings-automations shape', () => {
        const r = scan(spec(PRE_FIX_SETTINGS_AUTOMATIONS));
        expect(r.violations).toHaveLength(1);
        expect(r.violations[0].spec).toBe('./settings-automations');
        expect(r.violations[0].via).toBeNull();
        // Examined, not merely un-skipped.
        expect(r.examined).toBe(1);
        expect(r.sites).toBe(1);
        expect(r.clean).toBe(0);
    });

    it('and stops reporting it once the import is hoisted into beforeAll', () => {
        // Guards the opposite failure: a gate that reports everything is as
        // useless as one that reports nothing, and would still pass the test
        // above. Same specifier, same module — only the placement changed.
        expect(POST_FIX_SETTINGS_AUTOMATIONS).toContain("await import('./settings-automations')");
        const r = scan(spec(POST_FIX_SETTINGS_AUTOMATIONS));
        expect(r.violations).toEqual([]);
        expect(r.sites).toBe(1); // still SEEN — cleared on placement, not skipped
    });
});

describe('what a file that declares nothing looks like to it', () => {
    it('a spec with no dynamic import at all is a counted PASS, not an absence', () => {
        // The question that has caught three false greens in this repo: a gate
        // that only tallies findings cannot tell "nothing wrong here" from "this
        // file was never opened". `clean` is that distinction, printed every run.
        const r = scan(
            spec("import { it, expect } from 'vitest';\nit('adds', () => expect(1 + 1).toBe(2));\n"),
        );
        expect(r.examined).toBe(1);
        expect(r.clean).toBe(1);
        expect(r.sites).toBe(0);
        expect(r.violations).toEqual([]);
    });

    it('an empty file list is examined:0 — a scan that saw nothing says so', () => {
        const r = scan();
        expect(r.examined).toBe(0);
        expect(r.clean).toBe(0);
        expect(r.violations).toEqual([]);
    });

    it('a file the parser choked on is a FAILURE, not a clean file', () => {
        // Unparsable input yields no nodes, therefore no findings, therefore a
        // green run. That is the single most dangerous way for this gate to be
        // wrong, so it is the one thing it refuses to shrug at.
        const r = scan(spec('export function broken( {\n'));
        expect(r.unparsed).toHaveLength(1);
        expect(r.violations).toEqual([]); // and it did not invent findings either
    });
});

describe('same shape, no cost — the exclusions', () => {
    it('POSITIVE CONTROL: ?raw is NOT reported, and is shown as examined', () => {
        // Measured: the real graph 1877 ms, the same file via ?raw 47 ms — Vite
        // returns the file's TEXT and never resolves what it imports. A gate that
        // matched on shape alone would be wrong about three already-checked files.
        const r = scan(
            spec(`import { it, expect } from 'vitest';
it('reads the source', async () => {
    const src = await import('~/components/Sidebar?raw');
    expect((src as unknown as { default: string }).default.length).toBeGreaterThan(0);
});
`),
        );
        expect(r.violations).toEqual([]);
        // Not skipped: it was counted as a site, and the run states WHY it passed.
        expect(r.sites).toBe(1);
        expect(r.clean).toBe(0);
        expect(r.cheap).toHaveLength(1);
        expect(r.cheap[0].spec).toBe('~/components/Sidebar?raw');
        expect(r.cheap[0].why).toContain('?raw');
    });

    it('classifies each cheap kind with the reason it is cheap', () => {
        expect(gate.classifySpecifier('~/x?raw').kind).toBe('cheap');
        expect(gate.classifySpecifier('~/x?url').kind).toBe('cheap');
        expect(gate.classifySpecifier('node:fs').kind).toBe('cheap');
        expect(gate.classifySpecifier('../messages/en/reports.json').kind).toBe('cheap');
        expect(gate.classifySpecifier('~/components/Sidebar').kind).toBe('graph');
        expect(gate.classifySpecifier('./settings-automations').kind).toBe('graph');
    });

    it('a `.json` next to a `?raw` is cheap for a DIFFERENT reason, and says so', () => {
        // Both live in report-card-stack.buttons.test.ts. Under one shared excuse
        // an exclusion could widen without anyone noticing what it started to cover.
        const r = scan(
            spec(`import { it, expect } from 'vitest';
it('checks the label', async () => {
    const src = await import('~/hooks/usePdfExport?raw');
    const en = await import('../messages/en/reports.json');
    expect(src).toBeTruthy();
    expect(en).toBeTruthy();
});
`),
        );
        expect(r.violations).toEqual([]);
        expect(r.cheap.map((c) => c.why.split(' ')[0])).toEqual(['vite', 'json']);
    });

    it('a `typeof import()` is a TYPE and is never a call site', () => {
        // `await vi.importActual<typeof import("react-router")>(...)` appears in
        // eight app specs. It erases to nothing.
        const r = scan(
            spec(`import { it, expect, vi } from 'vitest';
it('spies', async () => {
    const actual = await vi.importActual<typeof import('react-router')>('react-router');
    expect(actual).toBeTruthy();
});
let x: typeof import('~/components/Sidebar');
`),
        );
        expect(r.sites).toBe(0);
        expect(r.violations).toEqual([]);
    });
});

describe('a raised timeout is not an exception', () => {
    it('still reports an import inside an it() that declares its own timeout', () => {
        // app/components/sidebar.test.ts carried `}, 20000)` and a comment
        // explaining it. Measured: 2472 ms solo, 19206 ms under `vitest run
        // app/components --maxWorkers=16` — a 7.8x swing leaving 794 ms under
        // its own ceiling. A timeout never removed the cost; it moved the cliff,
        // and it only ever protected the payer — every other worker still queued
        // behind the same transform. The decision is recorded here, not recalled.
        const withTimeout = spec(`import { it, expect } from 'vitest';
it('exports Sidebar', async () => {
    const mod = await import('~/components/Sidebar');
    expect(mod.Sidebar).toBeDefined();
}, 20000);
`);
        const r = scan(withTimeout);
        expect(r.violations).toHaveLength(1);
        expect(r.violations[0].spec).toBe('~/components/Sidebar');
    });
});

describe('the one-line bypass', () => {
    it('follows a module-scope helper called from a test body', () => {
        // Without this, `async function load() { return import(x) }` silences the
        // gate with no change in cost. Two app specs already use that shape.
        const r = scan(
            spec(`import { it, expect } from 'vitest';
async function load() {
    return (await import('./useRepairOpQueue')).useRepairOpQueue;
}
it('drives the hook', async () => {
    const hook = await load();
    expect(hook).toBeDefined();
});
`),
        );
        expect(r.violations).toHaveLength(1);
        expect(r.violations[0].via).toBe('load');
    });

    it('leaves the same helper alone when only a hook calls it', () => {
        const r = scan(
            spec(`import { it, expect, beforeAll } from 'vitest';
async function load() {
    return (await import('./useRepairOpQueue')).useRepairOpQueue;
}
let hook: unknown;
beforeAll(async () => { hook = await load(); });
it('drives the hook', () => { expect(hook).toBeDefined(); });
`),
        );
        expect(r.violations).toEqual([]);
        expect(r.sites).toBe(1);
    });

    it('knows the variants of it/test, and does not police describe', () => {
        expect([...gate.TIMED_ROOTS].sort()).toEqual(['fit', 'it', 'test', 'xit']);
        const variants = scan(
            spec(`import { describe, it, test } from 'vitest';
it.skip('a', async () => { await import('~/a'); });
test.concurrent('b', async () => { await import('~/b'); });
it.each([1])('c', async () => { await import('~/c'); });
describe('d', () => { /* collection time, no testTimeout */ });
`),
        );
        expect(variants.violations.map((v) => v.spec)).toEqual(['~/a', '~/b', '~/c']);
    });
});

describe('the lexer cannot be desynced into looking clean', () => {
    it('a regex literal containing a quote does not swallow the rest of the file', () => {
        // `/role="radio"/g` is real, in app/components/editor/batch-action-bar.test.ts.
        // A scanner that skips string literals reads that `"` as an opening quote
        // and masks everything after it — producing not an error but a file with
        // no findings. This is why the gate parses instead of matching.
        const r = scan(
            spec(`import { it, expect } from 'vitest';
it('counts radios', async () => {
    const matches = [...'x'.matchAll(/role="radio"/g)];
    expect(matches).toHaveLength(0);
    const mod = await import('~/components/Sidebar');
    expect(mod).toBeTruthy();
});
`),
        );
        expect(r.violations).toHaveLength(1);
        expect(r.violations[0].spec).toBe('~/components/Sidebar');
    });

    it('does not read the words in a comment or a string as a call', () => {
        // repair-builder-action-tag-seam.test.tsx's header block comment says
        // "through a dynamic `import()` of the route MODULE".
        const r = scan(
            spec(`import { it, expect } from 'vitest';
/** These specs reach the actions through a dynamic \`import()\` of the route. */
it('does not import(\\'~/x\\') here either', () => {
    // await import('~/y')
    expect('await import("~/z")').toContain('import');
});
`),
        );
        expect(r.sites).toBe(0);
        expect(r.violations).toEqual([]);
        expect(r.clean).toBe(1);
    });

    it('reports the line of the import, not of the test that contains it', () => {
        const r = scan(
            spec("import { it } from 'vitest';\nit('a', async () => {\n\n  await import('~/x');\n});\n"),
        );
        expect(r.violations[0].line).toBe(4);
    });
});

describe('the real tree', () => {
    let real: ReturnType<typeof gate.analyze>;

    beforeAll(() => {
        const files = gate.specFiles(ROOT).map((full) => ({
            path: path.relative(ROOT, full).split(path.sep).join('/'),
            source: readFileSync(full, 'utf8'),
        }));
        real = gate.analyze({ files });
    });

    it('actually examined the co-located web suite', () => {
        // Three hundred, not three: the number is here so a renamed directory or
        // a broken glob cannot read as a clean run. `clean` is the majority of it
        // — those files pass, they are not missing.
        expect(real.examined).toBeGreaterThan(300);
        expect(real.clean).toBeGreaterThan(300);
        expect(real.examined - real.clean).toBeGreaterThan(0);
        expect(real.sites).toBeGreaterThan(20);
        expect(real.unparsed).toEqual([]);
    });

    it('every site is accounted for — nothing falls between the buckets', () => {
        // A site is judged, excused, or declared unclassifiable — no fourth
        // outcome, which is what stops one from being invented.
        const insideTimedBody =
            real.violations.length + real.cheap.length + real.unresolved.length;
        expect(insideTimedBody).toBeGreaterThan(0);
        expect(insideTimedBody).toBeLessThanOrEqual(real.sites);
    });

    it('loads no module graph inside a timed test body', () => {
        expect(real.violations.map((v) => `${v.path}:${v.line} ${v.spec}`)).toEqual([]);
    });

    it('the specs whose mocks force a dynamic import keep it in beforeAll', () => {
        // #88/#89 fixed these by hand: each installs a `vi.doMock` that must be
        // in place before the route module resolves, so the import cannot be
        // static and `beforeAll` is the right home. Naming them means a revert is
        // a red test rather than a slow suite nobody bisects.
        const hoisted = [
            'app/routes/settings-automations.test.ts',
            'app/routes/public/repair-builder-action-tag-seam.test.tsx',
            'app/routes/public/repair-builder-trade-seam.test.tsx',
            'app/components/portal/sections/repair/useRepairOpQueue.test.tsx',
        ];
        for (const p of hoisted) {
            const src = readFileSync(path.join(ROOT, p), 'utf8');
            expect(src, `${p} no longer exists`).toContain('beforeAll');
            expect(real.violations.filter((v) => v.path === p), p).toEqual([]);
        }
    });

    it('sidebar.test.ts imports statically, because beforeAll was NOT enough', () => {
        // Hoisting these two graphs into `beforeAll` was tried and failed the
        // same loaded run with "Hook timed out in 10000ms": that budget is
        // separate from `testTimeout` but it is `hookTimeout`, and 19206 ms does
        // not fit in 10000 ms any better than in 5000 ms. Only COLLECTION has no
        // budget, and only a static import is paid there. Nothing here mocks
        // anything, so nothing here has to be dynamic.
        const src = readFileSync(path.join(ROOT, 'app/components/sidebar.test.ts'), 'utf8');
        expect(src).toMatch(/^import \* as SidebarModule from '~\/components\/Sidebar';$/m);
        expect(src).toMatch(/^import \{[^}]*visibleNavItems[^}]*\} from '~\/components\/sidebar\/nav-items';$/m);
        // And the mitigation it replaces is gone. If a four-digit timeout comes
        // back, the cost came back with it.
        expect(src).not.toMatch(/\}\s*,\s*\d{4,}\s*\)/);
    });

    it('pins which files the scanner admits it cannot classify', () => {
        // `await import(mod)` over a loop of `?raw` specifiers: unresolvable,
        // reported on every run, and not fatal. Pinned by FILE so the set cannot
        // grow quietly into a hole — a new one is a deliberate edit here.
        expect([...new Set(real.unresolved.map((u) => u.path))]).toEqual([
            'app/components/sidebar.test.ts',
        ]);
    });
});
