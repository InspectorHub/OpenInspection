/**
 * The two house rules of a wizard in this product, applied to imports.
 *
 * A step with nothing to decide is not rendered as an empty shell — it is not
 * in the list at all. And a disabled control states its own condition as a
 * sentence naming the FIRST thing to fix reading down the run, rather than
 * returning a boolean the screen has to invent an explanation for.
 *
 * Both live in a module of pure functions so they can be asserted. A rule
 * expressed only in JSX is a rule that gets a second, slightly different
 * implementation the next time somebody adds a step.
 *
 * The assertions that matter here are the ones that COMPARE. "The mapping step
 * is present" is true of nearly every run and would stay green against a model
 * that never dropped anything; so the tests below pair each case with a run
 * that differs in exactly one property, and assert the ORDER of the result
 * rather than only its membership.
 */
import { describe, expect, it } from 'vitest';
import {
    IMPORT_STEP_ORDER,
    currentImportStep,
    importNextBlockedReason,
    importStepsFor,
    type ImportRunView,
} from './import-wizard-steps';

const copy = {
    needsFile: 'Choose the file you exported.',
    fixProblemsFirst: (n: number) => `${n} entries still need fixing.`,
    needsNameColumn: 'Choose which column holds the name.',
};

function run(over: Partial<ImportRunView> = {}): ImportRunView {
    return { status: 'staged', hasMapping: true, problemCount: 0, blockedReason: null, ...over };
}

/** Every shape of run the rules distinguish, for the invariants that hold over all of them. */
function everyRun(): ImportRunView[] {
    const runs: ImportRunView[] = [];
    for (const status of ['staged', 'applied', 'partially_applied', 'needs_assistance', 'expired']) {
        for (const hasMapping of [true, false]) {
            for (const problemCount of [0, 1, 5]) {
                runs.push(run({ status, hasMapping, problemCount }));
            }
        }
    }
    return runs;
}

describe('IMPORT_STEP_ORDER', () => {
    it('is the only place the order of the steps is written down', () => {
        expect([...IMPORT_STEP_ORDER]).toEqual(['upload', 'mapping', 'repair', 'import']);
    });
});

describe('importStepsFor', () => {
    it('shows every step for a spreadsheet with problems', () => {
        expect(importStepsFor(run({ hasMapping: true, problemCount: 3 })))
            .toEqual(['upload', 'mapping', 'repair', 'import']);
    });

    it('drops the mapping step for a source with no columns to map', () => {
        // The vendor export has no columns, so there is no question to ask.
        expect(importStepsFor(run({ hasMapping: false, problemCount: 2 })))
            .toEqual(['upload', 'repair', 'import']);
    });

    it('drops the repair step when nothing needs repairing', () => {
        expect(importStepsFor(run({ hasMapping: true, problemCount: 0 })))
            .toEqual(['upload', 'mapping', 'import']);
    });

    it('drops both when neither has anything to decide', () => {
        expect(importStepsFor(run({ hasMapping: false, problemCount: 0 })))
            .toEqual(['upload', 'import']);
    });

    it('changes by exactly the mapping step when exactly that property changes', () => {
        // The pairs above each differ in two properties, so on their own they
        // cannot say WHICH one moved the step. These two differ in one.
        const withColumns = run({ hasMapping: true, problemCount: 2 });
        const withoutColumns: ImportRunView = { ...withColumns, hasMapping: false };

        expect(importStepsFor(withColumns)).toEqual(['upload', 'mapping', 'repair', 'import']);
        expect(importStepsFor(withoutColumns)).toEqual(['upload', 'repair', 'import']);
        expect(importStepsFor(withColumns)).not.toEqual(importStepsFor(withoutColumns));
    });

    it('changes by exactly the repair step when exactly that property changes', () => {
        const clean = run({ hasMapping: true, problemCount: 0 });
        const broken: ImportRunView = { ...clean, problemCount: 1 };

        expect(importStepsFor(clean)).toEqual(['upload', 'mapping', 'import']);
        expect(importStepsFor(broken)).toEqual(['upload', 'mapping', 'repair', 'import']);
    });

    it('puts mapping before repair, never the other way round', () => {
        const steps = importStepsFor(run({ hasMapping: true, problemCount: 1 }));
        // Positive control first: two absent steps would both index at -1 and
        // satisfy nothing, so assert they are there before comparing them.
        expect(steps).toContain('mapping');
        expect(steps).toContain('repair');
        expect(steps.indexOf('mapping')).toBeLessThan(steps.indexOf('repair'));
    });

    it('always keeps upload and import', () => {
        for (const hasMapping of [true, false]) {
            for (const problemCount of [0, 5]) {
                const steps = importStepsFor(run({ hasMapping, problemCount }));
                expect(steps[0]).toBe('upload');
                expect(steps[steps.length - 1]).toBe('import');
            }
        }
    });

    it('emits whatever it emits in the declared order, with no repeats', () => {
        for (const r of everyRun()) {
            const steps = importStepsFor(r);
            expect(steps).toEqual(IMPORT_STEP_ORDER.filter((step) => steps.includes(step)));
            expect(new Set(steps).size).toBe(steps.length);
        }
    });

    it('shows only upload for a run that is waiting on a person', () => {
        // There is nothing to map, repair or apply until a converted file lands.
        expect(importStepsFor(run({ status: 'needs_assistance' }))).toEqual(['upload']);
    });

    it('shows only upload while waiting, whatever the rest of the run says', () => {
        // Positive control for the case above: the same run that is NOT waiting
        // keeps all four, so the collapse is the status and not the fixture.
        const waiting = run({ status: 'needs_assistance', hasMapping: true, problemCount: 4 });
        const staged: ImportRunView = { ...waiting, status: 'staged' };

        expect(importStepsFor(waiting)).toEqual(['upload']);
        expect(importStepsFor(staged)).toEqual(['upload', 'mapping', 'repair', 'import']);
    });

    it('drops the mapping step once the stored file is gone, whatever the run was made from', () => {
        // An expired run's file has been swept, so there is no mapping left to
        // change. That arrives here as hasMapping, not as a status of its own.
        expect(importStepsFor(run({ status: 'expired', hasMapping: false })))
            .toEqual(['upload', 'import']);
    });

    it('reads nothing about WHICH product the file came from', () => {
        // The skip is a fact about the adapter's shape — an adapter with no
        // inspect() reports no columns — and reaches this module as hasMapping.
        // A model that reached for the vendor instead would need this property,
        // and would answer differently for these two runs.
        const spreadsheet: ImportRunView & { vendor: string } =
            { ...run({ hasMapping: true }), vendor: 'csv_generic' };
        const vendorExport: ImportRunView & { vendor: string } =
            { ...run({ hasMapping: true }), vendor: 'spectora' };

        expect(importStepsFor(spreadsheet)).toEqual(importStepsFor(vendorExport));
        // Positive control: the comparison above is only worth something if
        // this function distinguishes runs at all.
        expect(importStepsFor(spreadsheet))
            .not.toEqual(importStepsFor({ ...spreadsheet, hasMapping: false }));
    });
});

