import { Link } from "react-router";
import { Card, Pill } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * Whether a job booked TODAY could produce each statutory form.
 *
 * ── WHY IT IS ON THIS PAGE ──────────────────────────────────────────────────
 * Producing a form needs three things, owned by three different people: a
 * template an administrator installs, the authority's PDF an OWNER supplies,
 * and a printed licence class an inspector types. Each refuses well on its own.
 * None of them can be seen from where the others are — so the owner finishes
 * the one job they can do here, and the other two gaps are discovered later, by
 * somebody else, in the middle of an inspection.
 *
 * This screen is where somebody is already thinking about statutory forms. It
 * is the only place the three can be put side by side without inventing a
 * fourth screen nobody would visit.
 *
 * ── WHY IT SAYS "TODAY" ─────────────────────────────────────────────────────
 * Revisions are date-bounded and an inspection is governed by the revision in
 * force on its own date. The row answers for the revision in force NOW, which
 * means it goes red by itself when a cutover passes and the new document has
 * not been supplied. A tick that never expires is how the second half of a
 * lockout goes unnoticed for six days.
 *
 * ── WHY IT DOES NOT LINK ANYWHERE ───────────────────────────────────────────
 * Two of the three remedies are not the reader's to perform, and a link that
 * takes an owner to a screen where they can only watch is worse than a sentence
 * telling them who to ask. The licence-class fraction is deliberately a
 * fraction: "some of your inspectors can and some cannot" is the true state and
 * a boolean cannot hold it.
 */
// Not exported, for the same reason as its server-side twin: the card takes
// the whole `StatutoryReadinessData`, and nothing needs one row's type alone.
interface StatutoryReadinessRow {
    formId: string;
    formTitle: string;
    currentRevision: string | null;
    templateInstalled: boolean;
    sourceStored: boolean;
}

export interface StatutoryReadinessData {
    forms: StatutoryReadinessRow[];
    licenceClass: { filled: number; total: number };
}

function Tick({ ok, label, fixHref }: { ok: boolean; label: string; fixHref?: string }) {
    // A LINK ONLY WHERE THE READER CAN ACT.
    //
    // This page is owner-only, and an owner IS an administrator — so the
    // missing template is theirs to install, and a diagnosis with no treatment
    // was the wrong call. The other two legs stay as prose: the licence class
    // is typed by each inspector on their own profile, and a link that takes an
    // owner somewhere they can only watch is worse than a sentence naming who
    // to ask.
    const body = (
        <>
            {/* The mark is aria-hidden and the STATE is in the text, because a
                screen reader reading "✓ Template" and "✗ Template" identically
                is the whole failure this row exists to avoid. */}
            <span aria-hidden="true" className={ok ? "text-ih-ok" : "text-ih-bad-fg"}>
                {ok ? "✓" : "✗"}
            </span>
            <span className={ok ? "text-ih-fg-2" : "text-ih-bad-fg"}>
                {label}
                <span className="sr-only">
                    {ok ? m.statutory_readiness_sr_ready() : m.statutory_readiness_sr_missing()}
                </span>
            </span>
        </>
    );

    // Linked only when it is BOTH missing and fixable from here: a link on a
    // green tick invites a trip that changes nothing.
    if (!ok && fixHref) {
        return (
            <Link
                to={fixHref}
                className="inline-flex items-center gap-1.5 text-[12px] underline underline-offset-2 hover:text-ih-fg-1"
            >
                {body}
            </Link>
        );
    }
    return <span className="inline-flex items-center gap-1.5 text-[12px]">{body}</span>;
}

export function StatutoryReadinessCard({ readiness }: {
    /** null when the server could not compute it — see below. */
    readiness: StatutoryReadinessData | null;
}) {
    // COULD NOT CHECK IS A STATE, NOT AN ABSENCE.
    //
    // The first version rendered nothing here, which is the shape a failing
    // test pushes you towards and the wrong one for the reader: an owner who
    // saw this card yesterday and does not see it today learns nothing, and
    // "the check is gone" is indistinguishable from "the feature was removed".
    // The rows below are unaffected either way — that part of best-effort was
    // right — but the reader is told which of the two happened.
    if (readiness === null) {
        return (
            <Card className="p-5 space-y-1" data-testid="statutory-readiness">
                <h2 className="text-[15px] font-bold text-ih-fg-1">
                    {m.statutory_readiness_title()}
                </h2>
                <p className="text-[12px] text-ih-fg-3">
                    {m.statutory_readiness_unavailable()}
                </p>
            </Card>
        );
    }

    const { forms, licenceClass } = readiness;
    const someoneCanSign = licenceClass.filled > 0;

    return (
        <Card className="p-5 space-y-3" data-testid="statutory-readiness">
            <div>
                <h2 className="text-[15px] font-bold text-ih-fg-1">
                    {m.statutory_readiness_title()}
                </h2>
                <p className="mt-0.5 text-[12px] text-ih-fg-3">
                    {m.statutory_readiness_subtitle()}
                </p>
            </div>

            <ul className="space-y-2">
                {forms.map((form) => {
                    // A form with no revision in force today cannot be produced
                    // whatever else is true, and saying "ready" beside that
                    // would be the reassuring half of a contradiction.
                    const ready = form.currentRevision !== null
                        && form.templateInstalled && form.sourceStored && someoneCanSign;
                    return (
                        <li
                            key={form.formId}
                            data-testid={`statutory-readiness-${form.formId}`}
                            className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ih-border pt-2 first:border-0 first:pt-0"
                        >
                            <span className="text-[13px] font-medium text-ih-fg-1 min-w-[14rem]">
                                {form.formTitle}
                            </span>
                            <Pill tone={ready ? "sat" : "warning"}>
                                {ready ? m.statutory_readiness_ready() : m.statutory_readiness_not_ready()}
                            </Pill>
                            {form.currentRevision === null ? (
                                <span className="text-[12px] text-ih-fg-3">
                                    {m.statutory_readiness_no_revision()}
                                </span>
                            ) : (
                                <>
                                    <Tick
                                        ok={form.templateInstalled}
                                        label={m.statutory_readiness_template()}
                                        fixHref="/library/marketplace"
                                    />
                                    <Tick ok={form.sourceStored} label={m.statutory_readiness_pdf()} />
                                    <Tick
                                        ok={someoneCanSign}
                                        label={m.statutory_readiness_licence({
                                            filled: licenceClass.filled,
                                            total: licenceClass.total,
                                        })}
                                    />
                                </>
                            )}
                        </li>
                    );
                })}
            </ul>

            <p className="text-[12px] text-ih-fg-3">{m.statutory_readiness_who()}</p>
        </Card>
    );
}
