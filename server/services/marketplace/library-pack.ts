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

/** Count the importable items a catalogue entry advertises. */
export function countLibrarySchemaItems(schema: unknown): number {
    return parseLibraryComments(schema).length;
}
