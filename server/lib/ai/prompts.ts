/**
 * The prompts every AI feature sends, addressable by a stable version token.
 *
 * They used to be inline template literals inside `AIService`, which made them
 * unnameable: a prompt could be reworded in a routine edit and nothing —
 * no test, no log line, no stored row — could tell an old output from a new
 * one afterwards. A prompt is the largest single input to what the model
 * returns, so it needs the same treatment as any other versioned input.
 *
 * Each entry carries a `version` that is a NAME, not a hash and not a
 * timestamp: it is written down once and changed only when the wording
 * changes. Bump the suffix (`.v1` → `.v2`) in the same commit that edits the
 * text, never separately. Nothing persists these tokens yet; making them exist
 * and be stable is the prerequisite for a future `prompt_version` on stored AI
 * output, and that step is a schema change that does not belong here.
 *
 * The text below is a verbatim move. Rewording a prompt changes model output,
 * and no test in this repository would notice.
 */

/** Context the rewrite prompt renders above the comment being revised. */
export interface RewriteCommentPromptArgs {
    itemLabel:       string;
    sectionTitle:    string;
    tab:             'information' | 'limitations' | 'defects';
    originalComment: string;
    instruction:     string;
    category?:       'safety' | 'recommendation' | 'maintenance';
    location?:       string;
}

/** Item context the suggestion prompt renders. Extra caller fields (e.g. the
 *  property address) are accepted and ignored — the prompt names what it uses. */
export interface SuggestCommentPromptArgs {
    itemName:    string;
    sectionName: string;
    rating?:     string;
    yearBuilt?:  number | null;
    sqft?:       number | null;
}

/**
 * The four prompts, keyed by feature.
 *
 * `render` owns ALL of the prompt, including the label/join formatting of the
 * context blocks. Leaving that formatting at the call site would mean a
 * version token that covers only part of the text it claims to name.
 */
export const AI_PROMPTS = {
    professionalComment: {
        version: 'professional-comment.v1',
        // `context?: string | undefined`, not `context?: string`: under
        // exactOptionalPropertyTypes the caller's optional parameter arrives as
        // an explicit `undefined`, which a bare `?:` refuses.
        render: (args: { text: string; context?: string | undefined }): string =>
            `You are a professional home inspector. Rewrite the following rough observation into a professional, clear, and objective report comment. 
Keep it concise but informative. 
Context: ${args.context || 'General inspection'}
Rough Note: "${args.text}"
Professional Comment:`,
    },

    inspectionSummary: {
        version: 'inspection-summary.v1',
        render: (args: { defects: string }): string =>
            `You are a professional home inspector. Analyze the following list of defects found during an inspection and provide a high-level summary (2-3 sentences) focusing on the most critical issues for the home buyer.
Defects:
${args.defects}
Summary:`,
    },

    rewriteComment: {
        version: 'rewrite-comment.v1',
        render: (args: RewriteCommentPromptArgs): string => {
            const ctxLines = [
                `Item: "${args.itemLabel}"`,
                `Section: "${args.sectionTitle}"`,
                `Tab: ${args.tab}`,
                args.tab === 'defects' && args.category ? `Defect category: ${args.category}` : null,
                args.tab === 'defects' && args.location ? `Location: ${args.location}` : null,
            ].filter(Boolean).join('\n');

            return `You are a certified home inspector revising a single inspection report comment.
Context:
${ctxLines}

Original comment:
"""${args.originalComment}"""

Instruction from the inspector:
"""${args.instruction}"""

Rewrite the comment to satisfy the instruction while keeping a professional, concise inspection-report tone.
Return only the rewritten comment text — no preamble, no quotes, no markdown.`;
        },
    },

    suggestComment: {
        version: 'suggest-comment.v1',
        render: (args: SuggestCommentPromptArgs): string => {
            const context = [
                args.rating    ? `Rating: ${args.rating}` : null,
                args.yearBuilt ? `Year Built: ${args.yearBuilt}` : null,
                args.sqft      ? `Sq Ft: ${args.sqft}` : null,
            ].filter(Boolean).join(', ');

            return `You are a certified home inspector writing a professional inspection report.
Item: "${args.itemName}" in section "${args.sectionName}"${context ? ` (${context})` : ''}.
Write exactly 3 short, professional inspection comments for this item.
Each comment must be 1-2 sentences, factual, and in standard inspection report style.
Return only a JSON array of 3 strings, no other text. Example: ["Comment 1.", "Comment 2.", "Comment 3."]`;
        },
    },
} as const;
