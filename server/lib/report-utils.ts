/**
 * Pure utility functions for inspection report statistics.
 * Supports both dynamic rating levels and legacy 3-level format.
 */
import { findingKey, DEFAULT_UNIT } from './finding-key';

export interface RatingLevel {
  id: string;
  label: string;
  abbreviation: string;
  color: string;
  severity: 'good' | 'marginal' | 'significant' | 'minor';
  isDefect: boolean;
  description?: string;
  /** B-18: Defect/Monitor-style levels pause auto-advance so the inspector can describe the finding. */
  pausesAdvance?: boolean;
}

export interface ReportStats {
  total: number;
  satisfactory: number;
  monitor: number;
  defect: number;
  other: number;
  sectionDefects: Record<string, number>;
  completionPercent: number;
  /** Commercial PCA Phase F (F1) — priority (defect category) roll-up for the Phase S Systems Summary. */
  byCategory: { safety: number; recommendation: number; maintenance: number };
  /** Commercial PCA Phase F (F1) — items whose rating resolves to na_kind 'not_inspected' / 'not_present'. */
  notInspected: number;
  notPresent: number;
}

/* ------------------------------------------------------------------ */
/* FE-3/B-20 — custom defects in the published report                  */
/* ------------------------------------------------------------------ */

interface CustomDefectInput {
  id: string;
  title?: string;
  comment?: string;
  included?: boolean;
  category?: string;
  location?: string | null;
  photos?: Array<{ key: string; croppedKey?: string; annotatedKey?: string; pendingUpload?: boolean }>;
}

export interface ResolvedCustomDefect {
  id: string;
  title: string;
  included: boolean;
  isCustom: true;
  effectiveComment: string;
  effectiveCategory: string;
  effectiveLocation: string | null;
  defectPhotos: Array<{ key: string; originalKey: string; url: string }>;
}

/**
 * Map `result.customComments.defects` (field-authored defects) into the same
 * resolved shape getReportData emits for canned defects, so report renderers
 * draw one list. Previously these rows reached only the repair list and the
 * dashboard stats — the published report silently dropped them.
 */
export function mapCustomDefectsForReport(
  customComments: { defects?: CustomDefectInput[] } | null | undefined,
  makePhotoUrl: (key: string) => string,
): ResolvedCustomDefect[] {
  const rows = customComments?.defects ?? [];
  return rows.map((d) => ({
    id: d.id,
    title: d.title ?? '',
    included: d.included !== false,
    isCustom: true as const,
    effectiveComment: d.comment ?? '',
    effectiveCategory: d.category ?? 'recommendation',
    effectiveLocation: typeof d.location === 'string' && d.location.length > 0 ? d.location : null,
    // #181 PR-G: pending uploads have no R2 object yet — skip them.
    defectPhotos: (d.photos ?? []).filter((p) => !p.pendingUpload).map((p) => {
      const displayKey = p.annotatedKey || p.croppedKey || p.key;
      return { key: displayKey, originalKey: p.key, url: makePhotoUrl(displayKey) };
    }),
  }));
}

interface SchemaSection {
  id: string;
  title: string;
  items: { id: string; label: string }[];
}

const LEGACY_BUCKET_MAP: Record<string, 'satisfactory' | 'monitor' | 'defect'> = {
  Satisfactory: 'satisfactory',
  Monitor: 'monitor',
  Defect: 'defect',
};

/**
 * Maps a rating ID to one of four buckets: satisfactory, monitor, defect, other.
 * When `levels` is provided, uses severity metadata; otherwise falls back to legacy string matching.
 */
export function getRatingBucket(
  ratingId: string | null | undefined,
  levels: RatingLevel[],
): 'satisfactory' | 'monitor' | 'defect' | 'other' {
  if (!ratingId) return 'other';

  if (levels.length > 0) {
    const level = levels.find((l) => l.id === ratingId);
    if (!level) return 'other';
    switch (level.severity) {
      case 'good':
        return 'satisfactory';
      case 'marginal':
        return 'monitor';
      case 'significant':
        return 'defect';
      case 'minor':
        return 'other';
      default:
        return 'other';
    }
  }

  return LEGACY_BUCKET_MAP[ratingId] ?? 'other';
}

/**
 * Commercial PCA Phase F (F1) — distinguish "Not Inspected" (NI) from
 * "Not Present" (NP). Both seed levels map to bucket 'na' → severity 'minor'
 * (see server/data/rating-system-seeds.ts + map-rating-levels.ts), so they are
 * otherwise indistinguishable in the report / Systems Summary. Derived from the
 * level's abbreviation, falling back to its label; returns null for any level
 * that is not a non-defect 'minor' (na) level. No rating-level model change.
 */
