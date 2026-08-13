/**
 * Unit tests for the client submit-guard gate (#106).
 *
 * The gate bans a CALL SHAPE, not a variable name. That distinction is the
 * whole reason this spec exists: a detector written against the literal string
 * `fetcher.submit(` sees only 74 of the 157 call sites in `app/` — the other 83
 * wear 53 different identifiers (`coverFetcher`, `deleteFetcher`, `credFetcher`,
 * `mappingFetcher`, …) — and reports green. The five-fetcher positive control
 * below pins that: it asserts a COUNT, so a literal-name implementation reads
 * red instead of silently covering half the tree.
 *
 * Loaded from the `.mjs` at runtime inside `beforeAll` (see check-naming.spec.ts
 * for why the import is deferred: vitest's esbuild transform throws a
 * SyntaxError on these scripts).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

type Hit = { line: number; index: number; ident: string; context: string };
type BusyViolation = { line: number; index: number; binding: string; reason: string };
type Evaluation = {
    ok: boolean;
    violations: string[];
    stale: string[];
    reasonless: string[];
    failures: string[];
};

let findSubmitCallSites: (source: string) => Hit[];
let findBusyViolations: (source: string) => BusyViolation[];
let evaluate: (input: {
    hits: Map<string, string>;
    baseline: Record<string, string>;
    scannedCount: number;
    minFiles?: number;
    busyConsumers: number;
    busyViolations: string[];
}) => Evaluation;

beforeAll(async () => {
    const scriptPath = path.resolve(
        import.meta.dirname ?? path.join(process.cwd()),
        '../../../scripts/check-submit-guard.mjs',
    );
    // @vite-ignore — load the .mjs via native Node import.
    ({ findSubmitCallSites, findBusyViolations, evaluate } = await import(
        /* @vite-ignore */ pathToFileURL(scriptPath).href
    ));
});

describe('findSubmitCallSites — the call shape, not the name', () => {
    it('flags a plainly named fetcher', () => {
        expect(findSubmitCallSites(`fetcher.submit(payload, post);`)).toHaveLength(1);
    });

    it.each([
        'deleteFetcher',
        'loadFetcher',
        'remindFetcher',
        'copyFetcher',
        'mappingFetcher',
    ])('flags %s.submit(', (ident) => {
        const hits = findSubmitCallSites(`${ident}.submit(payload, post);`);
        expect(hits).toHaveLength(1);
        expect(hits[0].ident).toBe(ident);
    });

    it('flags a member-expression fetcher (props.fetcher.submit)', () => {
        expect(findSubmitCallSites(`props.fetcher.submit(payload, post);`)).toHaveLength(1);
    });

    it('counts FIVE differently named fetchers in one file', () => {
        // The pin on miscount #1. An implementation matching only the literal
        // `fetcher.submit(` scores 1 here and this assertion goes red.
        const src = [
            `coverFetcher.submit(a, post);`,
            `deleteFetcher.submit(b, post);`,
            `credFetcher.submit(c, post);`,
            `mappingFetcher.submit(d, post);`,
            `fetcher.submit(e, post);`,
        ].join('\n');
        const hits = findSubmitCallSites(src);
        expect(hits).toHaveLength(5);
        expect(hits.map((h) => h.line)).toEqual([1, 2, 3, 4, 5]);
    });

    it('tolerates whitespace before the paren', () => {
        expect(findSubmitCallSites(`fetcher.submit (payload, post);`)).toHaveLength(1);
    });

    it.each([
        ['a bare submit() call', `submit(payload, post);`],
        ['the submitting flag', `if (fetcher.submitting) return;`],
        ['useSubmit()(', `useSubmit()(payload, post);`],
        ['a different method with the same prefix', `Fetcher.submitAll(payload);`],
    ])('does NOT flag %s', (_label, src) => {
        expect(findSubmitCallSites(src)).toEqual([]);
    });

    it('does NOT flag a mention inside a line comment', () => {
        expect(findSubmitCallSites(`// fetcher.submit() disables nothing`)).toEqual([]);
    });

    it('does NOT flag a mention inside a block comment, and keeps line numbers', () => {
        const src = [
            `/**`,
            ` * fetcher.submit() disables nothing and does not flip state.`,
            ` */`,
            `deleteFetcher.submit(payload, post);`,
        ].join('\n');
        const hits = findSubmitCallSites(src);
        expect(hits).toHaveLength(1);
        expect(hits[0].line).toBe(4);
    });

    it('does NOT match a call split across lines — documented as out of scope', () => {
        // `fetcher\n  .submit(` is deliberately outside the rule. No site in the
        // tree is written that way today, and widening the regex across newlines
        // makes it match unrelated member chains. If one ever appears, the
        // conversion pass will not see it — that is a known, written-down hole,
        // not an oversight.
        expect(findSubmitCallSites(`fetcher\n  .submit(payload, post);`)).toEqual([]);
    });

    it('returns a char offset and the trimmed source line as context', () => {
        const src = `const x = 1;\n    deleteFetcher.submit(payload, post);\n`;
        const [hit] = findSubmitCallSites(src);
        expect(hit.context).toBe(`deleteFetcher.submit(payload, post);`);
        expect(src.slice(hit.index).startsWith('deleteFetcher.submit(')).toBe(true);
    });
});

