/**
 * Which steps an import run actually has, and why a control is disabled.
 *
 * Two rules, both borrowed from the booking wizard next door:
 *
 *  1. A step with nothing to decide is NOT in the list. Rendering it as an
 *     empty shell makes a person click through a screen that asks them
 *     nothing, and it makes the progress indicator lie about how much is left.
 *  2. A disabled control states its own condition as a SENTENCE, naming the
 *     first thing to fix reading down the run. A boolean forces every screen
 *     that consumes it to invent its own explanation, and the explanations
 *     drift apart.
 *
 * Pure functions on purpose: a rule that lives only inside JSX cannot be
 * asserted, and gets a second implementation the next time a step is added.
 * No React, no server imports, no message catalogue — the sentences come in
 * from the caller so they stay translatable and so this module can be run
 * without a DOM.
 */

export type ImportStepId = 'upload' | 'mapping' | 'repair' | 'import';

/**
 * The order, written down once.
 *
 * `importStepsFor` FILTERS this rather than assembling a list of its own, so a
 * step cannot be emitted out of order by a later edit, and adding a step means
 * adding it here plus one arm of `stepHasSomethingToDecide` — not remembering
 * where in a sequence of pushes it belonged.
 */
export const IMPORT_STEP_ORDER: readonly ImportStepId[] = ['upload', 'mapping', 'repair', 'import'];

/** Everything the step rules need, and nothing else. */
export interface ImportRunView {
    /** The run's lifecycle state, as the server reports it. */
    status: string;
    /**
     * Whether the source has columns to point at. False for a vendor export.
     *
     * Read from whether the run's adapter reported an inspection at all
     * (`report.inspection !== null`), which is a fact about the ADAPTER'S
     * SHAPE — an adapter that implements no `inspect()` reads a format with no
     * columns, so there is no mapping question to ask. Deriving it from the
     * vendor instead would mean this wizard held its own list of which
     * products are special, and would go stale the day an adapter grows an
     * `inspect()`. It would also keep the step on screen after the stored file
     * has been swept, where the mapping can no longer be changed by anybody.
     */
    hasMapping: boolean;
    /** How many entries cannot be imported as they stand. */
    problemCount: number;
    /** Why apply is unavailable, computed by the server, or null. */
    blockedReason: string | null;
}

/** A run whose file nobody could read has no steps beyond the one it is on. */
function isWaiting(run: ImportRunView): boolean {
    return run.status === 'needs_assistance';
}

/**
 * Whether this step would put a question to the operator for this run.
 *
 * One arm per step, so the answer for a step is in one place rather than
 * spread across the assembly of the list.
 */
function stepHasSomethingToDecide(step: ImportStepId, run: ImportRunView): boolean {
    switch (step) {
        case 'upload':
            // Always: it is where the run came from and where a replacement
            // file goes, and a wizard with no steps is not a wizard.
            return true;
        case 'mapping':
            return !isWaiting(run) && run.hasMapping;
        case 'repair':
            return !isWaiting(run) && run.problemCount > 0;
        case 'import':
            // Nothing to apply until a readable file exists.
            return !isWaiting(run);
    }
}

export function importStepsFor(run: ImportRunView): ImportStepId[] {
    return IMPORT_STEP_ORDER.filter((step) => stepHasSomethingToDecide(step, run));
}

/**
 * Where somebody opening this run should land.
 *
 * The first step that still wants something from them, which for a run with
 * problems is repair and otherwise is import. Opening on `mapping` when the
 * mapping is already fine would make them press Next past a screen they have
 * no reason to look at.
 *
 * Whatever this returns is always a member of `importStepsFor` for the same
 * run — a landing step that is not in the list shows an empty frame. The two
 * functions are separate, so that invariant is held by an assertion rather
 * than by construction.
 */
export function currentImportStep(run: ImportRunView): ImportStepId {
    if (isWaiting(run)) return 'upload';
    if (run.problemCount > 0) return 'repair';
    return 'import';
}

/** The sentences this module needs, supplied by the caller so they stay translatable. */
export interface ImportWizardCopy {
    needsFile: string;
    fixProblemsFirst: (n: number) => string;
    needsNameColumn: string;
}

/**
 * Why moving on from this step is unavailable, or null when it is available.
 *
 * The import step DELEGATES to the server's own sentence rather than working
 * one out. The server counts the seats and the entries; a second answer
 * computed here is how a banner and a button come to disagree.
 *
 * The mapping step answers null: whether a mapping has been answered is a
 * property of the form's own draft rather than of the stored run, and this
 * function is given the run.
 */
export function importNextBlockedReason(
    step: ImportStepId,
    run: ImportRunView,
    copy: ImportWizardCopy,
): string | null {
    if (step === 'upload') {
        return isWaiting(run) ? copy.needsFile : null;
    }
    if (step === 'mapping') {
        return null;
    }
    if (step === 'repair') {
        return run.problemCount > 0 ? copy.fixProblemsFirst(run.problemCount) : null;
    }
    return run.blockedReason;
}
