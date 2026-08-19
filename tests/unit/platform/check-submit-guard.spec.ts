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

type Ratchet = {
    ok: boolean;
    awaitingTotal: number;
    ceilingTotal: number;
    over: string[];
    under: string[];
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
let awaitingByFile: (baseline: Record<string, string>) => Map<string, number>;
let evaluateAwaitingRatchet: (input: {
    awaiting: Map<string, number>;
    ceiling: Record<string, number> | null;
}) => Ratchet;

beforeAll(async () => {
    const scriptPath = path.resolve(
        import.meta.dirname ?? path.join(process.cwd()),
        '../../../scripts/check-submit-guard.mjs',
    );
    // @vite-ignore — load the .mjs via native Node import.
    ({ findSubmitCallSites, findBusyViolations, evaluate, awaitingByFile, evaluateAwaitingRatchet } =
        await import(/* @vite-ignore */ pathToFileURL(scriptPath).href));
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

    it('flags a fetcher whose NAME does not contain "fetcher"', () => {
        // Miscount #2, and the reason the `*Fetcher` rule above is not enough:
        // it covers 53 identifiers and every one of them ends in "fetcher", so
        // a fetcher called `write` was never seen at all — not reported, not
        // baselined, not counted in the awaiting ceiling. Three real files were
        // in that state (StaffNoticeBell, CommunicationSection, messages.tsx).
        const src = [
            `const write = useFetcher<{ ok?: boolean }>();`,
            `write.submit({ intent }, { method: "post" });`,
        ].join('\n');
        const hits = findSubmitCallSites(src);
        expect(hits).toHaveLength(1);
        expect(hits[0].line).toBe(2);
        expect(hits[0].ident).toBe('write');
    });

    it('counts a declared fetcher ONCE even when its name also matches the shape rule', () => {
        // The two passes must not double-count: `deleteFetcher` is found by the
        // shape rule AND declared via useFetcher. A duplicate here would inflate
        // rawSites past hits.size and trip the key-collision failure instead.
        const src = [
            `const deleteFetcher = useFetcher();`,
            `deleteFetcher.submit(a, post);`,
        ].join('\n');
        expect(findSubmitCallSites(src)).toHaveLength(1);
    });

    it('does NOT flag a `.submit()` on something the file never declared as a fetcher', () => {
        // The blunt fix for miscount #2 — `\\w+\\.submit\\s*\\(` — matches this and
        // every unrelated member chain in the tree. The rule reads DECLARATIONS
        // instead, so a form is still a form.
        expect(findSubmitCallSites(`formRef.current.submit();`)).toEqual([]);
        expect(findSubmitCallSites(`const form = document.forms[0];\nform.submit();`)).toEqual([]);
    });

    it('finds hits in source order regardless of which pass saw them', () => {
        const src = [
            `const write = useFetcher();`,
            `deleteFetcher.submit(a, post);`,
            `write.submit(b, post);`,
            `coverFetcher.submit(c, post);`,
        ].join('\n');
        expect(findSubmitCallSites(src).map((h) => h.line)).toEqual([2, 3, 4]);
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

const AWAITING = 'AWAITING #106 CONVERSION — a user mutation, not converted yet.';
const EXEMPT = 'Not a mutation — a poll.';

describe('awaitingByFile — the debt the baseline DECLARES', () => {
    it('counts only entries carrying the AWAITING marker, grouped by file', () => {
        const per = awaitingByFile({
            'a.tsx::x::fetcher.submit(1);': AWAITING,
            'a.tsx::y::fetcher.submit(2);': AWAITING,
            'a.tsx::z::fetcher.submit(3);': EXEMPT,
            'b.tsx::x::fetcher.submit(4);': AWAITING,
        });
        expect([...per.entries()].sort()).toEqual([
            ['a.tsx', 2],
            ['b.tsx', 1],
        ]);
    });

    it('reads the debt from the BASELINE, so a converted site stays counted until --update', () => {
        // Converting a call site removes the raw submit, which makes its key
        // stale — reported, not failed — and the entry survives until someone
        // runs the flag. Counting HITS instead would turn every conversion red
        // and teach people to run --update without reading it.
        expect(awaitingByFile({ 'gone.tsx::x::fetcher.submit(1);': AWAITING }).get('gone.tsx')).toBe(1);
    });

    it('does not count an entry with no reason at all', () => {
        expect(awaitingByFile({ 'a.tsx::x::fetcher.submit(1);': '' }).size).toBe(0);
    });
});

describe('evaluateAwaitingRatchet — the backlog may only shrink', () => {
    it('passes when the declared debt equals the ceiling', () => {
        const r = evaluateAwaitingRatchet({ awaiting: new Map([['a.tsx', 2]]), ceiling: { 'a.tsx': 2 } });
        expect(r.ok).toBe(true);
        expect([r.awaitingTotal, r.ceilingTotal]).toEqual([2, 2]);
    });

    it('FAILS when the backlog grows, and NAMES the file', () => {
        const r = evaluateAwaitingRatchet({ awaiting: new Map([['a.tsx', 3]]), ceiling: { 'a.tsx': 2 } });
        expect(r.ok).toBe(false);
        expect(r.over).toEqual(['a.tsx']);
        expect(r.failures.join(' ')).toMatch(/GREW: 3 awaiting against a ceiling of 2.*a\.tsx \(3 > 2\)/);
    });

    it('POSITIVE CONTROL — a file the ceiling declares NOTHING about is visible, not skipped', () => {
        // The shape a new offender actually arrives in: a path that appears in
        // no ceiling entry at all. A gate that iterates the ceiling instead of
        // the union would never look at it, and would report green.
        const r = evaluateAwaitingRatchet({
            awaiting: new Map([
                ['known.tsx', 2],
                ['brand-new.tsx', 1],
            ]),
            ceiling: { 'known.tsx': 2 },
        });
        expect(r.ok).toBe(false);
        expect(r.over).toEqual(['brand-new.tsx']);
        expect(r.failures.join(' ')).toContain('brand-new.tsx (1 > 0)');
    });

    it('FAILS on a slack ceiling too, and NAMES the file — free slots are how debt returns', () => {
        const r = evaluateAwaitingRatchet({ awaiting: new Map([['a.tsx', 1]]), ceiling: { 'a.tsx': 2 } });
        expect(r.ok).toBe(false);
        expect(r.under).toEqual(['a.tsx']);
        expect(r.failures.join(' ')).toMatch(/slack.*1 free slot\(s\).*a\.tsx \(1 < 2\)/);
    });

    it('lets a move between files pass — the verdict is on the total, not per file', () => {
        // Per-file numbers are diagnosis. Enforcing them would make renaming a
        // component a gate failure, which is the false-alarm direction that
        // teaches people to bypass a gate.
        const r = evaluateAwaitingRatchet({
            awaiting: new Map([['moved.tsx', 2]]),
            ceiling: { 'original.tsx': 2 },
        });
        expect(r.ok).toBe(true);
        expect([r.over, r.under]).toEqual([['moved.tsx'], ['original.tsx']]);
    });

    it('FAILS when the marker matches nothing while the ceiling still holds debt', () => {
        // An empty result reads as a finished burn-down, and that is the most
        // attractive wrong answer this gate can give.
        const r = evaluateAwaitingRatchet({ awaiting: new Map(), ceiling: { 'a.tsx': 2 } });
        expect(r.ok).toBe(false);
        expect(r.failures.join(' ')).toMatch(/matched ZERO baseline entries while the ceiling still holds 2/);
    });

    it('FAILS when the ceiling cannot be read — an unreadable input is never "nothing to report"', () => {
        for (const ceiling of [null, [] as unknown as Record<string, number>]) {
            const r = evaluateAwaitingRatchet({ awaiting: new Map([['a.tsx', 1]]), ceiling });
            expect(r.ok).toBe(false);
            expect(r.failures.join(' ')).toMatch(/missing or is not a JSON object/);
        }
    });

    it('FAILS on a ceiling value that is not a non-negative integer', () => {
        const r = evaluateAwaitingRatchet({
            awaiting: new Map([['a.tsx', 1]]),
            ceiling: { 'a.tsx': 1, 'b.tsx': -1, 'c.tsx': 'many' as unknown as number },
        });
        expect(r.ok).toBe(false);
        expect(r.failures.join(' ')).toMatch(/b\.tsx = -1.*c\.tsx = "many"/);
    });

    it('passes an empty ceiling against an empty backlog — nothing frozen, nothing owed', () => {
        expect(evaluateAwaitingRatchet({ awaiting: new Map(), ceiling: {} }).ok).toBe(true);
    });
});

describe('the two committed files agree', () => {
    it('the ceiling equals the baseline\'s declared debt, file by file', async () => {
        // The seed is by hand and the ratchet only ever tightens, so the two can
        // drift apart in exactly one way: somebody edits the baseline and not
        // the ceiling. That is the drift the gate exists to catch, and this
        // asserts the committed state is the state the gate reports green.
        const { readFileSync } = await import('node:fs');
        const dir = path.resolve(import.meta.dirname ?? process.cwd(), '../../../scripts');
        const baseline = JSON.parse(readFileSync(path.join(dir, 'submit-guard-baseline.json'), 'utf8'));
        const ceiling = JSON.parse(readFileSync(path.join(dir, 'submit-guard-awaiting-ceiling.json'), 'utf8'));
        const r = evaluateAwaitingRatchet({ awaiting: awaitingByFile(baseline), ceiling });
        expect({ over: r.over, under: r.under, failures: r.failures }).toEqual({
            over: [],
            under: [],
            failures: [],
        });

        // The burn-down is DONE: zero awaiting, and a ceiling of exactly {}.
        //
        // ⚠️ This used to read `expect(r.awaitingTotal).toBeGreaterThan(0)` — a
        // guard against a vacuously green ratchet, and the right assertion right
        // up until the day the debt actually reached zero. Deleting it outright
        // would leave "0 == 0" as the whole test, which passes just as happily
        // when the marker has stopped matching as when the work is finished.
        // So the emptiness is asserted POSITIVELY instead, against the two facts
        // that distinguish the two states: the baseline is large and every entry
        // in it carries a written reason, and the ceiling is the empty object
        // rather than a stale set of open slots. The marker's own liveness is
        // pinned separately by the awaitingByFile block above, which hands it a
        // genuine AWAITING reason and requires a count of 1.
        expect(r.awaitingTotal).toBe(0);
        expect(ceiling).toEqual({});
        const keys = Object.keys(baseline);
        expect(keys.length).toBeGreaterThan(40);
        expect(keys.filter((k) => !String(baseline[k] ?? '').trim())).toEqual([]);
    });

    it('a single AWAITING entry fails against the zeroed ceiling', () => {
        // What the zero actually buys, asserted rather than assumed: with no
        // slots left open, one new debt entry is `1 > 0` and fails on the spot.
        const r = evaluateAwaitingRatchet({
            awaiting: awaitingByFile({ 'new.tsx::onSave::fetcher.submit(x);': AWAITING }),
            ceiling: {},
        });
        expect(r.ok).toBe(false);
        expect(r.failures.join(' ')).toMatch(/backlog GREW: 1 awaiting against a ceiling of 0/);
        expect(r.over).toEqual(['new.tsx']);
    });
});
