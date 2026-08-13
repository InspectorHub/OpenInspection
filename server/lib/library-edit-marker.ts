/**
 * Telling an inspector's rewrite apart from a row that arrived as-is.
 *
 * An imported canned comment and an imported canned comment the inspector spent
 * an evening rewriting are the same row in the same table. Before the edit
 * marker existed nothing could separate them, which is why a marketplace
 * "replace" re-import deleted both (see #348).
 *
 * The marker is a hash of the text captured AT IMPORT TIME, not a "row was
 * written to" timestamp. That choice is the whole design:
 *
 *   - a row edited and then changed back is not a conflict — its text hashes to
 *     what we imported, so there is nothing to protect;
 *   - a write path that forgets to stamp a timestamp still cannot hide an edit,
 *     because the evidence is the content itself;
 *   - a row whose imported text is still present verbatim in the new pack was
 *     not touched by the publisher, so it never needs to be raised at all.
 *
 * `comments.edited_at` exists alongside it and is display only ("edited 12
 * March"). Nothing here reads it to make a decision.
 */

/** One entry as it appears in a marketplace comment pack's schema. */
export interface PackEntry {
    text: string;
    section?: string;
}

/** A comment row from the prior import, as the planner needs to see it. */
export interface PriorRow {
    id: string;
    text: string;
    section: string | null;
    importHash: string | null;
    editedAt: Date | number | null;
}

/**
 * What the publisher's side of a pair shows.
 *
 * - `changed`   — v2 carries a different text that we believe replaces this one.
 * - `unchanged` — v2 still carries the text we originally imported, verbatim.
 *                 `text` is therefore the inspector's own "before".
 * - `removed`   — nothing in v2 plausibly corresponds to it any more.
 */
export interface PublishedSide {
    kind: 'changed' | 'unchanged' | 'removed';
    text: string | null;
}

export interface EditPair {
    commentId: string;
    section: string | null;
    /** The inspector's current text — their words, the thing at stake. */
    yours: string;
    /** Epoch milliseconds, or null for a row edited before the marker existed. */
    editedAt: number | null;
    published: PublishedSide;
}

export interface ReplacePlan {
    /** Rows carrying this library_id for this tenant. */
    total: number;
    /** Of those, how many the publisher altered or dropped in the new pack. */
    publisherChanged: number;
    /** Of those, how many differ from what we imported. */
    edited: number;
    /** One per edited row: their version beside the publisher's. */
    pairs: EditPair[];
    /** Row ids that "keep my edits" must not delete. */
    preservedIds: string[];
    /**
     * Indexes into the new pack that "keep my edits" must not insert: entries
     * byte-identical to a preserved row's imported text. Re-inserting one would
     * hand the inspector back, as a second row, the exact sentence they
     * deliberately rewrote.
     */
    skipEntryIndexes: number[];
}

/**
 * Whitespace is not a rewrite. Reflowing a paragraph or collapsing a double
 * space must not read as "the inspector changed this", so the hash is taken
 * over a normalized form rather than the raw stored string.
 */
export function normalizeCommentText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

/** SHA-256 hex of the normalized text. Available in workerd and Node alike. */
export async function hashCommentText(text: string): Promise<string> {
    const bytes = new TextEncoder().encode(normalizeCommentText(text));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

export function hashCommentTexts(texts: string[]): Promise<string[]> {
    return Promise.all(texts.map(hashCommentText));
}

/**
 * Words that say nothing about which sentence this is. Left in, they inflate
 * every comparison by roughly the same amount, which flattens the gap between a
 * real successor and an unrelated line.
 */
const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from',
    'has', 'have', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'this',
    'to', 'was', 'were', 'with',
]);

function contentWords(s: string): Set<string> {
    return new Set(
        normalizeCommentText(s).toLowerCase().split(/[^a-z0-9]+/)
            .filter((w) => w && !STOPWORDS.has(w)),
    );
}

/**
 * Word overlap, used ONLY to pair a rewrite with its likely v2 successor.
 *
 * Deliberately the overlap coefficient (shared / smaller set) rather than
 * Jaccard. A rewrite and its successor are two independent expansions of one
 * original: each adds words the other does not have, and Jaccard charges for
 * both additions twice over, scoring a genuine pair near zero. Measured against
 * the smaller set instead, "keeps most of the shorter sentence's substance"
 * survives that.
 */
