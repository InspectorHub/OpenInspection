/**
 * Noticing that an authority changed its form — and stopping there.
 *
 * ── Detection is automatic. Adoption is not, and cannot be made so here ─────
 * A watcher that only REPORTS costs nothing on the day it misses one: somebody
 * finds the new revision the ordinary way, later. A watcher that REPLACES costs
 * an inspector the wrong statutory form — filled in, signed, and filed with the
 * state — and it costs it silently, because both documents look official. The
 * asymmetry is the whole design: nothing in this file, and nothing that calls
 * it, writes to `statutory_form_versions`.
 *
 * ── Why a sighting cannot become a version by being copied ──────────────────
 * `RevisionSighting` carries five facts, and every one of them is something a
 * fetch can establish: which form we were looking for, the page we looked at,
 * the digest of the bytes it served, when we looked, and how that digest
 * compared to what we publish. It carries no `effectiveFrom`, no
 * `mandatoryFrom`, no `effectiveUntil` and no `publishedBy`, because those are
 * not observations — they are a person deciding that this revision applies from
 * this date and standing behind it. `form-registry.ts` refuses a version row
 * that lacks those marks, so the closest thing anybody could build out of a
 * sighting comes back from `versionForInspection` as nothing.
 *
 * ── And a detected revision is unusable even after somebody publishes it ────
 * The bytes are half of a form. The other half is a field map authored against
 * those exact bytes by a person who read the agency's PDF, and it may not be
 * inherited from the previous revision — `field-map.ts` says why at length. The
 * cost of a revision is redoing the layout, not fetching a file, which is the
 * second reason a downloader could never be an adopter.
 *
 * ── What is deliberately NOT here ───────────────────────────────────────────
 * A surface. There is nowhere in this software that shows a person a sighting
 * yet; the operator console that would is a separate, unbuilt piece of work.
 * Until it exists the record is the `statutory_form_sightings` table and a
 * logged warning, and that gap is stated rather than papered over with a screen
 * built on a guess about where it belongs.
 */
import type { StatutoryFormVersion } from './form-registry';

/**
 * How the bytes a page is serving today compare with the revisions we publish.
 *
 * `unrecognised` is its own answer rather than a flavour of `changed`: with no
 * published revision of that form on our side, "changed" is a comparison with
 * nothing to compare against, and reporting one would be an alarm we invented.
 */
export const SIGHTING_VERDICTS = ['unchanged', 'changed', 'unrecognised'] as const;
type SightingVerdict = typeof SIGHTING_VERDICTS[number];

/**
 * One page to poll.
 *
 * Derived from the published catalogue and from nothing else. We do not poll a
 * page for a form we publish no revision of — there would be nothing to compare
 * the bytes with — which is also why a deployment that publishes no statutory
 * form has no targets and the scheduled check costs it nothing.
 */
export interface RevisionWatchTarget {
    formId: string;
    sourceUrl: string;
}

/** What one poll of one page saw. NOT a version, and never becomes one. */
export interface RevisionSighting {
    formId: string;
    sourceUrl: string;
    /** sha256 (lowercase hex) of the bytes the page served. */
    observedHash: string;
    observedAt: number;
    verdict: SightingVerdict;
}

/** What a poll establishes before anything is compared to it. */
export interface RevisionObservation {
    formId: string;
    sourceUrl: string;
    observedHash: string;
    observedAt: number;
}

/**
 * Every page worth polling for this catalogue, one per (form, page).
 *
 * Two revisions of one form routinely share a URL — an authority keeps a stable
 * "current form" address and changes what it serves, which is exactly the event
 * this watcher exists for. Polling that address once per revision would fetch
 * the same bytes twice and record the same sighting twice.
 */
export function watchTargets(
    published: readonly StatutoryFormVersion[],
): RevisionWatchTarget[] {
    const seen = new Set<string>();
    const targets: RevisionWatchTarget[] = [];
    for (const version of published) {
        const key = `${version.formId}\0${version.sourceUrl}`;
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push({ formId: version.formId, sourceUrl: version.sourceUrl });
    }
    return targets;
}

/**
 * What one observation means, given everything this software publishes.
 *
 * Compared against EVERY published revision of the form rather than against the
 * newest one. During a voluntary-use window the page may legitimately serve
 * either revision, and a comparison against the newest alone would report the
 * incumbent as a change every day it was served — an alarm that cries wolf is
 * an alarm nobody reads by the time the real revision lands.
 */
export function classifySighting(
    published: readonly StatutoryFormVersion[],
    observation: RevisionObservation,
): RevisionSighting {
    const ours = published.filter((v) => v.formId === observation.formId);
    const verdict: SightingVerdict = ours.length === 0
        ? 'unrecognised'
        : ours.some((v) => v.sourceHash === observation.observedHash)
            ? 'unchanged'
            : 'changed';
    return {
        formId: observation.formId,
        sourceUrl: observation.sourceUrl,
        observedHash: observation.observedHash,
        observedAt: observation.observedAt,
        verdict,
    };
}

