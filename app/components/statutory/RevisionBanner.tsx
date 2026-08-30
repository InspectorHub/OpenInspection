import { Banner } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import type { RevisionStatus } from "../../../server/lib/statutory/revision-status";

/**
 * What an inspector is told about the revision behind this inspection's form.
 *
 * ── THE CRITERION IS NOT IN THIS FILE ───────────────────────────────────────
 * `status` arrives already decided, from `revisionStatus()` on the server. The
 * question is a date-window comparison, and a second implementation of it in
 * the browser would disagree with the first at some boundary — which is exactly
 * the boundary nobody checks by hand. This component renders an answer; it does
 * not compute one, and it must not start.
 *
 * ── THE WITHDRAWAL COPY IS TWO SENTENCES, NOT ONE ───────────────────────────
 * A withdrawn revision has two possible causes and they hand the reader
 * opposite jobs. Our field map was found wrong: a correction is coming from us,
 * the documents already produced should be produced again once it lands, and
 * there is nothing for the workspace to chase in the meantime. The authority
 * withdrew the revision: no correction is coming, ever, and the workspace has
 * to move to whatever revision is now in force. "This revision was withdrawn"
 * is true of both and answers neither, so it is not a sentence this component
 * is able to render — `reason` picks the copy, and `replacementVersion` picks
 * between "move to revision X" and "there is no revision to move to".
 *
 * ── FIVE STATES, AND ONE OF THEM IS REASSURANCE ─────────────────────────────
 * `superseded_elsewhere` means a newer revision is in force and this inspection
 * predates it, so its form is CORRECT. Saying nothing there is not neutral: an
 * inspector who has heard that the form changed, and sees nothing here, assumes
 * the worst about a report that is fine. Unnecessary alarm is as much a defect
 * as a missed warning, so that state has copy of its own that says the form is
 * right.
 *
 * ── NO MIGRATION CONTROL ────────────────────────────────────────────────────
 * There is no migration, so there is no button offering one. A half-migrated
 * inspection would silently drop answers an inspector stood in a building to
 * collect. The way out of `cannot_produce` is an administrator updating the
 * template and the inspection being started again on it, which is what the copy
 * says instead.
 *
 * ── TONE CARRIES THE ARIA ROLE ──────────────────────────────────────────────
 * `Banner` derives `role` from `tone` (info → status, warn → alert), so the two
 * cannot drift apart: the passive states announce politely and only the state
 * that blocks production interrupts. Do not reach for `danger` here — nothing
 * has failed; a form cannot be produced, and the sentence says why.
 * NOTE: `Banner`'s "warn" is a component-level alias onto the `watch` design
 * tokens. There is no directly writable warn token, and writing one produces no
 * CSS at all without Tailwind complaining.
 */
export function RevisionBanner({ status, inspectionDate }: {
    status: RevisionStatus;
    /** The inspection's own calendar day, `YYYY-MM-DD`. */
    inspectionDate?: string;
}) {
    if (status.kind === "current") return null;

    // The cutover day, spelled the way the revision was selected: UTC, matching
    // `inspection-date.ts`. A locale-formatted date here would render a
    // different day than the one the selection actually turned on.
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const on = inspectionDate ?? "";

    if (status.kind === "superseding_soon") {
        return (
            <Banner tone="info">
                {m.statutory_revision_soon({
                    version: status.nextVersion,
                    date: day(status.from),
                    inspectionDate: on,
                })}
            </Banner>
        );
    }

    if (status.kind === "withdrawn") {
        // `warn`, the same tone as `cannot_produce`, because production is
        // blocked and the reader has something to do. Not `danger`: nothing has
        // failed, and an alarm colour on a state whose remedy is "wait for the
        // next release" would read as data loss.
        const common = {
            version: status.version,
            date: day(status.withdrawnAt),
            inspectionDate: on,
        };
        return (
            <Banner tone="warn">
                {status.reason === "field_map_incorrect"
                    ? (status.replacementVersion === null
                        ? m.statutory_revision_withdrawn_field_map(common)
                        : m.statutory_revision_withdrawn_field_map_replacement({
                            ...common, replacement: status.replacementVersion,
                        }))
                    : (status.replacementVersion === null
                        ? m.statutory_revision_withdrawn_authority(common)
                        : m.statutory_revision_withdrawn_authority_replacement({
                            ...common, replacement: status.replacementVersion,
                        }))}
            </Banner>
        );
    }

    if (status.kind === "superseded_elsewhere") {
        return (
            <Banner tone="info">
                {m.statutory_revision_superseded_elsewhere({
                    version: status.nextVersion,
                    date: day(status.from),
                    inspectionDate: on,
                })}
            </Banner>
        );
    }

    return (
        <Banner tone="warn">
            {m.statutory_revision_cannot_produce({
                applicable: status.applicableVersion,
                template: status.templateVersion,
                inspectionDate: on,
            })}
        </Banner>
    );
}
