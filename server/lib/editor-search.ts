/**
 * Editor full-text search helpers — Competitor parity App.E.3 (Spectora).
 *
 * Pure utility functions used by the inspection editor (`inspection-edit.tsx`
 * + `public/js/inspection-edit.js`) to filter the rendered section/item tree
 * against a free-form query string. Search is case-insensitive substring
 * matching across:
 *   - section titles (`section.title`)
 *   - item labels (`item.label`)
 *   - any text persisted in `results[itemId]` — `notes`, canned-comment
 *     text, custom-comment text, recommendation labels.
 *
 * The editor-side caller passes `results` so we can match the inspector's
 * own typing (a defect comment that says "rusted breaker") not just the
 * static template labels. An empty / whitespace-only query short-circuits
 * to "match everything".
 *
 * Kept as pure functions in `server/lib/` so they unit-test without a DOM /
 * Alpine harness.
 */

/** A canned-comment entry as stored under `results[itemId].cannedComments`.
 *  Only the fields we actually scan. */
interface SearchableCanned {
    cannedId?: string;
    title?: string;
    comment?: string;
    effectiveComment?: string;
}

/** A custom-comment entry as stored under `results[itemId].customComments`.
 *  Only the fields we actually scan. */
interface SearchableCustom {
    id?: string;
    title?: string;
    comment?: string;
    location?: string;
}

/** Per-item editor state — shape matches the live `results` payload that
 *  Alpine populates from `/api/inspections/:id/results`. */
interface SearchableResult {
    notes?: string | null;
    recommendation?: string | null;
    cannedComments?: {
        information?: SearchableCanned[];
        limitations?: SearchableCanned[];
        defects?: SearchableCanned[];
    };
    customComments?: {
        information?: SearchableCustom[];
        limitations?: SearchableCustom[];
        defects?: SearchableCustom[];
    };
}

/** Inspection item — only the fields we read. */
export interface SearchableItem {
    id: string;
    label: string;
}

/** Inspection section — only the fields we read. */
export interface SearchableSection {
    id: string;
    title: string;
    items: SearchableItem[];
}

/** Map of itemId → result row. */
export type SearchableResults = Record<string, SearchableResult | undefined>;

/**
 * Normalize a search query — lowercase + trim. Returns the empty string
 * when the input is falsy, so callers can `if (!normalized) return all`.
 */
export function normalizeQuery(query: string | null | undefined): string {
    if (!query) return '';
    return query.trim().toLowerCase();
}

/** Case-insensitive substring test. Treats `null` / `undefined` haystack
 *  as a non-match (avoids "" matching every query). */
function contains(haystack: string | null | undefined, needle: string): boolean {
    if (!haystack) return false;
    return haystack.toLowerCase().includes(needle);
}

/** Walk a result row's free-text fields and return true if any contains
 *  the (already-lowercased) needle. */
function resultMatches(result: SearchableResult | undefined, needle: string): boolean {
    if (!result) return false;
    if (contains(result.notes ?? null, needle)) return true;
    if (contains(result.recommendation ?? null, needle)) return true;

    const canned = result.cannedComments;
    if (canned) {
        for (const tab of ['information', 'limitations', 'defects'] as const) {
            const list = canned[tab];
            if (!list) continue;
            for (const entry of list) {
                if (contains(entry.title, needle)) return true;
                if (contains(entry.comment, needle)) return true;
                if (contains(entry.effectiveComment, needle)) return true;
            }
        }
    }

    const custom = result.customComments;
    if (custom) {
        for (const tab of ['information', 'limitations', 'defects'] as const) {
            const list = custom[tab];
            if (!list) continue;
            for (const entry of list) {
                if (contains(entry.title, needle)) return true;
                if (contains(entry.comment, needle)) return true;
                if (contains(entry.location, needle)) return true;
            }
        }
    }

    return false;
}

/**
 * Decide whether a single item matches the query. Match sources:
 *   - section.title (so "Roof" surfaces every roof-section item)
 *   - item.label
 *   - result.notes / recommendation / canned + custom comments
 */
export function itemMatches(
    section: SearchableSection,
    item: SearchableItem,
    results: SearchableResults,
    query: string,
): boolean {
    const needle = normalizeQuery(query);
    if (!needle) return true;
    if (contains(section.title, needle)) return true;
    if (contains(item.label, needle)) return true;
    return resultMatches(results[item.id], needle);
}

/**
 * Decide whether a section has at least one matching item (or matches
 * directly via title). Used to hide whole sections when nothing matches.
 */
export function sectionMatches(
    section: SearchableSection,
    results: SearchableResults,
    query: string,
): boolean {
    const needle = normalizeQuery(query);
    if (!needle) return true;
    if (contains(section.title, needle)) return true;
    for (const item of section.items) {
        if (itemMatches(section, item, results, needle)) return true;
    }
    return false;
}

/**
 * Filter the section tree against a query. Empty query returns the input
 * unchanged. Sections with zero matching items are dropped. Items inside
 * a section-title hit are all kept (so "Roof" surfaces the whole Roof
 * section, not just the items whose label contains "roof").
 */
export function filterSections<S extends SearchableSection>(
    sections: ReadonlyArray<S>,
    results: SearchableResults,
    query: string,
): S[] {
    const needle = normalizeQuery(query);
    if (!needle) return sections.slice();
    const out: S[] = [];
    for (const section of sections) {
        if (contains(section.title, needle)) {
            out.push(section);
            continue;
        }
        const matchingItems = section.items.filter((it) =>
            itemMatches(section, it, results, needle),
        );
        if (matchingItems.length === 0) continue;
        out.push({ ...section, items: matchingItems });
    }
    return out;
}

/**
 * Wrap every case-insensitive occurrence of `query` inside `text` with
 * `<mark>` tags. Returns the original text if the query is empty.
 *
 * The result is **not** HTML-safe — callers must HTML-escape `text`
 * upstream OR (preferable for Alpine) bind the highlighted markup
 * via `x-html` only when the surrounding context is trusted. We
 * escape `<`, `>`, `&` defensively here so an item label containing
 * raw HTML can't break out of the `<mark>` wrapper.
 */
export function highlightMatches(text: string | null | undefined, query: string): string {
    if (!text) return '';
    const safe = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const needle = normalizeQuery(query);
    if (!needle) return safe;
    // Escape regex meta-characters in the query so the user can search
    // for "(GFCI)" without blowing up.
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'gi');
    return safe.replace(re, (match) => `<mark>${match}</mark>`);
}
