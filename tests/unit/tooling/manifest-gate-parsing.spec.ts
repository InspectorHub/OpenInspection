/**
 * Proof that the two compliance-catalogue gates can still FIND the catalogue
 * they claim to check — OI #75.
 *
 * `scripts/check-erasure-manifest.mjs` and `scripts/check-retention-manifest.mjs`
 * both locate their arrays by parsing TypeScript as text. Both inherited the
 * same two-line parser from `scripts/check-non-translatable.mjs`, and with it
 * two defects that made them blind to the coarsest sabotage available:
 *
 *  1. `indexOf('export const NAME')` matches a PREFIX. Rename the catalogue to
 *     `NAME_V2` — breaking every consumer of it — and the search still hits, so
 *     the gate parsed the renamed copy and printed OK. Measured on the tracked
 *     files before the fix: the erasure gate reported
 *     "OK (56 rules, 113 out-of-scope declarations)" and the retention gate
 *     "OK (6 rules, 7 out-of-scope, 2 open)" with the array under test gone.
 *  2. The search was UNANCHORED, so it could land inside a doc comment that
 *     quotes the declaration. The gate then parses from the middle of a
 *     sentence, finds the `= []` inside the quotation, and reports zero
 *     entries. Also measured on the tracked files: both gates reported
 *     "parsed ZERO rules" with all 56 / all 6 rules sitting intact below the
 *     comment. That is a worse answer than defect 1's, not a better one — it
 *     blames the catalogue instead of the parser.
 *
 * ## Both defects are covered, because they mask each other
 *
 * The fix is a negative lookahead AND a `^` anchor, and either alone looks like
 * a fix. Add the lookahead only and the renamed-plus-quoted input stops saying
 * OK and starts saying "parsed ZERO rules" — a second wrong answer. So the
 * fixtures separate the cases: `-renamed` carries the rename with no prose
 * quoting it, `-renamed-quoted` carries both, and the gate must give the same
 * true answer to each.
 *
 * ## Every negative assertion is paired with a positive control
 *
 * `probe-manifest.ts` is a clean catalogue the gate must accept, so "it fails
 * on the renamed one" is not just a gate that fails on everything. The sharpest
 * pair is `probe-manifest-quoted.ts`: an INTACT catalogue with a doc comment
 * quoting its own declaration. A parser "hardened" by refusing any file that
 * mentions its array name would pass every failure test and break this one. It
 * is also the assertion that was RED before the fix — the unanchored parser
 * reported "parsed ZERO rules" for a perfectly good catalogue.
 *
 * The gates run as child processes rather than being imported, because the exit
 * code IS the contract: a gate that prints complaints and exits 0 is the
 * failure mode this whole family of checks was written after.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const ERASURE_GATE = path.join(ROOT, 'scripts', 'check-erasure-manifest.mjs');
const RETENTION_GATE = path.join(ROOT, 'scripts', 'check-retention-manifest.mjs');
const ERASURE_PROBE = 'scripts/fixtures/erasure-gate-probe';
const RETENTION_PROBE = 'scripts/fixtures/retention-gate-probe';

function run(gate: string, args: string[]): { status: number | null; output: string } {
    const res = spawnSync(process.execPath, [gate, ...args], { cwd: ROOT, encoding: 'utf8' });
    return { status: res.status, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

interface GateUnderTest {
    /** Vitest interpolates this into the suite title via `$name`. */
    name: string;
    gate: string;
    /** The line a healthy run starts with. */
    okPrefix: string;
    /** What the gate must say when the array it checks is not there. */
    missing: string;
    /** What it says when it parsed an array and got nothing out of it. */
    zero: string;
    /** The clean fixture's own counts — pins "found something", not just "exited 0". */
    probeOk: string;
    /** CLI args pointing the gate at one manifest variant in its probe directory. */
    probeArgs: (variant: string) => string[];
}

/**
 * Both gates get the identical battery. The two parsers are one shape, and
 * OI #75 exists precisely because a fix landed in one of the three copies and
 * not in the siblings.
 */
const GATES: GateUnderTest[] = [
    {
        name: 'erasure-manifest',
        gate: ERASURE_GATE,
        okPrefix: 'erasure-manifest lint: OK',
        missing: 'could not locate ERASURE_MANIFEST array',
        zero: 'parsed ZERO rules',
        probeOk: 'OK (2 rules, 1 out-of-scope declarations)',
        probeArgs: (variant) => [
            '--manifest', `${ERASURE_PROBE}/${variant}.ts`,
            '--out-of-scope', `${ERASURE_PROBE}/probe-out-of-scope.ts`,
            '--schema-dir', ERASURE_PROBE,
        ],
    },
    {
        name: 'retention-manifest',
        gate: RETENTION_GATE,
        okPrefix: 'retention-manifest lint: OK',
        missing: 'could not locate RETENTION_MANIFEST array',
        zero: 'parsed ZERO rules',
        probeOk: 'OK (2 rules, 1 out-of-scope, 0 open',
        probeArgs: (variant) => [
            '--manifest', `${RETENTION_PROBE}/${variant}.ts`,
            '--schema-dir', RETENTION_PROBE,
        ],
    },
];

