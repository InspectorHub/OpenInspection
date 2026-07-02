export interface TypeaheadEntry {
  id: string;
  title: string;
  comment: string;
  abbrev?: string;
  kind?: "defect" | "information" | "limitations";
}

/** True if `needle`'s chars appear in order within `haystack` (case-insensitive). */
export function isSubsequence(needle: string, haystack: string): boolean {
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  if (!n) return true;
  let i = 0;
  for (let j = 0; j < h.length && i < n.length; j++) {
    if (h[j] === n[i]) i++;
  }
  return i === n.length;
}

const RANK_ABBREV = 0;
const RANK_PREFIX = 1;
const RANK_SUBSEQ = 2;
const RANK_BODY = 3;

/** Rank an item's canned entries against a typed query. Lower rank = better;
 *  ties keep original order. Non-matching entries are dropped. Empty query
 *  returns every entry unchanged (used by the "Recommended ▾" button). */
export function rankTypeaheadMatches(
  entries: readonly TypeaheadEntry[],
  query: string,
): TypeaheadEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  const scored: Array<{ e: TypeaheadEntry; rank: number; idx: number }> = [];
  entries.forEach((e, idx) => {
    const title = (e.title || "").toLowerCase();
    const body = (e.comment || "").toLowerCase();
    const abbrev = (e.abbrev || "").toLowerCase();
    let rank = -1;
    if (abbrev && abbrev === q) rank = RANK_ABBREV;
    else if (title.startsWith(q)) rank = RANK_PREFIX;
    else if (isSubsequence(q, title)) rank = RANK_SUBSEQ;
    else if (body.includes(q)) rank = RANK_BODY;
    if (rank >= 0) scored.push({ e, rank, idx });
  });
  scored.sort((a, b) => a.rank - b.rank || a.idx - b.idx);
  return scored.map((x) => x.e);
}

/** The unique entry whose `abbrev` exactly equals the query, else null.
 *  Powers the text-expander "type code + Enter inserts" shortcut. */
export function exactAbbrevMatch(
  entries: readonly TypeaheadEntry[],
  query: string,
): TypeaheadEntry | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const hits = entries.filter((e) => (e.abbrev || "").toLowerCase() === q);
  return hits.length === 1 ? hits[0] : null;
}

type LooseCanned = { id: string; title: string; comment: string; abbrev?: string };

/** Flatten an item's three tabs into a single ranked-source list, defects first. */
export function flattenItemTabs(
  tabs:
    | { defects?: LooseCanned[]; information?: LooseCanned[]; limitations?: LooseCanned[] }
    | undefined,
): TypeaheadEntry[] {
  if (!tabs) return [];
  const out: TypeaheadEntry[] = [];
  for (const d of tabs.defects ?? []) out.push({ ...d, kind: "defect" });
  for (const i of tabs.information ?? []) out.push({ ...i, kind: "information" });
  for (const l of tabs.limitations ?? []) out.push({ ...l, kind: "limitations" });
  return out;
}

/** Text on the current line from the last newline up to the caret (trimmed left). */
export function fragmentBeforeCaret(value: string, caret: number): string {
  const upto = value.slice(0, Math.max(0, caret));
  const nl = upto.lastIndexOf("\n");
  return upto.slice(nl + 1).trimStart();
}

/** Replace the current-line fragment (see fragmentBeforeCaret) with `replacement`,
 *  preserving the line's leading whitespace. Returns the new value + caret. */
export function replaceFragmentBeforeCaret(
  value: string,
  caret: number,
  replacement: string,
): { value: string; caret: number } {
  const c = Math.max(0, caret);
  const upto = value.slice(0, c);
  const nl = upto.lastIndexOf("\n");
  const lineStart = nl + 1;
  const leadWs = upto.slice(lineStart).match(/^\s*/)?.[0] ?? "";
  const before = value.slice(0, lineStart) + leadWs;
  const after = value.slice(c);
  const newValue = before + replacement + after;
  return { value: newValue, caret: (before + replacement).length };
}
