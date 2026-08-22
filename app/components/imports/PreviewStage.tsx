import { useState } from "react";
import { Banner, Button, Card } from "@core/shared-ui";

import type { BatchStructure } from "~/lib/imports-types";
import { m } from "~/paraglide/messages";

/**
 * What actually came through, anomalies first.
 *
 * ── Why this screen exists ──────────────────────────────────────────────────
 * The import step prints four numbers and they always add up. They cannot tell
 * a good conversion from a useless one: a template whose seventy-six items all
 * became plain text boxes reports the same total, the same "ready" count and
 * the same zero problems as one that converted perfectly. The operator finds
 * out weeks later, on a job, with nothing to rate.
 *
 * ── Why the tree is BEHIND a disclosure ─────────────────────────────────────
 * Seventy-six item names in front of the reader is the same failure as the
 * count table in a different font: everything is there and nothing is said.
 * The anomalies lead; the structure is available for the person who wants to
 * check a particular section.
 *
 * ── And why the aftercare list is NOT an anomaly ────────────────────────────
 * A conversion of this kind is never perfect — the rating reading is the
 * operator's own answer to a question no code can settle — so the same three
 * things want looking at whether or not anything went wrong. Folding them into
 * the anomaly list would make a clean import look broken; leaving them out
 * entirely leaves them to be discovered on a job.
 */
export function PreviewStage({ structure }: { structure: BatchStructure }) {
    const [showTree, setShowTree] = useState(false);

    const found = anomaliesIn(structure);
    // "Nothing is wrong" is a claim about the WHOLE region, and it used to be
    // computed from the item landings alone — so a template that converted
    // cleanly but lost entries rendered a green banner immediately above the
    // list of what it lost. The banner now answers for everything under it.
    const nothingToLookAt =
        found.length === 0 && structure.dropped.length === 0 && structure.warnings.length === 0;

    return (
        <Card className="p-5 space-y-4">
            <div className="space-y-1">
                <h3 className="text-[15px] font-bold text-ih-fg-1">{m.imports_preview_title()}</h3>
                <p className="text-[12px] text-ih-fg-3 max-w-[70ch]">{m.imports_preview_intro()}</p>
            </div>

            {/* One region, always present. An empty anomaly area and a missing
                one look identical, and "nothing is wrong" is the information. */}
            <div data-testid="preview-anomalies" className="space-y-2">
                {nothingToLookAt && <Banner tone="success">{m.imports_preview_none()}</Banner>}
                {found.map((sentence, i) => (
                    <Banner key={i} tone="warn">{sentence}</Banner>
                ))}
                {/* Named, never counted. A count tells the operator something is
                    missing without telling them what, and the name is how they
                    find it in their own file. */}
                {structure.dropped.length > 0 && (
                    <div className="rounded-ih-card border border-ih-border p-3 space-y-1">
                        <p className="text-[12px] font-bold text-ih-fg-2">
                            {m.imports_preview_dropped_lead()}
                        </p>
                        <ul className="space-y-0.5">
                            {structure.dropped.map((entry, i) => (
                                <li key={`${entry.at}-${i}`} className="text-[12px] text-ih-fg-3">
                                    {m.imports_preview_dropped_entry({
                                        reason: entry.reason, at: entry.at,
                                    })}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {/* Separate from the list above, because these are not losses.
                    A comment whose type the file did not state came across —
                    under Information, which is a reading nobody asked for. The
                    aftercare list says that happens; this says it happened to
                    THIS file, and names what the file actually said. */}
                {structure.warnings.length > 0 && (
                    <div className="rounded-ih-card border border-ih-border p-3 space-y-1">
                        <p className="text-[12px] font-bold text-ih-fg-2">
                            {m.imports_preview_warnings_lead()}
                        </p>
                        <ul className="space-y-0.5">
                            {structure.warnings.map((entry, i) => (
                                <li key={`${entry.code}-${i}`} className="text-[12px] text-ih-fg-3">
                                    {entry.message}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            <div data-testid="preview-aftercare" className="space-y-1">
                <h4 className="text-[12px] font-bold uppercase tracking-[0.15em] text-ih-fg-3">
                    {m.imports_preview_aftercare_title()}
                </h4>
                <ul className="space-y-0.5 text-[12px] text-ih-fg-2 max-w-[70ch] list-disc pl-5">
                    <li>{m.imports_preview_aftercare_ratings()}</li>
                    <li>{m.imports_preview_aftercare_comments()}</li>
                    <li>{m.imports_preview_aftercare_order()}</li>
                </ul>
            </div>

            <div className="space-y-2">
                <Button variant="secondary" onClick={() => setShowTree((open) => !open)}>
                    {showTree
                        ? m.imports_preview_hide_structure()
                        : m.imports_preview_show_structure()}
                </Button>
                {showTree && (
                    <div className="rounded-ih-card border border-ih-border divide-y divide-ih-border">
                        {structure.sections.map((section, i) => (
                            <div key={`${section.title}-${i}`} className="p-3 space-y-1">
                                <p className="text-[13px] font-bold text-ih-fg-1">
                                    {section.title}{" "}
                                    <span className="font-normal text-ih-fg-3">
                                        {m.imports_preview_section_items({
                                            count: String(section.items.length),
                                        })}
                                    </span>
                                </p>
                                <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
                                    {section.items.map((item, j) => (
                                        <li
                                            key={`${item.label}-${j}`}
                                            className="text-[12px] text-ih-fg-3"
                                        >
                                            {item.label}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Card>
    );
}

/**
 * What is worth a person's attention, as sentences.
 *
 * The criteria are fixed and none of them is "looks wrong". Each one is a
 * fact about the produced structure that the four counts cannot express, and
 * each is a comparison rather than a threshold on one number:
 *
 *  · MOST OR ALL of the items came through as plain text. This is the
 *    disaster: the totals add up, nothing is a problem row, and the template
 *    is useless. Stated as a fact rather than as an accusation, because the
 *    same shape is produced when the operator deliberately says his words are
 *    not ratings — and he needs to see it either way.
 *  · SOME did, while the rest did not. An inconsistency inside one template is
 *    almost never what a file meant, and it is invisible in any total.
 *  · A SECTION came through with nothing in it.
 *
 * An item that became a list of the operator's OWN answers is not counted as a
 * loss: that is what he asked for, and a rule that counted anything-but-rated
 * would shout at every template imported that way.
 *
 * Dropped entries are handled by the component rather than here, because they
 * are NAMED rather than counted — a sentence would be the thing this list is
 * built to avoid.
 */
function anomaliesIn(structure: BatchStructure): string[] {
    const out: string[] = [];
    const items = structure.sections.flatMap((s) => s.items);
    const plain = items.filter((i) => i.landedAs === "plain").length;

    if (items.length > 0 && plain === items.length) {
        out.push(m.imports_preview_all_plain());
    } else if (plain * 2 > items.length) {
        out.push(m.imports_preview_most_plain());
    } else if (plain > 0) {
        out.push(m.imports_preview_some_plain({ count: String(plain) }));
    }

    const empty = structure.sections.filter((s) => s.items.length === 0).map((s) => s.title);
    if (empty.length > 0) {
        out.push(m.imports_preview_empty_sections({ names: empty.join(", ") }));
    }
    return out;
}
