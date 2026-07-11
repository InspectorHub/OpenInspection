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

export interface Table1Row {
  item: CostItem;
  total: number;
}

export interface Table1 {
  immediate: Table1Row[];
  shortTerm: Table1Row[];
  immediateTotalCents: number;
  shortTermTotalCents: number;
}

/** TABLE 1 — Immediate + Short-Term buckets, each sorted, with totals. */
export function table1(items: CostItem[]): Table1 {
  const bySort = (a: CostItem, b: CostItem) => a.sortOrder - b.sortOrder;
  const toRows = (bucket: CostItem['bucket']): Table1Row[] =>
    items.filter((it) => it.bucket === bucket).sort(bySort).map((it) => ({ item: it, total: lineTotal(it) }));
  const immediate = toRows('immediate');
  const shortTerm = toRows('short_term');
  const sum = (rows: Table1Row[]) => rows.reduce((s, r) => s + r.total, 0);
  return {
    immediate,
    shortTerm,
    immediateTotalCents: sum(immediate),
    shortTermTotalCents: sum(shortTerm),
  };
}

export interface BucketRollup {
  immediateCents: number;
  shortTermCents: number;
  reserveCents: number;
}

/** Immediate / Short-Term / Long-Term(reserve) totals for the Phase S ES seam. */
export function bucketRollup(items: CostItem[]): BucketRollup {
  const sumOf = (bucket: CostItem['bucket']) =>
    items.filter((it) => it.bucket === bucket).reduce((s, it) => s + lineTotal(it), 0);
  return {
    immediateCents: sumOf('immediate'),
    shortTermCents: sumOf('short_term'),
    reserveCents: sumOf('long_term'),
  };
}

export interface ReserveRow {
  item: CostItem;
  placementYear: number;
  replacementCents: number;
  /** Commercial PCA Phase P/C seam — resolved appendix photo number for
   *  `item.photoRef` (PHOTO NO. column). Never computed here (this module
   *  stays IO/photo-free); the service attaches it once `photoAppendix` is
   *  available. Optional/absent for any producer that skips resolution. */
  photoNo?: number | null;
}

