/**
 * The single answer to "is this template still the right one for this
 * inspection", and the only place that question is decided.
 *
 * ── WHY ONE FUNCTION ────────────────────────────────────────────────────────
 * Three surfaces ask it: the editor banner, the refusal to produce, and the
 * update confirmation's counts. Two implementations of one question disagree at
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
