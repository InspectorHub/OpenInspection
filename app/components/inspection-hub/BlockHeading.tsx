import { Pill } from "@core/shared-ui";
import type { PillTone } from "~/lib/hub-blocks";

/**
 * The heading every hub card starts with: a small-caps title on the left, and
 * this card's status on the right.
 *
 * The hub is a column of sibling cards a reader scans rather than reads, so
 * position has to carry meaning on its own. Two rules, and neither has an
 * exception:
 *
 *   - **The header is a label, never a control.** Title left, status right,
 *     nothing clickable. A right-aligned column of status pills is the thing a
 *     reader scans down when they open the page.
 *   - **Every card's actions sit at the bottom of the card**, below the content
 *     they act on. Not here.
 *
 * This heading briefly carried an `action` slot for "the card's one entry
 * action". It looked principled and read as random: People and Schedule got
 * header buttons while Agreement and Invoice got body buttons, and nothing on
 * screen explained why — you cannot see how many actions a card has before you
 * look at it. And the rule could never cover Report, which has six. A rule the
 * busiest card is exempt from is not a rule, so the slot is gone.
 */
export function BlockHeading({
    title,
    pill,
}: {
    title: string;
    pill?: { tone: PillTone; label: string };
}) {
    return (
        <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-[13px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-3">
                {title}
            </h2>
            {pill && <Pill tone={pill.tone}>{pill.label}</Pill>}
        </div>
    );
}
