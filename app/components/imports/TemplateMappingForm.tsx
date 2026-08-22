import { useState } from "react";
import { Button, Card, Input, RadioCardGroup } from "@core/shared-ui";

import {
    IMPORT_TEMPLATE_RATING_KINDS,
    type AdapterInspection,
    type TemplateMapping,
} from "~/lib/imports-types";
import { m } from "~/paraglide/messages";

/** The template arm of the mapping step. */
type TemplateInspection = Extract<AdapterInspection, { kind: "template" }>;

/**
 * What the operator's own rating words mean.
 *
 * ── The one thing this screen must not do ───────────────────────────────────
 * It must not name our item types. `rich`, `select` and `textarea` are how the
 * answer is STORED; they are not what the question is. An inspector thinks *"I
 * have Satisfactory / Marginal / Poor"*, and asking him what that "is in this
 * product" makes him learn our schema to finish an import. This is the only
 * place in the wizard that would ask that of him, which is why the rule is
 * written here rather than left to whoever next edits the copy.
 *
 * ── Why it is asked at all ──────────────────────────────────────────────────
 * Twenty-two real templates carried vocabularies of three, four and five
 * entries sharing no words — severity scales, yes/no checklists, statutory
 * codes — and eight carried none. No mapping from that to our item model can
 * be written in code, so the shape carries the vocabulary to the person who
 * knows what it means.
 *
 * ── And why it is sometimes not asked ───────────────────────────────────────
 * A vocabulary that files COMMENTS is already settled — those words are the
 * three comment tabs — so there is nothing to decide and the question is not
 * rendered. Same rule as everywhere else in this wizard: a step, or a
 * question, with nothing to decide is absent rather than empty.
 *
 * ── Verbatim ────────────────────────────────────────────────────────────────
 * The words are printed exactly as the file spells them, leading and trailing
 * spaces included (`whitespace-pre`). Real entries are `' Yes'` and
 * `'Acceptable '`; trimming them for display hides from the person doing the
 * classifying the very thing he is classifying.
 */
export function TemplateMappingForm({
    inspection,
    mapping,
    busy,
    onApply,
}: {
    inspection: TemplateInspection;
    mapping: TemplateMapping;
    busy: boolean;
    onApply: (mapping: TemplateMapping) => void;
}) {
    const [draft, setDraft] = useState<TemplateMapping>(mapping);

    // Asked only of a vocabulary that rates ITEMS, and only when there is one.
    const asks = inspection.ratingsDescribe === "items" && inspection.ratings.length > 0;
    const name = draft.name.trim();

    return (
        <Card className="p-5 space-y-4">
            <div className="space-y-1">
                <h3 className="text-[15px] font-bold text-ih-fg-1">
                    {m.imports_mapping_template_title()}
                </h3>
                <p className="text-[12px] text-ih-fg-3">
                    {m.imports_mapping_template_summary({
                        sections: String(inspection.sections),
                        items: String(inspection.items),
                    })}
                </p>
            </div>

            {/* `id` as well as `label`: the shared input renders
                `<label htmlFor={id}>`, so a label with no id points at nothing
                — invisible to a screen reader and to any query by label. */}
            <Input
                id="import-template-name"
                label={m.imports_mapping_template_name()}
                value={draft.name}
                disabled={busy}
                onChange={(e) => {
                    const next = e.currentTarget.value;
                    setDraft((d) => ({ ...d, name: next }));
                }}
            />

            {asks && (
                <div className="space-y-2">
                    <div className="space-y-1">
                        <p className="text-[12px] text-ih-fg-2">
                            {m.imports_mapping_ratings_lead()}
                        </p>
                        {/* Each word in its own element, printed whitespace and
                            all, so the operator classifies what the file
                            actually holds rather than a tidied version of it. */}
                        <div className="flex flex-wrap gap-x-2 gap-y-1">
                            {inspection.ratings.map((word, i) => (
                                <span
                                    key={`${word}-${i}`}
                                    className="whitespace-pre rounded-ih-button border border-ih-border bg-ih-bg-muted px-2 py-0.5 text-[12px] font-bold text-ih-fg-1"
                                >
                                    {word}
                                </span>
                            ))}
                        </div>
                    </div>

                    <RadioCardGroup
                        name="ratingKind"
                        legend={m.imports_mapping_ratings_legend()}
                        hint={m.imports_mapping_ratings_hint()}
                        value={draft.ratingKind}
                        onChange={(picked) => {
                            // Narrowed against the offered list rather than
                            // cast: this value decides how every item in the
                            // template is built.
                            const kind = IMPORT_TEMPLATE_RATING_KINDS.find((k) => k === picked);
                            if (kind) setDraft((d) => ({ ...d, ratingKind: kind }));
                        }}
                        options={IMPORT_TEMPLATE_RATING_KINDS.map((kind) => ({
                            value: kind,
                            title: RATING_KIND_TITLE[kind](),
                            description: RATING_KIND_HELP[kind](),
                        }))}
                    />
                </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
                <Button
                    variant="primary"
                    disabled={busy || name === ""}
                    onClick={() => { if (name !== "") onApply({ ...draft, name }); }}
                >
                    {m.imports_mapping_template_save()}
                </Button>
                {/* Rendered only when it has something to say — an
                    always-present line is a layout jump, and one reading
                    "Ready" is a second thing to keep true. */}
                {name === "" && (
                    <p className="text-[12px] text-ih-fg-2">
                        {m.imports_mapping_template_needs_name()}
                    </p>
                )}
            </div>
        </Card>
    );
}

/**
 * The question's three answers, in the operator's terms.
 *
 * Keyed by the stored value and written out rather than templated, because a
 * message key has to be a literal for the catalogue to find it — and because
 * the whole point is that the sentence and the stored value are not the same
 * words.
 */
const RATING_KIND_TITLE = {
    severity: m.imports_mapping_ratings_severity,
    choices: m.imports_mapping_ratings_choices,
    none: m.imports_mapping_ratings_none,
} as const;

const RATING_KIND_HELP = {
    severity: m.imports_mapping_ratings_severity_help,
    choices: m.imports_mapping_ratings_choices_help,
    none: m.imports_mapping_ratings_none_help,
} as const;
