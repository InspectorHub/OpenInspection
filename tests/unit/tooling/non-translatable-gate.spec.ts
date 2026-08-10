/**
 * Proof that the non-translatable content registry gate
 * (`scripts/check-non-translatable.mjs`) bites — OI #58.
 *
 * The rule it enforces: review review named eight categories of content
 * inside the report and the agreement — reliance clauses, limitation of
 * liability, arbitration, warranty disclaimer, governing law, contract terms,
 * signatures, acknowledgements — and ruled that they are a legal instrument
 * rather than content. English is authoritative for all eight.
 *
 * ## Why this spec is the whole enforcement today
 *
 * Report courtesy translation (#23) is `not_released`. Nothing reads the
 * registry at runtime and nothing will until that ships, so the registry's only
 * enemy for now is decay: a renamed constant, a moved file, a ninth category
 * added to the type and not the list. Every assertion below is about the gate
 * noticing decay, because that is the failure that would hand #23 a register
 * that looks authoritative and is not.
 *
 * ## Every negative assertion is paired with a positive control
 *
 * A gate that flagged everything it read would satisfy each "it fails when X"
 * test on its own. So the probe fixture carries clean entries alongside the
 * broken ones, and this spec asserts the clean ones are NOT named. The sharpest
 * pair is the catalogue-import rule: the probe registers the SAME
 * paraglide-importing file twice — once in the manifest, where it must fail,
 * and once in the out-of-scope register, where it must pass. One flagged line,
 * not two, is what proves the rule is scoped to the instrument rather than
 * fired at any translation it sees.
 *
 * It runs the gate as a child process rather than importing it, because the
 * exit code IS the contract — a gate that prints complaints and exits 0 is the
 * failure mode this whole family of checks was written after.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GATE = path.join(ROOT, 'scripts', 'check-non-translatable.mjs');
const PROBE = 'scripts/fixtures/non-translatable-probe';
const PROBE_EMPTY = 'scripts/fixtures/non-translatable-probe-empty';
const PROBE_RENAMED = 'scripts/fixtures/non-translatable-probe-renamed';

function runGate(...args: string[]) {
    const res = spawnSync(process.execPath, [GATE, ...args], { cwd: ROOT, encoding: 'utf8' });
    return { status: res.status, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

/** The violation lines only — the gate's own prose quotes rule vocabulary. */
function violationLines(output: string): string[] {
    return output.split('\n').filter((l) => /^ {2}\S/.test(l));
}

