/**
 * The one place canned-comment rows enter the table from a pack.
 *
 * A free function beside `library-pack.ts` and `library-replace.ts` rather than
 * a method on MarketplaceService, for the same reason those are: import,
 * preview and replace must provably ask the same questions of the same data,
 * and every path that writes a comment row has to stamp the same marker on it.
 * There is exactly one caller shape and two call sites (first import, and the
 * update that follows a replace).
 */
import { hashCommentTexts } from '../../lib/library-edit-marker';

/** One pack entry, as `parseLibraryComments` returns it. */
export interface LibraryInsertEntry {
    text:     string;
    section?: string;
    rating?:  string;
}

/**
 * Chunked bulk INSERT of canned-comment rows. Raw SQL with a placeholder list
 * is one statement per chunk — dramatically faster than N individual inserts.
 * D1 caps SQL statement size and bound-parameter count, so the chunk size is
 * set against the per-row column count (see CHUNK below).
 *
 * @param rawDb   The raw D1 handle — this path does not go through drizzle.
 * @param firstId When supplied, the very first inserted row uses this id
 *   instead of a fresh UUID (lets the caller return a stable local id).
 * @returns The number of rows inserted.
 */
export async function insertLibraryComments(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawDb: any,
    tenantId: string,
    libraryId: string,
    entries: LibraryInsertEntry[],
    firstId?: string,
): Promise<number> {
    // 18 x 8 = 144 placeholders, still under the 150 this loop shipped with at
    // six columns. Widening a row without narrowing the chunk is how it would
    // quietly start binding past that ceiling.
    const CHUNK = 18;
    // The edit marker (#348). Every imported row records the hash of the text it
    // arrived with, which is the only thing that later lets a re-import tell an
    // untouched row from one the inspector rewrote. Computed here, at the single
    // point rows enter the table from a pack, so no import path can forget it.
    const importHashes = await hashCommentTexts(entries.map((e) => e.text));
    // comments.created_at is timestamp_ms (Schema Rules) — epoch MILLISECONDS.
    // An earlier version of this line bound a floored-to-whole-seconds value
    // into this column; rows it wrote carry a seconds-magnitude number in a ms
    // column (they read as ~1970). That value is exactly recoverable — it is
    // 1000x too small — so a backfill for pre-existing rows is a mechanical
    // follow-up, not data loss; it just isn't run here.
    const nowMs = Date.now();
    let inserted = 0;

    for (let i = 0; i < entries.length; i += CHUNK) {
        const batch = entries.slice(i, i + CHUNK);
        const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const params: (string | number | null)[] = [];
        for (let j = 0; j < batch.length; j++) {
            const c = batch[j]!;
            const isFirst = i === 0 && j === 0;
            params.push(
                isFirst && firstId ? firstId : crypto.randomUUID(),
                tenantId,
                c.text,
                c.section ?? null,
                libraryId,             // S2-7 — provenance for replace mode
                nowMs,
                importHashes[i + j]!,  // #348 — the edit marker
                // A pack classifies each comment in `comments.severity`'s own
                // vocabulary. Dropping it made the marketplace copy of a library
                // poorer than the one the starter seeder writes — same content,
                // two paths, one lossy. Free text like `section`: an unknown
                // word from a third-party pack reads as uncategorised rather
                // than failing the import.
                c.rating ?? null,
            );
        }
        // `section` (not `category`) — an entry never carries a category, only
        // text + section. Pre-existing imported rows have this backwards
        // (section text landed in `category`, and `section` was never written);
        // that is a separate, deliberately forward-only data-quality issue,
        // because `category` is a real, independently-read column elsewhere
        // (repair-item comments' safety / maintenance / recommendation
        // vocabulary, RecommendationService) and this fix does not touch it.
        const stmt = `INSERT INTO comments (id, tenant_id, text, section, library_id, created_at, import_hash, severity) VALUES ${placeholders}`;
        await rawDb.prepare(stmt).bind(...params).run();
        inserted += batch.length;
    }
    return inserted;
}