export interface ReserveSchedule {
  startYear: number;
  termYears: number;
  years: number[];
  rows: ReserveRow[];
  uninflatedByYear: number[];
  inflatedByYear: number[];
  cumulativeInflatedByYear: number[];
  totalUninflatedCents: number;
  totalInflatedCents: number;
  perSfUninflatedAllYears: number | null;
  perSfInflatedAllYears: number | null;
  perSfInflatedPerYear: number | null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * TABLE 2 — Capital Replacement Reserve Schedule. Each long-term item's
 * replacement cost lands in column currentYear + clamp(RUL, 0, term-1).
 * Per-year inflation factor = (1 + bps/10000) ^ yearIndex; cumulative is the
 * running sum of inflated yearly totals. Per-SF divides by building area.
 */
export function reserveSchedule(
  longTermItems: CostItem[],
  opts: { currentYear: number; termYears: number; inflationRateBps?: number; buildingAreaSqft?: number | null },
): ReserveSchedule {
  const termYears = Math.max(1, Math.floor(opts.termYears));
  const startYear = opts.currentYear;
  const bps = opts.inflationRateBps ?? 0;
  const years = Array.from({ length: termYears }, (_v, i) => startYear + i);

  const uninflatedByYear = new Array<number>(termYears).fill(0);
  const rows: ReserveRow[] = longTermItems.map((it) => {
    const idx = clamp(it.rul ?? 0, 0, termYears - 1);
    const cents = lineTotal(it);
    uninflatedByYear[idx] += cents;
    return { item: it, placementYear: startYear + idx, replacementCents: cents };
  });

  const factor = 1 + bps / 10_000;
  const inflatedByYear = uninflatedByYear.map((c, i) => Math.round(c * Math.pow(factor, i)));
  const cumulativeInflatedByYear: number[] = [];
  let run = 0;
  for (const c of inflatedByYear) { run += c; cumulativeInflatedByYear.push(run); }

  const totalUninflatedCents = uninflatedByYear.reduce((s, c) => s + c, 0);
  const totalInflatedCents = inflatedByYear.reduce((s, c) => s + c, 0);

  const area = opts.buildingAreaSqft ?? 0;
  const perSf = (cents: number): number | null => (area > 0 ? Math.round(cents / area) : null);
  const perSfUninflatedAllYears = perSf(totalUninflatedCents);
  const perSfInflatedAllYears = perSf(totalInflatedCents);
  const perSfInflatedPerYear = perSfInflatedAllYears === null ? null : Math.round(perSfInflatedAllYears / termYears);

  return {
    startYear, termYears, years, rows,
    uninflatedByYear, inflatedByYear, cumulativeInflatedByYear,
    totalUninflatedCents, totalInflatedCents,
    perSfUninflatedAllYears, perSfInflatedAllYears, perSfInflatedPerYear,
  };
}

export interface FindingSeedInput {
  recommendations?: Array<{
    estimateSnapshotMin?: number | null;
    estimateSnapshotMax?: number | null;
    summarySnapshot?: string | null;
  }> | null;
}
export interface TemplateItemSeed {
  defaultEstimateMin?: number | null;
  defaultEstimateMax?: number | null;
  defaultRecommendation?: string | null;
}
export interface CannedCommentSeed {
  estimateMinCents?: number | null;
  estimateMaxCents?: number | null;
  repairSummary?: string | null;
}
export interface CostSeed {
  unitCostCents: number | null;
  lumpSumCents: number | null;
  suggestedRemedy: string;
}

/** Midpoint of an estimate range (integer cents); null when both bounds absent. */
function estimateMidpoint(min: number | null | undefined, max: number | null | undefined): number | null {
  const lo = min ?? null;
  const hi = max ?? null;
  if (lo === null && hi === null) return null;
  if (lo !== null && hi !== null) return Math.round((lo + hi) / 2);
  return (lo ?? hi) as number;
}

/**
 * Seed a cost line from a finding's existing per-finding cost data (design spec
 * §4 "Cost seeding"). Pure, no IO. Priority: canned comment > finding
 * recommendation snapshot > template default. Values are integer cents; the seed
 * is a starting point the inspector edits (not authoritative). Seeded lines
 * default to the lump-sum method (unitCostCents stays null).
 */
export function seedCostFromFinding(
  finding: FindingSeedInput,
  templateItem: TemplateItemSeed | null,
  cannedComment?: CannedCommentSeed | null,
): CostSeed {
  const rec = finding?.recommendations?.[0];
  const lumpSumCents =
    estimateMidpoint(cannedComment?.estimateMinCents, cannedComment?.estimateMaxCents) ??
    estimateMidpoint(rec?.estimateSnapshotMin, rec?.estimateSnapshotMax) ??
    estimateMidpoint(templateItem?.defaultEstimateMin, templateItem?.defaultEstimateMax);
  const suggestedRemedy =
    cannedComment?.repairSummary?.trim() ||
    rec?.summarySnapshot?.trim() ||
    templateItem?.defaultRecommendation?.trim() ||
    '';
  return { unitCostCents: null, lumpSumCents, suggestedRemedy };
}

export interface CostTables {
  table1: Table1;
  reserveSchedule: ReserveSchedule | null;
  rollup: BucketRollup;
  droppedCount: number;
}

export interface ReserveConfig {
  reserveScheduleEnabled: boolean;
  reserveTermYears: number;
  inflationRateBps: number | null;
}

/**
 * Assemble the report-facing cost tables from raw items. Applies the ASTM $3k
 * threshold first; TABLE 1 + rollup are computed over kept items; the reserve
 * schedule (TABLE 2) is built only when enabled. Pure — the service passes the
 * inspection's area (sqft) and current year.
 */
export function buildCostTables(
  items: CostItem[],
  cfg: ReserveConfig,
  currentYear: number,
  areaSqft: number | null,
): CostTables {
  const { kept, dropped } = applyThreshold(items);
  const t1 = table1(kept);
  const rollup = bucketRollup(kept);
  const longTerm = kept.filter((it) => it.bucket === 'long_term');
  const reserve = cfg.reserveScheduleEnabled
    ? reserveSchedule(longTerm, {
        currentYear,
        termYears: cfg.reserveTermYears,
        ...(cfg.inflationRateBps !== null ? { inflationRateBps: cfg.inflationRateBps } : {}),
        buildingAreaSqft: areaSqft,
      })
    : null;
  return { table1: t1, reserveSchedule: reserve, rollup, droppedCount: dropped.length };
}

const CSV_COLUMNS = [
  'system', 'component', 'location', 'action', 'cost_method', 'quantity', 'uom',
  'unit_cost_cents', 'lump_sum_cents', 'eul', 'eff_age', 'rul', 'bucket',
  'section_ref', 'photo_ref', 'suggested_remedy', 'total_cents',
] as const;

function csvCell(v: string | number | null): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Flat CSV dump of cost items + derived total_cents. Zero-dependency. */
export function costItemsToCsv(items: CostItem[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const it of items) {
    lines.push([
      it.system, it.component, it.location, it.action, it.costMethod, it.quantity, it.uom,
      it.unitCostCents, it.lumpSumCents, it.eul, it.effAge, it.rul, it.bucket,
      it.sectionRef, it.photoRef, it.suggestedRemedy, lineTotal(it),
    ].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}
