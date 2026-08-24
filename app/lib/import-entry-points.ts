/**
 * The ways an import run can be started, and why the start button is disabled.
 *
 * Identity comes from the ENTRY POINT, never from the data: a spreadsheet of
 * names and email addresses is contacts or team members depending only on
 * which entry the operator came through, and no amount of sniffing the columns
 * can tell those two apart. That is why each entry is a separate address —
 * `?intent=…` — rather than one upload box that guesses afterwards.
 *
 * `assisted.full` is the entry for a file the operator could not name either.
 * It is the only one that never runs an adapter, and the only one where
 * starting the run means a person on the support team opens the file, which is
 * why it carries a second agreement the others do not ask for.
 *
 * Pure functions, no React and no message catalogue: the sentences come in
 * from the caller, the same way `import-wizard-steps.ts` takes its copy, so
 * both rules can be asserted without a DOM and stay translatable.
 */
import { importSourcesFor } from './import-sources';

/** The intents a person can start a run from. `templates.overwrite` is absent
 *  on purpose: it needs a template to replace, so it can only be started from
 *  that template, and no such control exists in the product yet. */
export type ImportEntryIntent =
    | 'templates.create'
    | 'contacts.import'
    | 'members.invite'
    | 'assisted.full';

export interface ImportEntryPoint {
    intent: ImportEntryIntent;
    /**
     * Whether starting this run means somebody on the support team opens the
     * file.
     *
     * A property of the ENTRY, not of the file: nothing has read the file yet
     * at the moment the agreement is asked for. True only for the assisted
     * entry, because that entry exists precisely for a file nothing here can
     * read.
     */
    readByPerson: boolean;
}

/** The three entries that name what they are bringing over. Order is the order
 *  they are offered in, and the list is filtered rather than rebuilt so an
 *  entry cannot be emitted out of order by a later edit. */
const IDENTIFIED_ENTRY_POINTS: readonly ImportEntryPoint[] = [
    { intent: 'templates.create', readByPerson: false },
    { intent: 'contacts.import', readByPerson: false },
    { intent: 'members.invite', readByPerson: false },
];

/** Offered only where a support path exists. Self-hosted has none, and there
 *  the server refuses the upload before storing anything — so an entry shown
 *  there would be a door onto a wall. */
const ASSISTED_ENTRY_POINT: ImportEntryPoint = {
    intent: 'assisted.full',
    readByPerson: true,
};

export function importEntryPointsFor(hasAssistedMigration: boolean): ImportEntryPoint[] {
    return hasAssistedMigration
        ? [...IDENTIFIED_ENTRY_POINTS, ASSISTED_ENTRY_POINT]
        : [...IDENTIFIED_ENTRY_POINTS];
}

/** The entry `?intent=` names, or null. Resolved against the entries this
 *  deployment actually offers, so an address typed by hand cannot open a form
 *  the deployment has no server route for. */
export function importEntryPointFor(
    intent: string | null,
    hasAssistedMigration: boolean,
): ImportEntryPoint | null {
    if (!intent) return null;
    return importEntryPointsFor(hasAssistedMigration).find((e) => e.intent === intent) ?? null;
}

/**
 * The intent named by a form field, narrowed, or null.
 *
 * Every entry this page can start is checked, not only the ones this
 * deployment offers, because the deployment gate belongs to the screen and
 * this is the wire: a field carrying something that is not an entry at all is
 * a different answer from one carrying an entry that is switched off here.
 */
export function asImportEntryIntent(value: unknown): ImportEntryIntent | null {
    return importEntryPointsFor(true).find((e) => e.intent === value)?.intent ?? null;
}

/** Where an entry point leads. One place, so the three links and anything that
 *  later points at them cannot drift into three spellings. */
export function importEntryHref(intent: ImportEntryIntent): string {
    return `/settings/imports?intent=${intent}`;
}

/**
 * Where the chosen file has got to in the workbook question.
 *
 * FIVE states and not a boolean, because four of them mean different things to
 * the submit button and the fifth is the one a "ready / not ready" flag would
 * quietly delete:
 *
 * 🔴 `unreadable` must NOT block the submit. It is the path an `.xlsx` takes
 * today and must keep taking — the original file is uploaded untouched, the
 * server recognises no adapter for it, and it goes to whoever converts such
 * files by hand. Collapsing it into "not ready" is how that path would be
 * removed from the product by a later tidy-up, with no server code changed and
 * nothing to notice.
 */
export type WorkbookStage =
    | 'not-a-workbook'  // a CSV/JSON/container, or a vendor that reads containers
    | 'reading'         // the parser is loading, or the workbook is parsing
    | 'unreadable'      // nothing here could read it — the original file uploads
    | 'pending'         // more than one sheet has rows and none is chosen
    | 'chosen';         // a sheet is chosen and the input holds its CSV

/** What the person has answered so far. Not the stored run — this form has no
 *  run yet; creating one is what it does. */
export interface ImportStartDraft {
    /**
     * Which product the operator said this export came from, or null.
     *
     * Null is not "unknown": it is "not answered yet", and the two are told
     * apart by whether the entry point offers a choice at all. An entry with
     * one source answers itself; the entry for a file whose owner could not
     * name the product has nothing to answer.
     */
    vendor: string | null;
    hasFile: boolean;
    /** How far the chosen file has got through the workbook question.
     *  `not-a-workbook` for every file that is not a convertible workbook,
     *  which is most of them. */
    workbook: WorkbookStage;
    uploadAuthorized: boolean;
    staffAccessAuthorized: boolean;
}

/** The sentences, supplied by the caller so they stay translatable. */
export interface ImportStartCopy {
    needsSource: string;
    needsFile: string;
    readingWorkbook: string;
    needsSheet: string;
    needsUploadAuthorized: string;
    needsStaffAccessAuthorized: string;
}

/**
 * Why this run cannot be started yet, as a sentence, or null when it can.
 *
 * Reads DOWN the form and returns the FIRST thing outstanding, so the sentence
 * names something the person can act on where they are looking, rather than
 * listing everything or naming the last field. Returning a boolean instead
 * would make every screen invent its own explanation, and the explanations
 * drift — which is the second of the two house rules this product keeps.
 */
export function importStartBlockedReason(
    entry: ImportEntryPoint,
    draft: ImportStartDraft,
    copy: ImportStartCopy,
): string | null {
    // First, because it is what decides which reader runs. Asked after the file
    // it would be asked of somebody who has stopped reading the form — and the
    // rule it replaced was the server quietly answering it for them.
    if (importSourcesFor(entry.intent).length > 1 && !draft.vendor) return copy.needsSource;
    if (!draft.hasFile) return copy.needsFile;
    // Directly after the file, because these are questions ABOUT the file, and
    // they are asked where the operator is still looking. Only two of the five
    // stages appear here — see `WorkbookStage` for why `unreadable` is not one
    // of them.
    if (draft.workbook === 'reading') return copy.readingWorkbook;
    if (draft.workbook === 'pending') return copy.needsSheet;
    if (!draft.uploadAuthorized) return copy.needsUploadAuthorized;
    if (entry.readByPerson && !draft.staffAccessAuthorized) return copy.needsStaffAccessAuthorized;
    return null;
}