function similarity(a: string, b: string): number {
    const wa = contentWords(a);
    const wb = contentWords(b);
    if (wa.size === 0 || wb.size === 0) return 0;
    let shared = 0;
    for (const w of wa) if (wb.has(w)) shared++;
    // Two words in common is coincidence in a library about the same building.
    if (shared < 3) return 0;
    return shared / Math.min(wa.size, wb.size);
}

/**
 * Below this, two sentences are not plausibly versions of each other and the
 * honest answer is "the publisher removed it" rather than an invented pairing.
 */
const PAIR_THRESHOLD = 0.34;

/**
 * Decide what a replace would do, before doing any of it.
 *
 * Two questions get answered here and they are deliberately answered by
 * different means:
 *
 *   WHAT GETS DELETED rests entirely on hash equality. It is exact, and every
 *   row's fate is decided by comparing its own text against its own recorded
 *   import hash. No heuristic touches it.
 *
 *   WHAT THE PAGE SHOWS beside a rewrite has to guess, because a pack's entries
 *   carry no stable ids: there is no way to know for certain which v2 sentence
 *   succeeds which v1 sentence. So pairing falls back to word overlap, and says
 *   "removed" rather than guessing when nothing is close. A mispaired display
 *   is a misleading screen; it can never cost anyone a row.
 */
export async function buildReplacePlan(
    priorRows: PriorRow[],
    packEntries: PackEntry[],
): Promise<ReplacePlan> {
    // Stable order so two runs over the same data pair the same way.
    const rows = [...priorRows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const rowHashes = await hashCommentTexts(rows.map((r) => r.text));
    const entryHashes = await hashCommentTexts(packEntries.map((e) => e.text));

    // hash -> entry indexes still available to claim as "this is the original".
    const byHash = new Map<string, number[]>();
    entryHashes.forEach((h, i) => {
        const bucket = byHash.get(h);
        if (bucket) bucket.push(i); else byHash.set(h, [i]);
    });

    const pairs: EditPair[] = [];
    const preservedIds: string[] = [];
    const skipEntryIndexes: number[] = [];
    let publisherChanged = 0;
    let edited = 0;

    // An entry that IS some row's imported text is the "before", not a candidate
    // successor — pairing must never offer it as the publisher's new version.
    const claimedAsOriginal = new Set<number>();
    for (const row of rows) {
        if (row.importHash) {
            const bucket = byHash.get(row.importHash);
            if (bucket) for (const i of bucket) claimedAsOriginal.add(i);
        }
    }
    const consumedAsSuccessor = new Set<number>();

    rows.forEach((row, i) => {
        // A row with no recorded import hash predates the marker (or is
        // tenant-authored). Nothing was recorded, so nothing is claimed about
        // it: not edited, not changed by the publisher.
        if (!row.importHash) return;

        const originals = byHash.get(row.importHash);
        const publisherTouched = !originals || originals.length === 0;
        if (publisherTouched) publisherChanged++;

        if (rowHashes[i] === row.importHash) return; // still exactly as imported
        edited++;
        preservedIds.push(row.id);

        let published: PublishedSide;
        if (!publisherTouched) {
            // v2 still ships the sentence this row started as: show it as the
            // inspector's "before", and do not re-insert it under their rewrite.
            const idx = originals[0]!;
            published = { kind: 'unchanged', text: packEntries[idx]!.text };
            skipEntryIndexes.push(idx);
        } else {
            let best = -1;
            let bestScore = 0;
            packEntries.forEach((entry, j) => {
                if (claimedAsOriginal.has(j) || consumedAsSuccessor.has(j)) return;
                // A same-section candidate wins ties; sections are how a pack is
                // organised, so a Roof line does not succeed a Plumbing line.
                const sectionBonus = row.section && entry.section === row.section ? 0.05 : 0;
                const score = similarity(row.text, entry.text) + sectionBonus;
                if (score > bestScore) { bestScore = score; best = j; }
            });
            if (best >= 0 && bestScore >= PAIR_THRESHOLD) {
                consumedAsSuccessor.add(best);
                published = { kind: 'changed', text: packEntries[best]!.text };
            } else {
                published = { kind: 'removed', text: null };
            }
        }

        const editedAtMs = row.editedAt instanceof Date
            ? row.editedAt.getTime()
            : typeof row.editedAt === 'number' ? row.editedAt : null;

        pairs.push({
            commentId: row.id,
            section:   row.section,
            yours:     row.text,
            editedAt:  editedAtMs,
            published,
        });
    });

    return {
        total: rows.length,
        publisherChanged,
        edited,
        pairs,
        preservedIds,
        skipEntryIndexes,
    };
}
