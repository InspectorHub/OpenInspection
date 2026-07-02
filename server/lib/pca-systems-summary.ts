/**
 * Commercial PCA Phase S — Systems Summary Table aggregation.
 *
 * One matrix row per system (report section): the WORST condition severity
 * across its rated items, plus per-category counts of included defects. Reads
 * the existing Phase F rating axes already on the report payload — the item
 * `severityBucket` (severity axis) and resolved defects' `effectiveCategory`
 * (the safety/recommendation/maintenance category axis). Server-only.
 */
export type SeverityRank = 'good' | 'marginal' | 'significant' | 'minor';

export interface SystemsSummaryRow {
  systemId: string;
  systemTitle: string;
  worstSeverity: SeverityRank;
  counts: { safety: number; recommendation: number; maintenance: number };
}

interface SummaryDefect {
  included?: boolean;
  effectiveCategory?: string;
}
interface SummaryItem {
  severityBucket?: string;
  resolvedTabs?: { defects?: SummaryDefect[] };
}
export interface SystemsSummaryInput {
  id: string;
  title: string;
  items: SummaryItem[];
}

// Higher number = worse. Drives the per-system worst-severity roll-up.
const SEVERITY_RANK: Record<SeverityRank, number> = {
  good: 0,
  minor: 1,
  marginal: 2,
  significant: 3,
};

function asSeverity(bucket: string | undefined): SeverityRank {
  return bucket === 'marginal' || bucket === 'significant' || bucket === 'minor'
    ? bucket
    : 'good';
}

export function buildSystemsSummary(sections: SystemsSummaryInput[]): SystemsSummaryRow[] {
  return sections.map((section) => {
    let worst: SeverityRank = 'good';
    const counts = { safety: 0, recommendation: 0, maintenance: 0 };
    for (const item of section.items ?? []) {
      const sev = asSeverity(item.severityBucket);
      if (SEVERITY_RANK[sev] > SEVERITY_RANK[worst]) worst = sev;
      for (const d of item.resolvedTabs?.defects ?? []) {
        if (d.included === false) continue;
        const cat =
          d.effectiveCategory === 'safety' || d.effectiveCategory === 'maintenance'
            ? d.effectiveCategory
            : 'recommendation';
        counts[cat]++;
      }
    }
    return { systemId: section.id, systemTitle: section.title, worstSeverity: worst, counts };
  });
}
