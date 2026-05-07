/**
 * Spec 2026-05-07 — Comments Library unification.
 *
 * `ratingBucket` classifies a saved user snippet so it stacks alongside
 * the 248 seeded entries in `public/js/canned-comments.js` inside the
 * inspection-edit Library drawer. Mirrors the `rating` field on those
 * seeded entries (`'satisfactory' | 'monitor' | 'defect' | 'all'`), but
 * uses `null` for the "general / uncategorized" case so the column is
 * trivially nullable in D1 (the seeded library uses the literal string
 * `'all'` for the same idea).
 */
export type RatingBucket = 'satisfactory' | 'monitor' | 'defect';

/** Whitelist used by Zod enum + UI tabs. */
export const RATING_BUCKETS = ['satisfactory', 'monitor', 'defect'] as const;