export function getNaKind(
  ratingId: string | null | undefined,
  levels: RatingLevel[],
): 'not_inspected' | 'not_present' | null {
  if (!ratingId || levels.length === 0) return null;
  const level = levels.find((l) => l.id === ratingId);
  if (!level || level.isDefect || level.severity !== 'minor') return null;
  const abbr = level.abbreviation.trim().toUpperCase();
  const label = level.label.trim().toLowerCase();
  if (abbr === 'NP') return 'not_present';
  if (abbr === 'NI') return 'not_inspected';
  // Neither standard abbreviation — fall back to the label text.
  if (/not\s*present/.test(label)) return 'not_present';
  if (/not\s*inspected/.test(label)) return 'not_inspected';
  return null;
}

/**
 * Returns the hex color for a rating ID. Falls back to gray (#9ca3af) for unknown/null ratings.
 */
export function getRatingColor(
  ratingId: string | null | undefined,
  levels: RatingLevel[],
): string {
  if (!ratingId) return '#9ca3af';

  if (levels.length > 0) {
    const level = levels.find((l) => l.id === ratingId);
    return level?.color ?? '#9ca3af';
  }

  const legacyColors: Record<string, string> = {
    Satisfactory: '#22c55e',
    Monitor: '#f59e0b',
    Defect: '#f43f5e',
  };
  return legacyColors[ratingId] ?? '#9ca3af';
}

/**
 * Computes aggregate statistics for an inspection report:
 * totals per bucket, per-section defect counts, and completion percentage.
 */
export function computeReportStats(
  sections: SchemaSection[],
  results: Record<string, { rating?: string; value?: unknown }>,
  levels: RatingLevel[],
): ReportStats {
  const stats: ReportStats = {
    total: 0,
    satisfactory: 0,
    monitor: 0,
    defect: 0,
    other: 0,
    sectionDefects: {},
    completionPercent: 0,
    byCategory: { safety: 0, recommendation: 0, maintenance: 0 },
    notInspected: 0,
    notPresent: 0,
  };

  let completedCount = 0;

  for (const section of sections) {
    let sectionDefects = 0;
    for (const item of section.items) {
      stats.total++;
      // Ratings are stored under the composite findingKey (unit:section:item)
      // by the editor; fall back to the bare item.id for legacy results. This
      // MUST match getReportData's per-item resolution (inspection.service.ts)
      // or the summary cards disagree with the rendered item buckets.
      const result = results[findingKey(DEFAULT_UNIT, section.id, item.id)] ?? results[item.id];
      const ratingId = result?.rating ?? null;
      const bucket = getRatingBucket(ratingId, levels);
      stats[bucket]++;
      if (bucket === 'defect') sectionDefects++;
      // Commercial PCA Phase F (F1) — NI/NP roll-up. `result` is the same
      // per-item lookup used above; reuse it (do not re-fetch).
      const naKind = getNaKind(ratingId, levels);
      if (naKind === 'not_inspected') stats.notInspected++;
      else if (naKind === 'not_present') stats.notPresent++;
      // Per-priority defect counts. Counts INCLUDED defects across canned tabs
      // and inspector custom defects; a missing category defaults to
      // 'recommendation' (matching mapCustomDefectsForReport's effectiveCategory).
      const rr = result as {
        tabs?: { defects?: Array<{ included?: boolean; category?: string }> };
        customComments?: { defects?: Array<{ included?: boolean; category?: string }> };
      };
      for (const d of [...(rr?.tabs?.defects ?? []), ...(rr?.customComments?.defects ?? [])]) {
        if (d.included === false) continue;
        const cat = d.category === 'safety' || d.category === 'maintenance' ? d.category : 'recommendation';
        stats.byCategory[cat]++;
      }
      // Mirror inspection-edit.js: an item counts toward completion when a
      // rating is set OR a non-empty value is captured (non-rich types
      // boolean / number / text / textarea / date / select / multi_select
      // / photo_only persist their input on result.value).
      if (ratingId) {
        completedCount++;
      } else {
        const v = result?.value;
        if (v !== undefined && v !== null && v !== ''
            && !(Array.isArray(v) && v.length === 0)) {
          completedCount++;
        }
      }
    }
    stats.sectionDefects[section.id] = sectionDefects;
  }

  stats.completionPercent =
    stats.total > 0 ? Math.round((completedCount / stats.total) * 100) : 0;

  return stats;
}
