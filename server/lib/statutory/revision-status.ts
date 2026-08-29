/**
 * The single answer to "is this template still the right one for this
 * inspection", and the only place that question is decided.
 *
 * ── WHY ONE FUNCTION ────────────────────────────────────────────────────────
 * Four surfaces ask it, and each is named here with the call site, because a
 * count in a comment is the kind of claim that quietly stops being true:
 *
 *   - the editor banner            app/routes/inspection-edit/loader.server.ts
 *   - the refusal to produce       server/api/inspections/statutory.ts
 *   - the reschedule's answer      server/api/inspections/patch-revision-report.ts
 *   - the update confirmation      server/services/marketplace/statutory-update-impact.ts
 *
 * Two implementations of one question disagree at
 * some boundary eventually, and every boundary here is a DATE — the one kind of
 * boundary nobody tests by hand, so the disagreement is silent and long-lived.
 * Anything that needs the answer imports this; nothing re-derives it, and in
 * particular the client re-derives nothing: the loader computes it server-side
 * and passes the result down.
 *
 * ── WHY NOT COMPARE REVISION LABELS ─────────────────────────────────────────
 * Which revision GOVERNS an inspection is decided by the inspection's own
 * calendar day against the published date windows (`versionForInspection`), not
 * by sorting labels. `7-10` sorts before `7-9` as a string and a label like
 * `Rev. 04/26` has no order at all. The installed revision is compared for
 * equality only, never for "newer than".
 *
 * ── FOUR STATES, AND THE THIRD IS REASSURANCE ───────────────────────────────
 * `superseded_elsewhere` means a newer revision is in force, this inspection
 * predates it, and its form is CORRECT. That state exists so the copy can say
 * so. Silence there is not neutral: an inspector who has heard that the form
 * changed, and finds nothing said about it, assumes the worst about a report
 * that is fine. Unnecessary alarm is as much a defect as a missed warning.
 *
 * ── THERE IS NO MIGRATION, SO THERE IS NO FIFTH STATE ───────────────────────
 * `cannot_produce` is a dead end on purpose. Migrating a half-entered
 * inspection onto a newer revision would have to answer "what happens to the
 * answers already recorded", and all three answers are bad — move some and
 * things are dropped silently, void them and a completed site visit is
 * destroyed, refuse and a finished inspection is stranded. The way out is a new
 * inspection on the current template, and the earlier states exist so nobody
 * arrives here.
 */
import { versionForInspection, type StatutoryFormVersion } from './form-registry';
import { utcMidnightOf } from './inspection-date';
import { PUBLISHED_FORM_VERSIONS } from './forms';
import type { StatutoryFormDeclaration } from '../../types/statutory-declaration';

export type RevisionStatus =
    /** Nothing to say: this template produces the revision this inspection needs. */
    | { kind: 'current' }
    /** A cutover is inside the warning window. Nothing is blocked. */
    | { kind: 'superseding_soon'; nextVersion: string; from: number }
    /** The cutover has passed, and this inspection predates it. Its form is right. */
    | { kind: 'superseded_elsewhere'; nextVersion: string; from: number }
    /** This inspection falls under a revision the installed template does not produce. */
    | { kind: 'cannot_produce'; applicableVersion: string; templateVersion: string };

const DAY_MS = 86_400_000;

/** How long before a cutover a workspace is told about it, unless asked otherwise. */
const DEFAULT_WARN_WINDOW_DAYS = 30;

export interface RevisionStatusInput {
    formId: string;
    /** The inspection's own calendar day, `YYYY-MM-DD`. Never a timestamp. */
    inspectionDate: string;
    /** The revision the installed template produces. */
    installedVersion: string;
    versions: readonly StatutoryFormVersion[];
    /** Now, epoch ms. Passed in rather than read, so the boundary is testable. */
    now: number;
    warnWindowDays?: number;
}

