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

  let ratedCount = 0;

  for (const section of sections) {
    let sectionDefects = 0;
    for (const item of section.items) {
      stats.total++;
      const result = results[item.id];
      const ratingId = result?.rating ?? null;
      const bucket = getRatingBucket(ratingId, levels);
      stats[bucket]++;
      if (bucket === 'defect') sectionDefects++;
      if (ratingId) ratedCount++;
    }
    stats.sectionDefects[section.id] = sectionDefects;
  }

  stats.completionPercent =
    stats.total > 0 ? Math.round((ratedCount / stats.total) * 100) : 0;

  return stats;
}
