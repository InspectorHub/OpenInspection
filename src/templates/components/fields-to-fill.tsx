/**
 * Gap 4B — Fields-to-fill chip bar.
 *
 * Appears below the comment textarea when the note contains unresolved
 * [FIELD] placeholders. Each chip is clickable → focuses textarea and
 * selects that placeholder. Shows Tab/Shift+Tab cycling hint.
 *
 * Alpine reads from parent inspectionEditor:
 *   activeItemNote — the current note text
 *   OIFields.findOpenFields() — parses placeholders
 *
 * Visibility: x-show="OIFields.hasOpenFields(activeItemNote)"
 */
import type { FC } from 'hono/jsx';

export const FieldsToFill: FC = () => (
    <div
        x-show="typeof OIFields !== 'undefined' && OIFields.hasOpenFields(getItemNotes(activeItemId))"
        x-cloak
        class="flex flex-wrap items-center gap-2 px-2.5 py-2 rounded-lg border border-dashed"
        style="border-color: var(--ih-primary, #6366f1); background: var(--ih-primary-tint, rgba(99,102,241,0.1));"
    >
        <span class="ih-eyebrow flex-shrink-0" style="color: var(--ih-primary, #6366f1);">
            Fields to fill
        </span>

        <template
            x-for="(f, i) in (typeof OIFields !== 'undefined' ? OIFields.findOpenFields(getItemNotes(activeItemId)) : [])"
            {...{ 'x-bind:key': 'f.tag + i' }}
        >
            <button
                type="button"
                {...{ 'x-on:click': "jumpToField(f.index, f.length)" }}
                class="inline-flex items-center px-1.5 py-0.5 rounded border border-dashed text-[11px] font-mono font-bold cursor-pointer transition-colors"
                style="border-color: var(--ih-primary, #6366f1); color: var(--ih-primary, #6366f1); background: var(--ih-primary-tint, rgba(99,102,241,0.1));"
                x-text="'[' + f.tag + ']'"
            ></button>
        </template>

        <span class="ml-auto text-[10px] text-slate-400 dark:text-slate-500 flex-shrink-0">
            <kbd class="ih-kbd">Tab</kbd> next · <kbd class="ih-kbd">⇧Tab</kbd> prev
        </span>
    </div>
);
