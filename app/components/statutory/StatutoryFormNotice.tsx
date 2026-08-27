import { Banner } from "@core/shared-ui";

/**
 * What we declared about a statutory form, shown to the person about to hand it
 * over.
 *
 * -- THE COPY IS NOT IN THIS FILE, AND THAT IS THE POINT ---------------------
 * Every sentence arrives as `notice`, rendered on the server from
 * `server/lib/statutory/disclaimer.ts`. Hard-coding it here would put the text
 * somewhere neither the endorsement-copy gate nor the non-translatable registry
 * looks -- both read the server module -- so the guardrails would go on passing
 * while the sentence a reader actually sees drifted away from the one they
 * check. The component's job is to display faithfully, including the paragraph
 * breaks, not to compose.
 *
 * -- WHY THE IDENTIFIER IS A LABELLED TRIO AND NOT PROSE ---------------------
 * Form, revision and effective date are the three facts a reader has to be able
 * to check against the authority's own site, so they are set as data with their
 * labels rather than buried in a sentence. The prose below them is the
 * allocation statement; these three are the citation.
 *
 * -- TONE ---------------------------------------------------------------------
 * `info`. This is a statement of who did what, not a warning and not an error;
 * `danger` would tell a reader something is wrong when nothing is.
 * NOTE for anyone editing the tone: `Banner`'s "warn" is a COMPONENT-LEVEL
 * alias that resolves to the `watch` design tokens. There is no `ih-warn-*`
 * token -- writing one directly produces no CSS at all, and Tailwind will not
 * complain.
 *
 * -- LABELS ARE DISTINGUISHED BY WEIGHT, NOT BY COLOUR -----------------------
 * The first draft reached for a muted-foreground colour class that does not
 * exist in this palette (there is a muted BACKGROUND and a numbered foreground
 * ramp, but no muted foreground). Tailwind emitted nothing for it, silently.
 * `lint:ds` did catch it -- and then caught this paragraph too when it first
 * spelled the class out, because that gate reads text and cannot tell a
 * className from a sentence about one. Hence the description rather than the
 * name.
 *
 * Colour is the wrong lever here regardless: a toned Banner sets its own
 * foreground, and overriding it is how a label ends up unreadable in one theme
 * only. Weight carries the distinction and inherits whatever the tone decided.
 */
export interface StatutoryFormNoticeProps {
    /** The authority's own identifier for the form, e.g. `fl_oir_b1_1802`. */
    formId: string;
    /** The authority's own revision label, verbatim. */
    revision: string;
    /** `YYYY-MM-DD`, in UTC, matching how the revision was selected. */
    effectiveDate: string;
    /** The rendered notice. Paragraphs separated by a blank line. */
    notice: string;
}

export function StatutoryFormNotice({
    formId,
    revision,
    effectiveDate,
    notice,
}: StatutoryFormNoticeProps) {
    return (
        <Banner tone="info" className="flex-col items-start gap-3">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs font-normal">
                <dt className="font-semibold">Form</dt>
                <dd className="font-mono">{formId}</dd>
                <dt className="font-semibold">Revision</dt>
                <dd className="font-mono">{revision}</dd>
                <dt className="font-semibold">Effective</dt>
                <dd className="font-mono">{effectiveDate}</dd>
            </dl>
            <div className="flex flex-col gap-2 text-xs font-normal leading-relaxed">
                {notice.split("\n\n").map((paragraph) => (
                    <p key={paragraph.slice(0, 40)}>{paragraph.trim()}</p>
                ))}
            </div>
        </Banner>
    );
}