export function revisionStatus(input: RevisionStatusInput): RevisionStatus {
    const { formId, installedVersion, versions, now } = input;
    const warnWindow = (input.warnWindowDays ?? DEFAULT_WARN_WINDOW_DAYS) * DAY_MS;

    // Which revision governs THIS inspection. By the inspection's own date and
    // never by today: an inspection dated before a cutover keeps its revision
    // however long the report takes to finish.
    const applicable = versionForInspection(
        formId, utcMidnightOf(input.inspectionDate), versions,
    );

    // No revision covers that date at all — including an inspection older than
    // every revision this deployment holds. Nothing about the template is wrong,
    // so nothing is said here: the produce path already refuses this case in its
    // own words ("no published revision of X covers Y"), and a second, differently
    // worded alarm would tell an inspector their template is out of date when the
    // truth is that this deployment publishes nothing for that day.
    if (applicable === null) return { kind: 'current' };

    if (applicable.version !== installedVersion) {
        return {
            kind: 'cannot_produce',
            applicableVersion: applicable.version,
            templateVersion: installedVersion,
        };
    }

    // Nothing is wrong with this inspection. Is a cutover in sight for the ones
    // that come after it? A withdrawn revision is excluded: it will never become
    // the revision anybody has to move to, so warning about it would be an alarm
    // with no action behind it.
    const upcoming = versions.filter((v) =>
        v.formId === formId
        && v.version !== installedVersion
        && v.withdrawnAt === null
        && v.mandatoryFrom !== null);
    if (upcoming.length === 0) return { kind: 'current' };

    // The soonest mandate, so a workspace hears about the next cutover rather
    // than the furthest one.
    const next = upcoming.reduce((soonest, v) =>
        (v.mandatoryFrom ?? 0) < (soonest.mandatoryFrom ?? 0) ? v : soonest);
    const from = next.mandatoryFrom ?? 0;

    if (from <= now) {
        // In force elsewhere, and not for this inspection. Said out loud on
        // purpose — see the header.
        return { kind: 'superseded_elsewhere', nextVersion: next.version, from };
    }
    if (from - now <= warnWindow) {
        return { kind: 'superseding_soon', nextVersion: next.version, from };
    }
    return { kind: 'current' };
}

/**
 * The same question, asked from an inspection rather than from loose arguments.
 *
 * Every surface goes through THIS, not through `revisionStatus` directly: the
 * banner, the reschedule response and the update confirmation's counts each
 * hold an inspection and a template snapshot, and each would otherwise have to
 * remember to read the declaration the same way, default the catalogue the same
 * way, and decide the same thing about a template that names no revision. Three
 * copies of that reading is three chances to read it differently.
 *
 * `null` means there is nothing to say, and it covers two cases on purpose:
 *
 *   - the snapshot declares no statutory form at all — the ordinary inspection;
 *   - it declares one but names no revision it was built for. A template that
 *     makes no claim about which revision it produces cannot be measured
 *     against the one the date selects, and a guess would either alarm an
 *     inspector about a correct report or reassure them about a wrong one.
 *
 * A caller renders nothing for `null`. It must not substitute a default.
 */
export function revisionStatusForInspection(input: {
    /** The inspection's OWN `templateSnapshot`, never the current template row. */
    snapshot: unknown;
    /** `inspections.date` — a calendar day. */
    inspectionDate: string;
    now: number;
    /** Defaulted to the published catalogue; a seam for tests, as elsewhere here. */
    versions?: readonly StatutoryFormVersion[];
    warnWindowDays?: number;
}): RevisionStatus | null {
    const declaration = (input.snapshot as { statutoryForm?: StatutoryFormDeclaration } | null)
        ?.statutoryForm;
    if (!declaration || typeof declaration.revision !== 'string') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.inspectionDate)) return null;

    return revisionStatus({
        formId: declaration.formId,
        inspectionDate: input.inspectionDate,
        installedVersion: declaration.revision,
        versions: input.versions ?? PUBLISHED_FORM_VERSIONS,
        now: input.now,
        ...(input.warnWindowDays === undefined ? {} : { warnWindowDays: input.warnWindowDays }),
    });
}
