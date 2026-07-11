/**
 * Commercial PCA Phase C — pure, IO-free cost computation. Reused by
 * HTML / PDF / CSV / xlsx / Word. All money is integer cents; conversion to a
 * `$` string happens only at the render/export edge (app/lib/money.ts formatCents).
 *
 * Two tables (ASTM E2018 + real-PCA parity):
 *  - TABLE 1: Deferred Maintenance / Opinion of Cost — Immediate + Short-Term.
 *  - TABLE 2: Capital Replacement Reserve Schedule (opt-in, non-ASTM-baseline)
 *    — places each long-term item at currentYear + RUL, with inflation,
 *    cumulative totals, and Per-SF metrics.
 */
export interface CostItem {
  id: string;
  system: string;
  component: string;
  location: string;
  action: 'repair' | 'replace' | 'further_study';
  costMethod: 'unit' | 'lump_sum';
  quantity: number | null;
  uom: string | null;
  unitCostCents: number | null;
  lumpSumCents: number | null;
  eul: number | null;
  effAge: number | null;
  rul: number | null;
  suggestedRemedy: string;
  bucket: 'immediate' | 'short_term' | 'long_term';
  sectionRef: string | null;
  photoRef: string | null;
  sortOrder: number;
}

/** Integer cents. `unit` => qty x unit cost; `lump_sum` => lump sum. */
export function lineTotal(item: CostItem): number {
  if (item.costMethod === 'lump_sum') return item.lumpSumCents ?? 0;
  return (item.quantity ?? 0) * (item.unitCostCents ?? 0);
}

export interface ThresholdResult {
  kept: CostItem[];
  dropped: CostItem[];
}

const DEFAULT_MIN_CENTS = 300_000;        // $3,000 (ASTM §10.3.1)
const DEFAULT_LIKE_GROUP_CENTS = 1_000_000; // $10,000

/**
 * Drop items below `minCents` unless they belong to a like-group (same
 * system+component) of 4+ items whose combined total exceeds `likeGroupCents`
 * (ASTM §10.3.1). Zero-cost `further_study` placeholders are always kept.
 * Dropped items are surfaced for the Phase S Deviations note.
 */
export function applyThreshold(
  items: CostItem[],
  opts?: { minCents?: number; likeGroupCents?: number },
): ThresholdResult {
  const minCents = opts?.minCents ?? DEFAULT_MIN_CENTS;
  const likeGroupCents = opts?.likeGroupCents ?? DEFAULT_LIKE_GROUP_CENTS;

  // Build like-groups and decide which groups are rescued.
  const groups = new Map<string, CostItem[]>();
  for (const it of items) {
    const key = `${it.system} ${it.component}`;
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }
  const rescued = new Set<string>();
  for (const [key, arr] of groups) {
    const total = arr.reduce((s, it) => s + lineTotal(it), 0);
    if (arr.length >= 4 && total > likeGroupCents) rescued.add(key);
  }

  const kept: CostItem[] = [];
  const dropped: CostItem[] = [];
  for (const it of items) {
    const total = lineTotal(it);
    const isZeroFurtherStudy = it.action === 'further_study' && total === 0;
    const key = `${it.system} ${it.component}`;
    if (isZeroFurtherStudy || total >= minCents || rescued.has(key)) kept.push(it);
    else dropped.push(it);
  }
  return { kept, dropped };
}
