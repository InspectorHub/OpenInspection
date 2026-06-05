/**
 * Pure utility functions for inspection report statistics.
 * No external dependencies — supports both dynamic rating levels and legacy 3-level format.
 */

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
  photos?: Array<{ key: string; annotatedKey?: string }>;
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
    defectPhotos: (d.photos ?? []).map((p) => {
      const displayKey = p.annotatedKey || p.key;
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
  };

  let completedCount = 0;

  for (const section of sections) {
    let sectionDefects = 0;
    for (const item of section.items) {
      stats.total++;
      const result = results[item.id];
      const ratingId = result?.rating ?? null;
      const bucket = getRatingBucket(ratingId, levels);
      stats[bucket]++;
      if (bucket === 'defect') sectionDefects++;
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
