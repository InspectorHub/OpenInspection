/**
 * What a converted template actually looks like, for the preview step.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The import step prints four numbers and they always add up. They cannot tell
 * a good conversion from a useless one: a template whose seventy-six items all
 * became plain text boxes reports the same total, the same "ready" count and
 * the same zero problems as one that converted perfectly. This is the shape
 * that difference is visible in.
 *
 * ── It reports, it does not judge ───────────────────────────────────────────
 * Which of these facts is worth a person's attention is decided on the screen
 * that shows them, in one place, where the wording and the criterion sit
 * together. Splitting the judgement across a service and a component is how a
 * banner and the list under it come to disagree about what is wrong.
 *
 * ── The item vocabulary is OURS, and deliberately not the schema's ──────────
 * `rated / choices / plain` are what the preview says happened, not the item
 * types they came from. The screen must never print our storage names — that
 * is the rule the mapping step exists under — and a shape that carried
 * `textarea` to the browser would put the temptation one property away.
 */
import type { BundleTemplate, EntityCounts } from '../../lib/migration-intake/bundle';
import type { ItemType } from '../../types/template-schema';

/** How one item came out of the conversion. */
type ItemLanding = 'rated' | 'choices' | 'plain';

interface BatchStructureItem {
    label: string;
    landedAs: ItemLanding;
}

interface BatchStructureSection {
    title: string;
    items: BatchStructureItem[];
}

export interface BatchStructure {
    /** The name the template will be saved under. */
    name: string;
    sections: BatchStructureSection[];
    /**
     * Every entry the conversion could not carry, NAMED and located.
     *
     * Always present, empty included: an absent list and an empty one look
     * identical on a screen, and the empty one is the information.
     */
    dropped: { at: string; reason: string }[];
}

/**
 * Which of the three landings an item type is.
 *
 * A total map rather than a default, so an item type added to the schema is a
 * compile error here instead of quietly reporting as `plain` — which would
 * read on the preview as a downgrade that never happened.
 */
const LANDING_FOR_ITEM_TYPE: Record<ItemType, ItemLanding> = {
    rich: 'rated',
    select: 'choices',
    multi_select: 'choices',
    boolean: 'choices',
    text: 'plain',
    textarea: 'plain',
    number: 'plain',
    date: 'plain',
    photo_only: 'plain',
};

/**
 * The structure a run carries, or null when it carries none.
 *
 * Null for a run of contacts or team members, and that is the whole of why the
 * preview step is absent for them: their repair table already IS a row-by-row
 * preview, so a second screen would show the same rows with less on them.
 *
 * The FIRST template when a bundle somehow holds several. An overwrite accepts
 * exactly one and the upload path refuses more, so this can only arise from a
 * bundle delivered from outside — where a preview of the first beats none.
 */
export function buildBatchStructure(
    templates: BundleTemplate[],
    counts: EntityCounts,
): BatchStructure | null {
    const template = templates[0];
    if (!template) return null;
    return {
        name: template.name,
        sections: template.schema.sections.map((section) => ({
            title: section.title,
            items: section.items.map((item) => ({
                label: item.label,
                landedAs: LANDING_FOR_ITEM_TYPE[item.type],
            })),
        })),
        dropped: counts.dropped.map((d) => ({ at: d.at, reason: d.reason })),
    };
}
