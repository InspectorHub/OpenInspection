/**
 * What one item's Comments box says on an authority's form.
 *
 * -- WHY THIS IS NOT `notes` -------------------------------------------------
 * The TREC form prints exactly one "Comments:" box per lettered section, and a
 * Texas inspector puts that section's WHOLE narrative in it -- what was looked
 * at, what limited the look, and every deficiency found. In this product that
 * narrative is not one field. It is the included canned information and
 * limitation entries, the included defect entries with the inspector's own
 * edits applied, and the free-text notes. Binding the box to `notes` alone
 * would print an empty Comments box for the ordinary inspection, where the
 * inspector answered entirely by selecting canned entries -- and a blank box on
 * an authority's form reads as an inspector who did not answer, which is the one
 * failure this whole subsystem exists to prevent.
 *
 * -- WHY IT COMPOSES THE SAME TEXT THE REPORT PRINTS -------------------------
 * The state resolution here is deliberately identical to the report's: a state
 * row decides inclusion, a non-empty state comment overrides the canned one, and
 * the result goes through the SAME Mustache renderer with the SAME variables.
 * Two surfaces that resolve the same defect differently would say different
 * things about one finding, on the same inspection, over the same signature.
 *
 * -- WHAT ABSENT MEANS -------------------------------------------------------
 * An item nobody answered composes to the empty string, NOT to a missing key.
 * `values.ts` documents the difference at length: empty means "answered
 * nothing", absent means "never bound", and only the second is a broken
 * template.
 */
import { renderTemplate } from '../mustache';
import { resolveDefectMustacheVars } from '../../services/inspection/shared';
import type { CannedDefect } from '../../services/inspection/report-schema-types';
import type { DefectCommentState } from '../../types/inspection-item-state';

/** One canned info/limitation entry as a template carries it. */
interface CannedEntry { id: string; comment: string; default: boolean }

/** What an inspection recorded about one canned entry. */
interface EntryState { cannedId: string; included?: boolean; comment?: string }

/** The three tabs a rich item carries, as the template snapshot has them. */
export interface ItemCommentTabs {
    information?: readonly CannedEntry[];
    limitations?: readonly CannedEntry[];
    defects?: readonly CannedDefect[];
}

/** The three tabs' per-inspection state, as `inspection_results.data` has them. */
export interface ItemCommentStates {
    information?: readonly EntryState[];
    limitations?: readonly EntryState[];
    defects?: readonly EntryState[];
}

/**
 * Was this entry included, and with what text?
 *
 * `default` decides for an entry the inspector never touched -- the same rule
 * the editor shows them. A state comment wins over the canned one only when it
 * is non-empty, because an empty override is how "cleared the box" looks and
 * clearing a box is not the same as asking for the canned text back.
 */
function includedText(entry: CannedEntry, state: EntryState | undefined): string | null {
    const included = state ? state.included === true : entry.default === true;
    if (!included) return null;
    const override = typeof state?.comment === 'string' && state.comment.length > 0
        ? state.comment
        : null;
    return override ?? entry.comment ?? '';
}

function statesById(states: readonly EntryState[] | undefined): Map<string, EntryState> {
    const out = new Map<string, EntryState>();
    for (const s of states ?? []) out.set(s.cannedId, s);
    return out;
}

function collectPlain(
    entries: readonly CannedEntry[] | undefined,
    states: readonly EntryState[] | undefined,
): string[] {
    const byId = statesById(states);
    const out: string[] = [];
    for (const e of entries ?? []) {
        const text = includedText(e, byId.get(e.id));
        if (text !== null && text.length > 0) out.push(text);
    }
    return out;
}

function collectDefects(
    entries: readonly CannedDefect[] | undefined,
    states: readonly EntryState[] | undefined,
    attributes: Record<string, unknown> | undefined,
): string[] {
    const byId = statesById(states);
    const out: string[] = [];
    for (const d of entries ?? []) {
        const state = byId.get(d.id);
        const text = includedText(d as unknown as CannedEntry, state);
        if (text === null || text.length === 0) continue;
        // The report renders through exactly this call. See the header.
        out.push(renderTemplate(
            text,
            resolveDefectMustacheVars(state as DefectCommentState | undefined, d, attributes),
        ));
    }
    return out;
}

/**
 * The section's narrative, in the order an inspector writes it: what was
 * inspected, what limited the inspection, what was deficient, then anything
 * they typed themselves.
 *
 * Entries are joined by a SPACE, not a newline, and that is a measurement
 * rather than a preference. A hard break costs a whole line whatever sits on
 * it, and these boxes are small: four short entries joined with newlines
 * overflowed the TREC roof-covering comments box at 144 characters in a box
 * that holds about 176 across its lines. On paper an inspector writes that
 * section as a paragraph and the box wraps it; a line per entry is a screen
 * convention that does not survive contact with a fixed-height box.
 *
 * Entries are NOT trimmed, for the reason `values.ts` gives about a deliberate
 * leading space. An entry that itself contains a break KEEPS it -- `fit.ts`
 * measures per line and refuses honestly if the result does not fit.
 */
export function composeItemComments(
    tabs: ItemCommentTabs | undefined,
    states: ItemCommentStates | undefined,
    notes: unknown,
    attributes: Record<string, unknown> | undefined,
): string {
    const parts = [
        ...collectPlain(tabs?.information, states?.information),
        ...collectPlain(tabs?.limitations, states?.limitations),
        ...collectDefects(tabs?.defects, states?.defects, attributes),
    ];
    if (typeof notes === 'string' && notes.length > 0) parts.push(notes);
    return parts.join(' ');
}
