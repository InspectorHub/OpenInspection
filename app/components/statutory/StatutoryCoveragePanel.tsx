import { Card, Pill } from "@core/shared-ui";
import { m } from "~/paraglide/messages";

/**
 * What this inspection still owes its statutory form — shown IN THE EDITOR,
 * while it can still be answered.
 *
 * ── THE FAILURE THIS REPLACES ───────────────────────────────────────────────
 * Until now this list existed only inside the download's refusal, and the
 * download requires a published report. Verified against production on
 * 2026-09-05: an inspection was worked, PUBLISHED TO THE CLIENT, and only then
 * did anything say "2 required field(s) have no answer: inspector_name,
 * inspector_license_number". Both come from the inspector's profile and had
 * been missing since before the inspection existed.
 *
 * ── WHY THE TWO GROUPS ──────────────────────────────────────────────────────
 * A field the inspector answers on this job and a field that lives on their
 * profile are different work in different places, and lumping them into one
 * list sends someone hunting through the report for a licence number that was
 * never going to be there. The split comes from the template's own bindings
 * (`fact-provenance.ts`), never from the field's name — TREC's
 * `inspector_license_number` binds to the fact `inspector_license`, so a
 * name-based guess puts them in different groups and points at the wrong screen.
 *
 * ── NULL VS EMPTY ───────────────────────────────────────────────────────────
 * This component is not rendered at all for `null` — that means the question
 * could not be answered. An EMPTY `missing` is the other thing entirely: the
 * question was asked and everything is answered, which is worth saying out
 * loud. Collapsing the two would print a green tick over a form nobody checked.
 */
export interface StatutoryCoverageData {
    formId: string;
    formTitle: string;
    revision: string | null;
    requiredTotal: number;
    missing: { field: string; provenance: "pre_inspection" | "per_inspection" | "unknown" }[];
}

export interface StatutoryCoveragePanelProps {
    coverage: StatutoryCoverageData | null;
    /** Where the watermarked preview lives for this inspection. */
    previewHref: string;
}

/** A field name as the form's own map spells it, made readable without lying. */
function readable(field: string): string {
    return field.replace(/_/g, " ");
}

export function StatutoryCoveragePanel({ coverage, previewHref }: StatutoryCoveragePanelProps) {
    // Not "nothing is missing" — "nobody could ask". See the note above.
    if (coverage === null) return null;

    const profile = coverage.missing.filter((f) => f.provenance === "pre_inspection");
    // `unknown` rides with the per-inspection group rather than the profile one.
    // A field nobody has classified is not evidence that it lives on a settings
    // screen, and sending an inspector to Settings for something they answer on
    // the page is a wrong instruction; leaving it here is merely a vague one.
    const onJob = coverage.missing.filter((f) => f.provenance !== "pre_inspection");
    const complete = coverage.missing.length === 0;

    return (
        <section className="mt-8" data-testid="statutory-coverage">
            <Card className="p-5 space-y-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 className="text-[15px] font-bold text-ih-fg-1">
                        {m.statutory_coverage_title()}
                    </h2>
                    <Pill tone={complete ? "sat" : "warning"}>
                        {complete
                            ? m.statutory_coverage_complete()
                            : m.statutory_coverage_missing({
                                count: coverage.missing.length,
                                total: coverage.requiredTotal,
                            })}
                    </Pill>
                </div>
                <p className="text-[12px] text-ih-fg-3">
                    {m.statutory_coverage_subtitle({
                        // The authority's own NAME for the document. `formId` is
                        // a database key; printing it asks the reader to
                        // recognise "tx_trec_rei".
                        formTitle: coverage.formTitle,
                        revision: coverage.revision ?? "",
                    })}
                </p>

                {profile.length > 0 ? (
                    <div data-testid="statutory-coverage-profile">
                        <h3 className="text-[13px] font-medium text-ih-fg-1">
                            {m.statutory_coverage_profile_group()}
                        </h3>
                        {/* The hint carries the REMEDY. Naming the fields without
                            saying where they are fixed is the same shape as the
                            refusal this replaces: correct, and not actionable
                            from where the reader is standing. */}
                        <p className="mt-0.5 text-[12px] text-ih-fg-3">
                            {m.statutory_coverage_profile_hint()}
                        </p>
                        <ul className="mt-1.5 flex flex-wrap gap-1.5">
                            {profile.map((f) => (
                                <li key={f.field}>
                                    <Pill tone="warning">{readable(f.field)}</Pill>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}

                {onJob.length > 0 ? (
                    <div data-testid="statutory-coverage-inspection">
                        <h3 className="text-[13px] font-medium text-ih-fg-1">
                            {m.statutory_coverage_inspection_group()}
                        </h3>
                        <ul className="mt-1.5 flex flex-wrap gap-1.5">
                            {onJob.map((f) => (
                                <li key={f.field}>
                                    <Pill tone="warning">{readable(f.field)}</Pill>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}

                {/* Offered whether or not anything is missing. A form with every
                    box answered is exactly the one worth LOOKING at, because
                    "answered" says nothing about whether the value landed in the
                    box the authority prints it in. */}
                <div className="border-t border-ih-border pt-3">
                    <a
                        href={previewHref}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[13px] font-medium text-ih-primary-text hover:underline"
                    >
                        {m.statutory_coverage_preview()}
                    </a>
                    <p className="mt-0.5 text-[12px] text-ih-fg-3">
                        {m.statutory_coverage_preview_hint()}
                    </p>
                </div>
            </Card>
        </section>
    );
}
