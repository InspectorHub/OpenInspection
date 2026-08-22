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

export type ImportStepId = 'upload' | 'mapping' | 'preview' | 'repair' | 'import';

/**
 * The order, written down once.
 *
 * `importStepsFor` FILTERS this rather than assembling a list of its own, so a
 * step cannot be emitted out of order by a later edit, and adding a step means
 * adding it here plus one arm of `stepHasSomethingToDecide` — not remembering
 * where in a sequence of pushes it belonged.
 */
export const IMPORT_STEP_ORDER: readonly ImportStepId[] =
    ['upload', 'mapping', 'preview', 'repair', 'import'];

/** Everything the step rules need, and nothing else. */
export interface ImportRunView {
    /** The run's lifecycle state, as the server reports it. */
    status: string;
    /**
     * Whether this run has a mapping QUESTION to put to somebody.
     *
     * Not "is this a spreadsheet". The question differs by what was uploaded —
     * a tabular source is asked which column holds what, a template is asked
     * what its own rating words mean — and either can have nothing to ask: a
     * source with no columns, a template whose words are already settled, a
     * template with no words at all. All of those arrive here as false.
     *
     * Derived by the screen from the run's own report rather than from the
     * vendor. A rule that named vendors would mean this wizard held its own
     * list of which products are special, would go stale the day an adapter
     * changed, and would keep the step on screen after the stored file has
     * been swept — where the mapping can no longer be changed by anybody.
     */
    hasMapping: boolean;
    /**
     * Whether this run carries something whose SHAPE can be judged.
     *
     * It exists because the import step's four numbers add up and still cannot
     * tell a good conversion from a useless one: a template whose 76 items all
     * became plain text boxes counts identically to one that converted
     * perfectly, and both report zero problems.
     *
     * Derived from whether the run's report carries a structure at all,
     * exactly as `hasMapping` is derived from whether it still poses a mapping
     * question. Neither is a list of which intents are special — a rule that
     * named intents would go stale the day a fourth entity grew a shape.
     */
    hasStructurePreview: boolean;
    /**
     * What this run is bringing in. Null for a run whose file nothing could
     * read, which has no entities yet.
     *
     * It exists because the repair gate differs by kind, and the difference is
     * about CONSEQUENCE rather than tidiness — see `importNextBlockedReason`.
     */
    entityKind: 'template' | 'contact' | 'member' | null;
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
        case 'preview':
            return !isWaiting(run) && run.hasStructurePreview;
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
    // Preview comes first where there is one, INCLUDING for a run with problem
    // rows. A template's bad rows do not stand in the way (see below), so
    // opening on the repair table would land somebody on the one screen this
    // run does not need them on — while the screen that can tell them whether
    // the conversion worked at all sits behind it.
    if (run.hasStructurePreview) return 'preview';
    if (run.problemCount > 0) return 'repair';
    return 'import';
}

/**
 * The sentences this module needs, supplied by the caller so they stay
 * translatable.
 *
 * Two, not three. A `needsNameColumn` sentence sat here until the wizard was
 * built and could be asked whether it read it: it does not, and could not —
 * whether a mapping has been answered is a property of the mapping form's own
 * unsaved draft, and this module is given the stored run. A required field that
 * nothing reads is a caller obligation with no consequence, and the next reader
 * would have implemented the rule twice trying to satisfy it.
 */
export interface ImportWizardCopy {
    needsFile: string;
    fixProblemsFirst: (n: number) => string;
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
    if (step === 'preview') {
        // A look, not a gate. Everything it reports is either already counted
        // on the import step or advisory, and a preview that could block would
        // be a second opinion about a run the server has already judged.
        return null;
    }
    if (step === 'repair') {
        // A template's bad rows do NOT block. Measured against a real export:
        // 65 of 1872 comments carry no type, and requiring all 65 to be fixed
        // first turns a five-minute import into an afternoon.
        //
        // Contacts and team members still block, and the difference is
        // consequence rather than consistency: a contact with no email address
        // becomes a record that can never be notified, whereas a comment with
        // no type is one comment fewer. The step itself is still OFFERED for a
        // template — advisory is not hidden — it simply lets the run past.
        if (run.entityKind === 'template') return null;
        return run.problemCount > 0 ? copy.fixProblemsFirst(run.problemCount) : null;
    }
    return run.blockedReason;
}
