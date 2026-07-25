import { Pill } from "@core/shared-ui";
import type { PillTone } from "~/lib/hub-blocks";

/**
 * The heading every hub card starts with: a small caps title and an optional
 * status pill. Lives here rather than inside the route so the cards that have
 * been split out of it (see LifecycleCard) use the same one.
 */
export function BlockHeading({
    title,
    pill,
}: {
    title: string;
    pill?: { tone: PillTone; label: string };
}) {
    return (
        <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-3">
                {title}
            </h2>
            {pill && <Pill tone={pill.tone}>{pill.label}</Pill>}
        </div>
    );
}