describe('non-translatable registry gate', () => {
    it('passes on the real registry', () => {
        const { status, output } = runGate();
        expect(output).toContain('non-translatable lint: OK');
        expect(status).toBe(0);
    });

    it('reports a NON-EMPTY registry covering all eight categories', () => {
        // The positive control for every "it fails when the registry is empty"
        // assertion below. A gate that parsed nothing would also print OK, so
        // the real run has to be pinned to "found something" — and to eight of
        // eight, since seven of eight is what a decayed register looks like.
        const { output } = runGate();
        expect(output).toMatch(/[1-9]\d* manifest entries covering 8\/8 review categories/);
        expect(output).toMatch(/[1-9]\d* out-of-scope/);
    });

    describe('against the probe fixture', () => {
        const { status, output } = runGate('--fixture', PROBE);
        const violations = violationLines(output);

        it('fails', () => {
            expect(status).toBe(1);
            expect(violations.length).toBeGreaterThan(0);
        });

        it('names an entry with an empty reason', () => {
            expect(output).toContain("manifest #3 (probe-empty-reason): missing/empty 'reason'.");
        });

        it('names an entry with no locator at all', () => {
            expect(output).toContain("manifest #4 (probe-no-locator): missing/empty 'locator'.");
        });

        it('names a category review never ruled on', () => {
            expect(output).toContain("category 'shipping_terms' is not one of the eight");
        });

        it('names a source path that no longer exists', () => {
            expect(output).toContain("source 'probe-file-that-was-moved.ts' does not exist");
        });

        it('names a locator that no longer occurs in its source', () => {
            expect(output).toContain(
                "locator 'PROBE_RENAMED_AWAY' does not occur in 'probe-clean-source.ts'",
            );
        });

        it('names instrument text wired into the message catalogue', () => {
            expect(output).toContain("manifest #8 (probe-catalogue-rendered)");
            expect(output).toContain('imports the message catalogue (~/paraglide)');
        });

        it('names the category with no entry, which is the check nothing else makes', () => {
            // The registry's scope is enumerated, not discovered — no schema
            // scan can tell anyone that arbitration went missing.
            expect(output).toContain("category 'arbitration' has NO manifest entry");
        });

        it('names an exclusion with no reason', () => {
            expect(output).toContain(
                "out-of-scope #2 (oos-probe-no-reason): missing/empty 'reason'.",
            );
        });

        it('names an exclusion pointing at a deleted file', () => {
            expect(output).toContain("source 'probe-file-that-was-deleted.ts' does not exist");
        });

        it('names a duplicated id, and an id claimed by both registers', () => {
            expect(output).toContain(
                "id 'probe-ok-signature' appears twice in NON_TRANSLATABLE_MANIFEST",
            );
            expect(output).toContain(
                "id 'probe-shared-id' appears in both NON_TRANSLATABLE_MANIFEST and " +
                'NON_TRANSLATABLE_OUT_OF_SCOPE',
            );
        });

        it('leaves the well-formed manifest entry alone', () => {
            // `probe-ok-reliance` is complete and correct. If it appears in the
            // output at all, the gate is flagging everything it reads and every
            // assertion above means nothing.
            expect(violations.join('\n')).not.toContain('probe-ok-reliance');
        });

        it('leaves the well-formed exclusion alone', () => {
            expect(violations.join('\n')).not.toContain('oos-probe-ok');
        });

        it('scopes the catalogue rule to the manifest, not to every paraglide import', () => {
            // The decisive control. `probe-translated-source.ts` is registered
            // TWICE: in the manifest (must fail — instrument text cannot be
            // catalogue-rendered) and in the out-of-scope register (must pass —
            // a platform notice legitimately is). Exactly one line may name it.
            const named = violations.filter((l) => l.includes('probe-translated-source.ts'));
            expect(named).toHaveLength(1);
            expect(named[0]).toContain('probe-catalogue-rendered');
        });

        it('does not report the existing probe source as missing', () => {
            // Pairs with the "source does not exist" assertion: the gate must
            // distinguish a real path from a dead one, not report both.
            expect(output).not.toContain("source 'probe-clean-source.ts' does not exist");
        });
    });

    describe('the self-guard, which is the one this repo keeps needing', () => {
        it('FAILS when both arrays are present, parseable and empty', () => {
            // "Found nothing" and "looked at nothing" produce the same empty
            // list. Every other rule reports on what was parsed, so without
            // this the gate prints a clean bill of health for a registry it
            // failed to read.
            const { status, output } = runGate('--fixture', PROBE_EMPTY);
            expect(status).toBe(1);
            expect(output).toContain('parsed ZERO manifest entries');
        });

        it('FAILS when the manifest array has been renamed out from under it', () => {
            // Regression guard for a hole this gate shipped with and was caught
            // by breaking the real file: the declaration used to be located
            // with `indexOf`, which matched the prefix of the renamed array and
            // parsed it happily. The positive control is the real-tree run
            // above — correctly named arrays are still found.
            const { status, output } = runGate('--fixture', PROBE_RENAMED);
            expect(status).toBe(1);
            expect(output).toContain('could not locate NON_TRANSLATABLE_MANIFEST array');
        });

        it('FAILS rather than parsing empty when the registry file is absent', () => {
            const { status, output } = runGate('--fixture', 'scripts/fixtures/does-not-exist');
            expect(status).toBe(1);
            expect(output).toContain('manifest not found');
        });
    });
});
