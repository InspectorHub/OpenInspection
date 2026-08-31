import { ItemHeader } from "../editor-shared/ItemHeader";

/**
 * The three lines that say WHICH question the inspector is answering: the
 * section it belongs to, its own label, and the question's description.
 *
 * Split out of `ItemEditor` when the description needed a rule of its own and
 * the file was at its size cap. It is a real unit rather than a slice taken to
 * make a number fit: these three are the only things on that screen that
 * describe the question instead of collecting an answer, and every control
 * below them is about the house.
 *
 * ── 🔴 WHY `whitespace-pre-line`, AND WHY IT IS NOT COSMETIC ────────────────
 * On a statutory template the description is the AUTHORITY'S OWN instruction
 * text, transcribed, and several of those are a list -- the 1802's roof-deck
 * question prints nine lettered options, its retrofit paragraph prints its
 * conditions. Under the CSS default (`white-space: normal`) every line break in
 * the transcription collapses, so nine options arrive as one paragraph and the
 * inspector reads a wall of text where the page in his hand has a list.
 * Measured on that question at 1440px: 20 rendered lines before, 24 after, the
 * difference being the option boundaries becoming visible.
 *
 * `pre-line` and not `pre`: it keeps the authored breaks and still wraps, so a
 * narrow column reflows each line. Measured at 390px, both themes: the
 * paragraph's widest line box ends 1px INSIDE its container and the page does
 * not scroll sideways, where forcing `pre` overshoots by 3,555px.
 */
export interface ItemHeadingProps {
    /** The section this item sits in, printed as the eyebrow. Optional because
     *  the editor can render an item before its section is resolved. */
    sectionTitle: string | undefined;
    label: string;
    /** The question's own instruction text. Absent is the ordinary case. */
    description?: string | undefined;
}

export function ItemHeading({ sectionTitle, label, description }: ItemHeadingProps) {
    return (
        <div>
            <div className="text-[11px] text-ih-primary-text font-bold uppercase tracking-wide">
                {sectionTitle}
            </div>
            <ItemHeader label={label} size="lg" className="mt-1 text-ih-fg-1" as="h2" />
            {description && (
                <p
                    data-testid="item-description-hint"
                    className="mt-1 text-[12px] text-ih-fg-3 leading-relaxed whitespace-pre-line"
                >
                    {description}
                </p>
            )}
        </div>
    );
}
