/**
 * What the report projection reads off a frozen template snapshot.
 *
 * Deliberately NOT `TemplateItem`. The report prints answers, not authoring
 * affordances, so it reads a handful of keys on purpose -- and that purpose is
 * declared to `lint:item-key-parity` rather than left to be re-derived by
 * whoever next wonders why `attributes` is missing.
 *
 * These lived inside `getReportData` in `inspection-report.service.ts`. They
 * moved out when that file reached its size cap with one line to spare, and the
 * move is worth more than the lines: a function-local interface cannot be named
 * by a spec, so nothing could assert what the report reads.
 *
 * @declarationEmit The canned-comment shapes are exported so the emitted `.d.ts`
 * can NAME them: they surface in getReportData's inferred return type, and a
 * composite project cannot reference a function-local interface (TS4053/TS4055).
 */
import type { RatingLevel } from '../../lib/report-utils';

/** Spec 5B — v2 template-schema comment shapes. */
export interface CannedInfoComment { id: string; title: string; comment: string; default: boolean }
/** @declarationEmit see CannedInfoComment. */
export interface CannedDefect      { id: string; title: string; category: string; location: string; comment: string; photos: string[]; default: boolean }
/** @declarationEmit see CannedInfoComment. */
export interface ItemTabs          { information: CannedInfoComment[]; limitations: CannedInfoComment[]; defects: CannedDefect[] }

/**
 * One item as the report reads it. Items are 'rich' (rating + three tabs of
 * canned comments) or 'text' (free-text notes).
 */
export interface SchemaItem {
    id: string;
    label: string;
    icon?: string;
    type?: string;
    ratingOptions?: string[];
    tabs?: ItemTabs;
    number?: string;
    /**
     * The item this one nests under. Absent on every snapshot frozen before the
     * field existed -- which is why the renderer fails open to a top-level card
     * rather than treating an unresolvable pointer as an error.
     */
    parentId?: string | null;
}

/**
 * Track E2 (Spectora App.A) — per-section disclaimer + force-page-break are
 * stored on the schema's section node so the editor can author them and the
 * published report can honor them. Both optional; legacy templates without
 * these fields render unchanged.
 */
export interface SchemaSection {
    id: string;
    title: string;
    icon?: string;
    items: SchemaItem[];
    disclaimerText?: string | null;
    alwaysPageBreak?: boolean;
}

export interface SchemaData {
    schemaVersion?: number;
    sections: SchemaSection[];
    ratingSystem?: { levels: RatingLevel[] };
}