const HEALTHY = { scannedCount: 681, busyConsumers: 1, busyViolations: [] as string[] };

describe('evaluate — the baseline ratchet and the fail-closed floors', () => {
    it('passes a hit whose key is in the baseline', () => {
        const hits = new Map([['a.tsx::onSave::fetcher.submit(x, post);', 'a.tsx:9  fetcher.submit(x, post);']]);
        const r = evaluate({ ...HEALTHY, hits, baseline: { 'a.tsx::onSave::fetcher.submit(x, post);': 'Read, not a mutation.' } });
        expect(r.ok).toBe(true);
        expect(r.violations).toEqual([]);
    });

    it('fails a hit that is NOT in the baseline, and names it', () => {
        const hits = new Map([['a.tsx::onSave::fetcher.submit(x, post);', 'a.tsx:9  fetcher.submit(x, post);']]);
        const r = evaluate({ ...HEALTHY, hits, baseline: {} });
        expect(r.ok).toBe(false);
        expect(r.violations).toEqual(['a.tsx::onSave::fetcher.submit(x, post);']);
    });

    it('fails the SAME hit when its baseline entry has no reason', () => {
        const key = 'a.tsx::onSave::fetcher.submit(x, post);';
        const hits = new Map([[key, 'a.tsx:9  fetcher.submit(x, post);']]);
        for (const reason of ['', '   ']) {
            const r = evaluate({ ...HEALTHY, hits, baseline: { [key]: reason } });
            expect(r.ok).toBe(false);
            expect(r.reasonless).toEqual([key]);
        }
    });

    it('reports a stale baseline key but does NOT fail on it', () => {
        const key = 'a.tsx::onSave::fetcher.submit(x, post);';
        const hits = new Map([[key, 'a.tsx:9  fetcher.submit(x, post);']]);
        const r = evaluate({ ...HEALTHY, hits, baseline: { [key]: 'Read.', 'gone.tsx::x::y': 'Read.' } });
        expect(r.stale).toEqual(['gone.tsx::x::y']);
        expect(r.ok).toBe(true);
    });

    it('fails closed on a thin scan', () => {
        const hits = new Map([['a.tsx::onSave::fetcher.submit(x, post);', 'a.tsx:9  x']]);
        const r = evaluate({ ...HEALTHY, hits, baseline: { 'a.tsx::onSave::fetcher.submit(x, post);': 'Read.' }, scannedCount: 12 });
        expect(r.ok).toBe(false);
        expect(r.failures.join(' ')).toMatch(/examined nothing/);
    });

    it('fails closed when the scan finds zero call sites', () => {
        const r = evaluate({ ...HEALTHY, hits: new Map(), baseline: {} });
        expect(r.ok).toBe(false);
        expect(r.failures.join(' ')).toMatch(/ZERO/);
    });

    it('fails closed when the busy rule checked no consumer files', () => {
        const key = 'a.tsx::onSave::fetcher.submit(x, post);';
        const hits = new Map([[key, 'a.tsx:9  x']]);
        const r = evaluate({ ...HEALTHY, hits, baseline: { [key]: 'Read.' }, busyConsumers: 0 });
        expect(r.ok).toBe(false);
        expect(r.failures.join(' ')).toMatch(/useGuardedSubmit/);
    });

    it('fails on a busy violation — rule B has no baseline', () => {
        const key = 'a.tsx::onSave::fetcher.submit(x, post);';
        const hits = new Map([[key, 'a.tsx:9  x']]);
        const r = evaluate({ ...HEALTHY, hits, baseline: { [key]: 'Read.' }, busyViolations: ['b.tsx:4  submit bound without busy'] });
        expect(r.ok).toBe(false);
    });
});

const IMPORT = `import { useGuardedSubmit } from "~/hooks/useGuardedSubmit";`;

