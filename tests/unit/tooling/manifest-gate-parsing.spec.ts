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
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
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

/**
 * Erasure-only: the enforcement deadlines the manifest carries, and whether
 * anybody finds out about them before the build stops.
 *
 * `check-erasure-manifest.mjs` already FAILS once a pending rule's
 * `enforcementDeadline` has passed. That is the right end state and the wrong
 * only signal: the ten address-family rules carry 2027-02-01, and until that
 * morning every run of this gate said "OK" in exactly the tone it will use on
 * the day before. A deadline whose entire notice period is the moment it breaks
 * CI is a deadline nobody can plan around — it lands as an interruption on
 * whoever happens to be committing, which is the opposite of the review the
 * date was chosen to buy.
 *
 * So two things are asserted here, and they are the same thing twice:
 *
 *  1. A pending rule inside the lead-time window WARNS, by name, and the run
 *     still exits 0. A warning that fails the build is just an earlier
 *     deadline, and would be moved rather than acted on.
 *  2. Every run — green included — prints how many rules are pending and when
 *     the nearest one is due. `scripts/check-retention-policy.mjs` states the
 *     house rule this comes from: a gate prints the numbers it is guarding on
 *     every run, never a verdict alone, because the day it is green is the day
 *     somebody needs to be able to check it.
 *
 * Lives beside the parsing battery rather than in a file of its own for the
 * same reason the retention legal-hold block does: same gate, same probe
 * directory, same child-process runner. Splitting it would separate the checks
 * from the fixtures they depend on.
 */
describe('erasure-manifest gate — enforcement deadlines before they bite', () => {
    const SCRATCH_REL = '.gate-cache';
    const RENDERED_REL = `${SCRATCH_REL}/erasure-deadline-probe.ts`;
    const RENDERED = path.join(ROOT, RENDERED_REL);
    const TEMPLATE = path.join(ROOT, ERASURE_PROBE, 'probe-manifest-deadlines.template.ts');

    /** A YYYY-MM-DD date `days` from now, computed rather than written down. */
    const isoInDays = (days: number) =>
        new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    /**
     * Render the template against the CURRENT clock and run the gate on it.
     *
     * The rendered file goes to `.gate-cache/` (gitignored scratch) rather than
     * into the probe directory: a generated file sitting next to tracked
     * fixtures is one interrupted run away from being committed, and a
     * committed copy would carry dates that were only correct on the day it was
     * written. The gate resolves `--manifest` against the repo root, so the
     * path has to stay inside the tree — an OS temp dir on another drive does
     * not survive that join on Windows.
     */
    function runWithDeadlines(nearDays: number, farDays: number) {
        // Global, not first-match: the template's own doc comment names both
        // tokens, so a plain string replace substitutes the PROSE and leaves
        // the rules holding a literal token — which the gate then rejects as
        // "not YYYY-MM-DD", a red test that looks like it proved something.
        const rendered = readFileSync(TEMPLATE, 'utf8')
            .replace(/__DEADLINE_NEAR__/g, isoInDays(nearDays))
            .replace(/__DEADLINE_FAR__/g, isoInDays(farDays));
        mkdirSync(path.join(ROOT, SCRATCH_REL), { recursive: true });
        writeFileSync(RENDERED, rendered, 'utf8');
        return run(ERASURE_GATE, [
            '--manifest', RENDERED_REL,
            '--out-of-scope', `${ERASURE_PROBE}/probe-out-of-scope.ts`,
            '--schema-dir', ERASURE_PROBE,
        ]);
    }

    afterAll(() => rmSync(RENDERED, { force: true }));

    it('WARNS by name when a pending deadline is inside the lead-time window', () => {
        const { status, output } = runWithDeadlines(45, 400);
        expect(output).toContain('inspections.property_address');
        expect(output).toMatch(/approach/i);
        // A warning is a warning. If this ever exits 1, the lead time has become
        // a second deadline and the only way back to green is to move the date.
        expect(status).toBe(0);
    });

    it('stays silent about a pending rule that is nowhere near its deadline', () => {
        // The positive control, and the only thing separating "warns about the
        // right rule" from "warns about every pending rule" — which would fire
        // on all ten address rules today and be tuned out by next week.
        const { status, output } = runWithDeadlines(45, 400);
        expect(status).toBe(0);
        expect(output).not.toContain('inspections.address_city');
    });

    it('says nothing at all when every pending deadline is far away', () => {
        // The other half of that control: with no rule inside the window there
        // must be no warning header either. A gate that prints the heading
        // unconditionally reads as a live warning to anyone scanning output.
        const { status, output } = runWithDeadlines(300, 400);
        expect(status).toBe(0);
        expect(output).not.toMatch(/approach/i);
        expect(output).toContain('erasure-manifest lint: OK');
    });

    it('prints the pending count and the nearest deadline on a GREEN real-tree run', () => {
        // The number this gate is guarding, on the run where nobody is looking.
        // Ten rules currently sit pending against 2027-02-01; a run that prints
        // only "OK (N rules, M out-of-scope)" cannot tell anyone that.
        const { status, output } = run(ERASURE_GATE, []);
        expect(status).toBe(0);
        expect(output).toMatch(
            /[1-9]\d* pending enforcement \(nearest deadline \d{4}-\d{2}-\d{2}, -?\d+ days?\)/,
        );
    });

    it('prints the same line on a FAILING run', () => {
        // Both numbers on every run, pass or fail. A summary that only survives
        // the happy path is missing from precisely the runs someone is reading
        // closely — a red gate is when people actually read the output.
        //
        // The REAL manifest against the PROBE out-of-scope register: every rule
        // is genuine, so the pending set is the real one, and the coverage arm
        // fails because the tiny probe register excuses none of the schema's
        // uncovered columns. The failure is real and has nothing to do with
        // deadlines, which is the point.
        const { status, output } = run(ERASURE_GATE, [
            '--out-of-scope', `${ERASURE_PROBE}/probe-out-of-scope.ts`,
        ]);
        expect(status).toBe(1);
        expect(output).toMatch(
            /[1-9]\d* pending enforcement \(nearest deadline \d{4}-\d{2}-\d{2}, -?\d+ days?\)/,
        );
    });
});
