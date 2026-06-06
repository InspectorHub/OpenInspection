/**
 * B-20 — Defects-tab search + field-added custom defects.
 *
 * Custom defects persist under `result.customComments.defects`, the shape
 * the report renderer and dashboard defect stats already consume
 * (server/services/inspection.service.ts `CustomDefect`); the editor's
 * save-all PATCH carries the whole results map, so no new API surface is
 * needed — the client just has to write the same shape.
 */

export type CustomDefectCategory = 'safety' | 'recommendation' | 'maintenance';

export interface CustomDefect {
  id: string;
  title: string;
  comment?: string;
  included: boolean;
  category: CustomDefectCategory;
  location?: string;
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