describe.each(GATES)('$name gate — finding the catalogue it checks', (g) => {
    const onProbe = (variant: string) => run(g.gate, g.probeArgs(variant));

    describe('the real tree', () => {
        it('passes', () => {
            const { status, output } = run(g.gate, []);
            expect(output).toContain(g.okPrefix);
            expect(status).toBe(0);
        });

        it('reports a NON-ZERO catalogue', () => {
            // The positive control for every zero-entry assertion below. A gate
            // that parsed nothing would print OK too, so the real run is pinned
            // to "found something" rather than merely "did not complain".
            const { output } = run(g.gate, []);
            expect(output).toMatch(/OK \([1-9]\d* rules/);
        });
    });

    describe('the probe fixtures', () => {
        it('accepts the clean probe, and says how much it read', () => {
            // Without this, "fails on the renamed probe" is satisfied by a gate
            // that fails on every probe, and nothing below means anything.
            const { status, output } = onProbe('probe-manifest');
            expect(output).toContain(g.probeOk);
            expect(status).toBe(0);
        });

        it('FAILS when the array is renamed to a name it merely prefixes', () => {
            // Defect 1. Before the lookahead, this exact input printed the same
            // OK line the clean probe does — a renamed catalogue reported as a
            // healthy one. The message matters as much as the exit code: the
            // gate has to say the array is MISSING.
            const { status, output } = onProbe('probe-manifest-renamed');
            expect(status).toBe(1);
            expect(output).toContain(g.missing);
            expect(output).not.toContain(g.okPrefix);
        });

        it('FAILS with "missing", not "zero", when prose also quotes the declaration', () => {
            // Defect 2, and the assertion that separates a real fix from a half
            // one. With the lookahead but no `^` anchor this input reported
            // "parsed ZERO rules" — the parser lands mid-sentence, reads the
            // `= []` inside the quotation, and accuses the catalogue of being
            // empty. Asserting the ABSENCE of that string is the whole point.
            const { status, output } = onProbe('probe-manifest-renamed-quoted');
            expect(status).toBe(1);
            expect(output).toContain(g.missing);
            expect(output).not.toContain(g.zero);
        });

        it('still finds an INTACT array when a doc comment quotes its declaration', () => {
            // The control that stops the two assertions above passing vacuously,
            // and the one that was RED before the anchor landed: the unanchored
            // parser reported "parsed ZERO rules" for this complete catalogue.
            // A parser that simply refused any file mentioning its array name
            // would pass both failure tests and break here.
            const { status, output } = onProbe('probe-manifest-quoted');
            expect(output).toContain(g.probeOk);
            expect(status).toBe(0);
        });

        it('FAILS when the array is present, parseable and EMPTY', () => {
            // The zero-entry guard. "Found nothing" and "looked at nothing"
            // produce the same empty list, and every other rule in these gates
            // reports on what was parsed — so without this the gate prints a
            // clean bill of health for a catalogue it failed to read.
            const { status, output } = onProbe('probe-manifest-empty');
            expect(status).toBe(1);
            expect(output).toContain(g.zero);
            expect(output).not.toContain(g.okPrefix);
        });
    });
});

/**
 * Retention-only, because the erasure gate has no legal-hold field to disagree
 * with. Kept beside the shared battery rather than in a file of its own: it runs
 * the same gate over the same probe directory, and splitting it would separate
 * the check from the fixtures it depends on.
 */
describe('retention-manifest gate — legal-hold classification vs the schema', () => {
    const onProbe = (variant: string) => run(RETENTION_GATE, [
        '--manifest', `${RETENTION_PROBE}/${variant}.ts`,
        '--schema-dir', RETENTION_PROBE,
    ]);

    it('accepts a classification that matches the schema', () => {
        // The positive control. Without it, the failure below is satisfied by a
        // check that rejects every classification.
        const { status, output } = onProbe('probe-manifest');
        expect(status).toBe(0);
        expect(output).toContain('1 enforced by tenant filter');
    });

    it('FAILS a rule that exempts a table which HAS a tenant column', () => {
        // The quiet failure: everything parses, the note is present, and a table
        // that could have honoured a preservation order is silently exempt.
        const { status, output } = onProbe('probe-manifest-hold-mismatch');
        expect(status).toBe(1);
        expect(output).toContain("DOES carry text('tenant_id')");
    });

    it('prints the classification counts beside the verdict', () => {
        // A gate that only prints a verdict cannot be checked on the day it is
        // green, which is the day it matters.
        const { output } = run(RETENTION_GATE, []);
        expect(output).toMatch(/legal hold: [1-9]\d* enforced by tenant filter/);
    });
});

describe('the three catalogue parsers are one shape', () => {
    // OI #75 exists because the anchor + lookahead were fixed in
    // `check-non-translatable.mjs` and the two siblings kept the broken copy for
    // as long as nobody renamed a catalogue. Prose asking the next person to
    // keep them in sync is what failed the first time; this asserts it instead.
    const PARSERS = [
        'scripts/check-non-translatable.mjs',
        'scripts/check-erasure-manifest.mjs',
        'scripts/check-retention-manifest.mjs',
    ];
    const readGate = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
    const ANCHORED = 'text.search(new RegExp(`^export const ${name}(?![A-Za-z0-9_$])`, "m"))';
    const PREFIX_SEARCH = 'text.indexOf(`export const ${name}`)';

    it.each(PARSERS)('%s locates the declaration line-anchored and lookahead-guarded', (rel) => {
        expect(readGate(rel)).toContain(ANCHORED);
    });

    it.each(PARSERS)('%s no longer locates the declaration by prefix search', (rel) => {
        // Paired with the assertion above: one says the right shape is present,
        // this says the wrong one is gone. A parser carrying both — a fixed
        // `arrayBody` beside a forgotten second copy — satisfies only the first.
        expect(readGate(rel)).not.toContain(PREFIX_SEARCH);
    });
});