describe('findBusyViolations — the half-converted state the compiler cannot see', () => {
    it('flags submit bound without busy', () => {
        const src = `${IMPORT}\nconst { submit } = useGuardedSubmit();\n`;
        const v = findBusyViolations(src);
        expect(v).toHaveLength(1);
        expect(v[0].line).toBe(2);
        expect(v[0].reason).toMatch(/busy/);
    });

    it('flags a renamed submit bound without busy', () => {
        const src = `${IMPORT}\nconst { fetcher, submit: submitCreate } = useGuardedSubmit<Res>();\n`;
        expect(findBusyViolations(src)).toHaveLength(1);
    });

    it('flags busy bound but never referenced again', () => {
        // no-unused-vars is only a `warn` here, so nothing else catches this.
        const src = `${IMPORT}\nconst { submit: doIt, busy } = useGuardedSubmit();\ndoIt(payload, post);\n`;
        const v = findBusyViolations(src);
        expect(v).toHaveLength(1);
        expect(v[0].reason).toMatch(/never/);
    });

    it('flags a RENAMED busy that is never referenced again', () => {
        const src = `${IMPORT}\nconst { submit, busy: creating } = useGuardedSubmit();\nsubmit(payload, post);\n`;
        expect(findBusyViolations(src)).toHaveLength(1);
    });

    it('passes when busy reaches a control', () => {
        const src = `${IMPORT}\nconst { submit, busy } = useGuardedSubmit();\nreturn <Button disabled={busy} aria-busy={busy || undefined} onClick={() => submit(p, post)} />;\n`;
        expect(findBusyViolations(src)).toEqual([]);
    });

    it('passes a renamed busy that reaches a control', () => {
        const src = `${IMPORT}\nconst { fetcher, submit: submitCreate, busy: creating } = useGuardedSubmit();\nreturn <WizardLayout busy={creating} onSubmit={submitCreate} />;\n`;
        expect(findBusyViolations(src)).toEqual([]);
    });

    it('is NOT triggered by a file that imports only IDEMPOTENCY_FIELD', () => {
        // app/routes/inspections.tsx today: an action-side consumer of the
        // module, not a consumer of the hook.
        const src = `import { IDEMPOTENCY_FIELD } from "~/hooks/useGuardedSubmit";\nconst { submit } = somethingElse();\n`;
        expect(findBusyViolations(src)).toEqual([]);
    });

    it('honours the escape hatch when it carries a reason', () => {
        const src = `${IMPORT}\n// submit-guard-allow-no-busy: the control is a menu item that unmounts on click.\nconst { submit } = useGuardedSubmit();\n`;
        expect(findBusyViolations(src)).toEqual([]);
    });

    it('does NOT honour a bare escape hatch', () => {
        const src = `${IMPORT}\n// submit-guard-allow-no-busy:\nconst { submit } = useGuardedSubmit();\n`;
        expect(findBusyViolations(src)).toHaveLength(1);
    });
});

describe('findBusyViolations — the non-destructured consumer shape', () => {
    // app/routes/settings-data.tsx writes `const install = useGuardedSubmit(...)`
    // and reads `install.busy`. A rule that only inspects destructuring patterns
    // passes this file vacuously, which is the same blindness the gate exists to
    // stop — so the whole-object form is read too.
    it('flags a namespace binding whose .busy is never read', () => {
        const src = `${IMPORT}\nconst install = useGuardedSubmit<Res>();\ninstall.submit(payload, post);\n`;
        const v = findBusyViolations(src);
        expect(v).toHaveLength(1);
        expect(v[0].binding).toBe('install');
    });

    it('passes a namespace binding whose .busy reaches a control', () => {
        const src = `${IMPORT}\nconst install = useGuardedSubmit<Res>();\nreturn <Button disabled={install.busy} onClick={() => install.submit(p, post)} />;\n`;
        expect(findBusyViolations(src)).toEqual([]);
    });

    it('does not flag a namespace binding that never submits', () => {
        const src = `${IMPORT}\nconst install = useGuardedSubmit<Res>();\nreturn <span>{install.idempotencyKey}</span>;\n`;
        expect(findBusyViolations(src)).toEqual([]);
    });

    it('honours the escape hatch on the namespace form too', () => {
        const src = `${IMPORT}\n// submit-guard-allow-no-busy: the trigger unmounts on click.\nconst install = useGuardedSubmit<Res>();\ninstall.submit(p, post);\n`;
        expect(findBusyViolations(src)).toEqual([]);
    });
});
