/**
 * Reading a marketplace comment pack's schema.
 *
 * The column holds JSON, and it reaches us either already parsed (Drizzle json
 * mode) or as a raw string, depending on the driver path. Both readers here
 * tolerate both encodings on purpose: a reader that silently returns nothing for
 * one of them is how a catalogue entry renders "0 items" while holding content.
 */

/** One entry as it appears in a pack's schema. */
export interface LibraryCommentEntry {
    text: string;
    section?: string;
    rating?: string;
}

function parseSchema(schema: unknown): unknown {
    if (typeof schema === 'string') {
        try { return JSON.parse(schema); } catch { return null; }
    }
    return schema;
}

/** Extract the comment entries from a library schema. Returns [] for anything malformed. */
export function parseLibraryComments(schema: unknown): LibraryCommentEntry[] {
    const parsed = parseSchema(schema);
    if (!parsed || typeof parsed !== 'object') return [];
    const comments = (parsed as { comments?: unknown }).comments;
    return Array.isArray(comments) ? comments as LibraryCommentEntry[] : [];
}

/**
 * The pack's own one-paragraph "what is this" line, if it carries one.
 *
 * It lives INSIDE the schema blob rather than in a `marketplace_libraries`
 * column, which is why a browse row never had one: `browseCatalogue` drops the
 * blob (~50KB a row) before answering, and nothing lifted this string out of it
 * first. The browse card meanwhile had a render branch for `description` that
 * could not fire, so seventeen catalogue entries showed a name and nothing else
 * and two comment packs were indistinguishable before installing.
 *
 * Lifted here, beside the item count, because this is where the blob is already
 * parsed — the cost is one property read, not a second pass.
 */
export function parseLibraryDescription(schema: unknown): string | null {
    const parsed = parseSchema(schema);
    if (!parsed || typeof parsed !== 'object') return null;
    const description = (parsed as { description?: unknown }).description;
    return typeof description === 'string' && description.trim().length > 0
        ? description
        : null;
}

/** Count the importable items a catalogue entry advertises. */
export function countLibrarySchemaItems(schema: unknown): number {
    return parseLibraryComments(schema).length;
}
