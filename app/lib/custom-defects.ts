/**
 * B-20 — Defects-tab search + field-added custom defects.
 *
 * Custom defects persist under `result.customComments.defects`, the shape
 * the report renderer and dashboard defect stats already consume
 * (server/services/inspection.service.ts `CustomDefect`); the editor's
 * save-all PATCH carries the whole results map, so no new API surface is
 * needed — the client just has to write the same shape.
 */

// The trade vocabulary is the server's, re-exported through defect-fields so
// the editor can never offer a value the write path would silently drop.
import type { DefectTrade } from './defect-fields';

// IA-59 — a field-added defect's category is a defect_categories.id or one of
// the three legacy seed names; the form now offers the tenant's configured
// categories, not just the three built-ins. Widened from the old 3-value union.
export type CustomDefectCategory = string;

/** The three built-in seed categories, always offered even with no tenant config. */
export const BUILT_IN_DEFECT_CATEGORIES = ['safety', 'recommendation', 'maintenance'] as const;

export interface CustomDefect {
  id: string;
  title: string;
  comment?: string;
  included: boolean;
  category: CustomDefectCategory;
  location?: string;
  /** IA-85 — mirrors `CustomCommentEntry.trade`: a hand-written defect names
   *  the trade exactly as a canned one does, from the same `DEFECT_TRADES`
   *  vocabulary. The server sanitizer nulls anything outside it. */
  trade?: DefectTrade | null;
}

export interface CannedEntryLike {
  id: string;
  title: string;
  comment: string;
}

export function filterCannedEntries<T extends CannedEntryLike>(
  entries: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter(
    (e) => e.title.toLowerCase().includes(q) || e.comment.toLowerCase().includes(q),
  );
}

/** Track H (IA-5) — first sentence (or first ~60 chars) of a library comment;
 *  used as the custom-defect title when a library search hit seeds the form. */
export function deriveDefectTitle(text: string): string {
  const firstSentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return firstSentence.length > 60
    ? `${firstSentence.slice(0, 57).trimEnd()}…`
    : firstSentence;
}

export function makeCustomDefect(
  input: {
    title: string;
    comment?: string;
    category?: CustomDefectCategory;
    location?: string;
    trade?: DefectTrade | null;
  },
  genId: () => string = () => crypto.randomUUID(),
): CustomDefect | null {
  const title = input.title.trim();
  if (!title) return null;
  const comment = input.comment?.trim();
  return {
    id: genId(),
    title,
    ...(comment ? { comment } : {}),
    category: input.category ?? 'recommendation',
    included: true,
    ...(input.location ? { location: input.location } : {}),
    // Absent stays absent: an explicit null here would merge over a value a
    // collaborating peer set on the same defect.
    ...(input.trade ? { trade: input.trade } : {}),
  };
}

/** Immutably append a custom defect into a result-map entry. */
export function appendCustomDefect<T extends Record<string, unknown>>(
  result: T,
  defect: CustomDefect,
): T & { customComments: { defects: CustomDefect[] } } {
  const cc = (result.customComments ?? {}) as { defects?: CustomDefect[] };
  return {
    ...result,
    customComments: {
      ...cc,
      defects: [...(cc.defects ?? []), defect],
    },
  };
}
