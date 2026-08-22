/**
 * The placeholder prose a deployment shows when it has no AI credentials yet.
 *
 * WHY THIS IS ITS OWN MODULE, and not three inline template literals. Every
 * string here is text NO MODEL WROTE, and that is a property the rest of the
 * AI pipeline has to keep straight: these returns carry a null `aiCallId`,
 * leave no provenance row, spend no allowance, and must never be citable as
 * reviewed model output. Collecting them in one file makes that claim
 * checkable by reading one screen rather than by trusting that three branches
 * scattered through a service still agree.
 *
 * They exist so somebody evaluating this engine can click through the whole
 * Suggest and Rewrite flow before deciding whether to pay a provider. Every
 * one of them is prefixed `[DEV]` for exactly that reason: it must be
 * impossible to mistake for inspection content, including in a screenshot.
 *
 * It also keeps `services/ai.service.ts` under the large-file ratchet, which is
 * why the extraction happened when it did rather than later.
 */

/** Marks every string below. Never remove it, and never make it conditional —
 *  the whole safety of shipping placeholder prose rests on it being visible. */
const DEV = '[DEV]';

/** The rewrite mock: it echoes what the inspector asked for, so the round trip
 *  is demonstrably wired without a model having judged anything. */
export function devRewrittenComment(originalComment: string, instruction: string): string {
    return `${DEV} ${originalComment} (rewritten: ${instruction})`.trim();
}

/**
 * The three suggestions the Suggest popover shows with no credentials.
 *
 * Three because the real capability returns three, and a mock with a different
 * shape teaches the UI the wrong lesson about what to lay out.
 */
export function devSuggestedComments(itemName: string): string[] {
    const item = itemName || 'Item';
    return [
        `${DEV} ${item} appears serviceable with no defects observed at the time of inspection.`,
        `${DEV} ${item} requires routine maintenance attention; recommend periodic inspection.`,
        `${DEV} ${item} shows signs of wear; monitor over the next inspection cycle.`,
    ];
}