describe('currentImportStep', () => {
    it('lands on repair while entries still need fixing', () => {
        expect(currentImportStep(run({ problemCount: 4 }))).toBe('repair');
    });

    it('lands on import once nothing needs fixing', () => {
        expect(currentImportStep(run({ problemCount: 0 }))).toBe('import');
    });

    it('lands on upload for a run with no file yet', () => {
        expect(currentImportStep(run({ status: 'needs_assistance' }))).toBe('upload');
    });

    it('lands on import for a run that has already been applied', () => {
        expect(currentImportStep(run({ status: 'applied' }))).toBe('import');
    });

    it('never lands on a step the run does not have', () => {
        // The two functions are separate, so nothing but this stops them
        // disagreeing — and a wizard opened on a step that is not in its own
        // list shows an empty frame.
        for (const r of everyRun()) {
            expect(importStepsFor(r)).toContain(currentImportStep(r));
        }
    });
});

describe('importNextBlockedReason', () => {
    it('says the file cannot be read yet on the upload step of a waiting run', () => {
        expect(importNextBlockedReason('upload', run({ status: 'needs_assistance' }), copy))
            .toBe('Choose the file you exported.');
    });

    it('says nothing on the upload step of a run whose file was read', () => {
        expect(importNextBlockedReason('upload', run({ status: 'staged' }), copy)).toBeNull();
    });

    it('says what is missing on the mapping step', () => {
        expect(importNextBlockedReason('mapping', run({ blockedReason: null }), copy)).toBeNull();
    });

    it('does not repeat the run-level reason on the mapping step', () => {
        // A mapping is answered or it is not; the seats and the broken entries
        // belong to the step that acts on them. Paired with its control below,
        // so the null cannot be read as "there was nothing to report".
        const blocked = run({ blockedReason: 'This import needs 12 seats and 3 are available.' });
        expect(importNextBlockedReason('mapping', blocked, copy)).toBeNull();
        expect(importNextBlockedReason('import', blocked, copy))
            .toBe('This import needs 12 seats and 3 are available.');
    });

    it('names the number of entries still needing fixing on the repair step', () => {
        expect(importNextBlockedReason('repair', run({ problemCount: 7 }), copy))
            .toBe('7 entries still need fixing.');
    });

    it('hands the count to the caller rather than counting for them', () => {
        expect(importNextBlockedReason('repair', run({ problemCount: 1 }), copy))
            .toBe('1 entries still need fixing.');
        expect(importNextBlockedReason('repair', run({ problemCount: 0 }), copy)).toBeNull();
    });

    it('passes through the reason the server computed on the import step', () => {
        // The server owns this sentence. Recomputing it here would produce a
        // second answer, and a banner and a button that disagree.
        expect(importNextBlockedReason('import', run({ blockedReason: 'This import needs 12 seats and 3 are available.' }), copy))
            .toBe('This import needs 12 seats and 3 are available.');
    });

    it('returns null when nothing is in the way', () => {
        expect(importNextBlockedReason('import', run(), copy)).toBeNull();
    });
});
