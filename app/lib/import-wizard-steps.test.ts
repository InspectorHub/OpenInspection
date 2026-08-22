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
};

function run(over: Partial<ImportRunView> = {}): ImportRunView {
    return {
        status: 'staged',
        hasMapping: true,
        hasStructurePreview: false,
        entityKind: 'contact',
        problemCount: 0,
        blockedReason: null,
        ...over,
    };
}

/** Every shape of run the rules distinguish, for the invariants that hold over all of them. */
function everyRun(): ImportRunView[] {
    const runs: ImportRunView[] = [];
    for (const status of ['staged', 'applied', 'partially_applied', 'needs_assistance', 'expired']) {
        for (const hasMapping of [true, false]) {
            for (const hasStructurePreview of [true, false]) {
                for (const entityKind of ['template', 'contact', 'member', null] as const) {
                    for (const problemCount of [0, 1, 5]) {
                        runs.push(run({
                            status, hasMapping, hasStructurePreview, entityKind, problemCount,
                        }));
                    }
                }
            }
        }
    }
    return runs;
}

describe('IMPORT_STEP_ORDER', () => {
    it('is the only place the order of the steps is written down', () => {
        expect([...IMPORT_STEP_ORDER])
            .toEqual(['upload', 'mapping', 'preview', 'repair', 'import']);
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

describe('the preview step', () => {
    it('offers preview for a run carrying a structure', () => {
        // The import step's four numbers add up and STILL cannot tell a good
        // conversion from a useless one: a template whose 76 items all became
        // plain text boxes counts identically to one that converted perfectly.
        expect(importStepsFor(run({ hasStructurePreview: true }))).toContain('preview');
    });

    it('does NOT offer it for a run carrying none — the positive control', () => {
        // Without this, `preview` could be unconditional and the case above
        // would still pass, putting an empty screen in front of every contacts
        // import. Contacts need no preview: the repair table IS a row-by-row
        // one.
        expect(importStepsFor(run({ hasStructurePreview: false }))).not.toContain('preview');
    });

    it('keeps preview before repair', () => {
        const steps = importStepsFor(run({ hasStructurePreview: true, problemCount: 3 }));
        expect(steps).toContain('preview');
        expect(steps).toContain('repair');
        expect(steps.indexOf('preview')).toBeLessThan(steps.indexOf('repair'));
    });

    it('has none of it while the run is waiting on a person', () => {
        expect(importStepsFor(run({ status: 'needs_assistance', hasStructurePreview: true })))
            .toEqual(['upload']);
    });

    it('lands on preview rather than repair when there is one', () => {
        // A template's bad rows do not block, so sending somebody to the repair
        // table first would open the one screen this run does not need them on.
        expect(currentImportStep(run({
            entityKind: 'template', hasStructurePreview: true, problemCount: 65,
        }))).toBe('preview');
    });

    it('still lands on repair for a run with no preview — the control', () => {
        expect(currentImportStep(run({
            entityKind: 'contact', hasStructurePreview: false, problemCount: 3,
        }))).toBe('repair');
    });

    it('says nothing is in the way of moving on from preview', () => {
        // Preview is a look, not a gate. Everything it reports is either
        // already counted on the import step or advisory.
        expect(importNextBlockedReason('preview', run({
            hasStructurePreview: true, problemCount: 12,
        }), copy)).toBeNull();
    });
});

describe('repair blocks by CONSEQUENCE, not by tidiness', () => {
    it('does not block a TEMPLATE run on its problem rows', () => {
        // A real export carries 65 comments with no type out of 1872. Requiring
        // all 65 to be fixed first turns a five-minute import into an
        // afternoon, in front of somebody who wants to start working.
        expect(importNextBlockedReason('repair', run({
            entityKind: 'template', problemCount: 65,
        }), copy)).toBeNull();
    });

    it('DOES block a CONTACTS run on its problem rows — the positive control', () => {
        // Different consequence, different gate: a contact with no email is a
        // record that can never be notified, while a comment with no type is
        // one comment fewer.
        expect(importNextBlockedReason('repair', run({
            entityKind: 'contact', problemCount: 3,
        }), copy)).toBe('3 entries still need fixing.');
    });

    it('blocks a TEAM run too — the second control', () => {
        // Contacts are not a special case; templates are. An invitation with no
        // address is an invitation that goes nowhere.
        expect(importNextBlockedReason('repair', run({
            entityKind: 'member', problemCount: 2,
        }), copy)).toBe('2 entries still need fixing.');
    });

    it('still keeps the repair STEP for a template run that has problems', () => {
        // Advisory is not hidden. Sixty-five entries the operator may want to
        // fix are sixty-five things to decide about, so the step is offered —
        // what changed is that it does not stand in the way.
        expect(importStepsFor(run({ entityKind: 'template', problemCount: 65 })))
            .toContain('repair');
    });
});
