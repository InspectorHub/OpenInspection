// Phase W spike: GO — docx@9.7.1 verified on workerd <2026-07-12>
// Commercial PCA Phase W (#186) — pure payload -> .docx builder. Server-only:
// pulls in `docx`, so MUST NOT be imported by app/. Emits the Phase S canonical
// section order; tier-gated (Phase T); headings carry the Phase O outline ids so
// the native Word TOC field + document outline mirror the HTML/PDF.
import {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    Table, TableRow, TableCell, WidthType, TableOfContents, ImageRun,
} from 'docx';
import type { ReportOutlineEntry } from './report-outline'; // Phase O registry type

export interface DocxSignatory { name: string; title: string }

/** Commercial PCA Phase F — Building Profile row, grouped two-column display. */
export interface DocxProfileRow {
    id?: string;
    label: string;
    value: string | number | null;
    unit?: string | null;
    group?: string;
}

/** A single narrative bullet under a section (rating + free-text observation). */
export interface DocxSectionItem {
    label: string;
    ratingLabel?: string;
    narrative?: string;
}

/** Phase S Deviations sub-table row. */
export interface DocxDeviationRow {
    area: string;
    description: string;
}

/** §1-§10 narrative section — heading level mirrors the Phase O outline entry. */
export interface DocxSection {
    id: string;
    level: number;
    title: string;
    body?: string;
    items?: DocxSectionItem[];
    deviations?: DocxDeviationRow[];
}

/** Commercial PCA Phase C — TABLE 1 (Deferred Maintenance / Opinion of Cost) line. */
export interface DocxCostLine {
    system: string;
    description: string;
    bucket: 'immediate' | 'short_term' | 'long_term';
    quantity?: number | null;
    unitCostCents?: number | null;
    totalCents: number;
}

/** Commercial PCA Phase C — TABLE 2 (Capital Replacement Reserve Schedule) row.
 *  One item placed in a single reserve year (`placementYear`). */
export interface DocxReserveScheduleRow {
    system: string;
    description: string;
    placementYear: number;
    replacementCents: number;
}

/** TABLE 2 — full Capital Replacement Reserve Schedule: the shared year grid,
 *  the per-item placement rows, and the per-year + total + Per-SF summary
 *  metrics. Mirrors the HTML report's CostTables reserve grid (server/lib/
 *  pca-costs.ts ReserveSchedule). Per-SF values are null when building area is
 *  unknown; those rows are then omitted. */
export interface DocxReserveSchedule {
    years: number[];
    rows: DocxReserveScheduleRow[];
    uninflatedByYear: number[];
    cumulativeInflatedByYear: number[];
    totalUninflatedCents: number;
    totalInflatedCents: number;
    perSfUninflatedAllYears: number | null;
    perSfInflatedAllYears: number | null;
    perSfInflatedPerYear: number | null;
}

export interface DocxCostTables {
    table1: DocxCostLine[];
    /** Opt-in (tenant Reserve Schedule config); TABLE 2 renders only when non-null. */
    reserveSchedule: DocxReserveSchedule | null;
}

/**
 * Commercial PCA Phase P — Appendix B photo. The builder is pure: it receives
 * ALREADY-FETCHED, ALREADY-DOWNSCALED bytes (the consumer does the R2 fetch +
 * resize). `type` selects the docx `ImageRun` codec; defaults to `jpg` (the
 * common R2-stored photo format) when omitted.
 */
export interface DocxAppendixPhoto {
    photoNo: string;
    caption?: string;
    bytes: Uint8Array;
    widthPx: number;
    heightPx: number;
    type?: 'jpg' | 'png' | 'gif' | 'bmp';
}

export interface ReportDocxInput {
    inspection: { propertyAddress?: string | null; companyName?: string | null };
    tier: 'light_commercial' | 'full_pca';
    outline: ReportOutlineEntry[];
    transmittal: { body: string } | null;
    signatures: { fieldObserver?: DocxSignatory; reviewer?: DocxSignatory } | null;
    systemsSummary: Array<{ system: string; condition: string; priority: string }>;
    buildingProfile: DocxProfileRow[];
    sections: DocxSection[];
    costTables: DocxCostTables | null;
    appendixPhotos: DocxAppendixPhoto[];
}

const isLight = (input: ReportDocxInput) => input.tier === 'light_commercial';

function buildCover(input: ReportDocxInput): Paragraph[] {
    return [
        new Paragraph({ text: input.inspection.companyName ?? '', heading: HeadingLevel.TITLE }),
        new Paragraph({ children: [new TextRun(input.inspection.propertyAddress ?? '')] }),
    ];
}

function buildToc(): TableOfContents {
    // Native Word TOC field — Word computes page numbers on open (no measurement).
    return new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' });
}

function buildTransmittal(input: ReportDocxInput): Paragraph[] {
    if (isLight(input) || !input.transmittal) return []; // tier gate: light skips Transmittal
    const out = [new Paragraph({ text: 'Transmittal Letter', heading: HeadingLevel.HEADING_1 })];
    out.push(new Paragraph(input.transmittal.body));
    for (const sig of [input.signatures?.fieldObserver, input.signatures?.reviewer]) {
        if (!sig) continue;
        out.push(new Paragraph({ children: [new TextRun({ text: '\n_____________________' })] }));
        out.push(new Paragraph(`${sig.name}, ${sig.title}`));
    }
    return out;
}

function buildSystemsSummary(input: ReportDocxInput): Table | Paragraph[] {
    if (isLight(input)) return []; // tier gate: light skips the Systems Summary matrix
    const header = new TableRow({
        children: ['System', 'Condition', 'Priority'].map(
            (t) => new TableCell({ children: [new Paragraph(t)] }),
        ),
    });
    const rows = input.systemsSummary.map((r) => new TableRow({
        children: [r.system, r.condition, r.priority].map(
            (v) => new TableCell({ children: [new Paragraph(String(v))] }),
        ),
    }));
    return new Table({ rows: [header, ...rows], width: { size: 100, type: WidthType.PERCENTAGE } });
}

/** Grouped two-column Table: group header row (spanning both columns), then label/value rows. */
function buildBuildingProfile(rows: DocxProfileRow[]): Array<Paragraph | Table> {
    if (rows.length === 0) return [];
    const groups = new Map<string, DocxProfileRow[]>();
    for (const row of rows) {
        const group = row.group ?? 'General';
        const arr = groups.get(group) ?? [];
        arr.push(row);
        groups.set(group, arr);
    }
    const tableRows: TableRow[] = [];
    for (const [group, groupRows] of groups) {
        tableRows.push(new TableRow({
            children: [new TableCell({
                columnSpan: 2,
                children: [new Paragraph({ children: [new TextRun({ text: group, bold: true })] })],
            })],
        }));
        for (const row of groupRows) {
            const valueText = row.value === null || row.value === undefined
                ? ''
                : `${row.value}${row.unit ? ` ${row.unit}` : ''}`;
            tableRows.push(new TableRow({
                children: [
                    new TableCell({ children: [new Paragraph(row.label)] }),
                    new TableCell({ children: [new Paragraph(valueText)] }),
                ],
            }));
        }
    }
    return [
        new Paragraph({ text: 'Building Profile', heading: HeadingLevel.HEADING_1 }),
        new Table({ rows: tableRows, width: { size: 100, type: WidthType.PERCENTAGE } }),
    ];
}

/** Deviations render as a two-column sub-Table (Area / Description). */
function buildDeviationsTable(rows: DocxDeviationRow[]): Table {
    const header = new TableRow({
        children: ['Area', 'Description'].map((t) => new TableCell({ children: [new Paragraph(t)] })),
    });
    const body = rows.map((d) => new TableRow({
        children: [d.area, d.description].map((v) => new TableCell({ children: [new Paragraph(v)] })),
    }));
    return new Table({ rows: [header, ...body], width: { size: 100, type: WidthType.PERCENTAGE } });
}

/**
 * §1-§10 narrative sections, in the order the caller supplies them (the
 * caller threads them in Phase O `outline` order). Heading depth mirrors
 * `level` (1 -> HEADING_1, 2+ -> HEADING_2). A section with no body, items,
 * or deviations emits nothing (not even a bare heading).
 */
function buildSections(sections: DocxSection[]): Array<Paragraph | Table> {
    const out: Array<Paragraph | Table> = [];
    for (const section of sections) {
        const hasBody = Boolean(section.body?.trim());
        const hasItems = (section.items?.length ?? 0) > 0;
        const hasDeviations = (section.deviations?.length ?? 0) > 0;
        if (!hasBody && !hasItems && !hasDeviations) continue; // empty sections emit nothing

        const heading = section.level <= 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2;
        out.push(new Paragraph({ text: section.title, heading }));
        if (hasBody) out.push(new Paragraph(section.body as string));
        for (const item of section.items ?? []) {
            const bits = [item.label, item.ratingLabel, item.narrative].filter(Boolean).join(' — ');
            out.push(new Paragraph(bits));
        }
        if (hasDeviations) out.push(buildDeviationsTable(section.deviations as DocxDeviationRow[]));
    }
    return out;
}

const BUCKET_LABEL: Record<DocxCostLine['bucket'], string> = {
    immediate: 'Immediate',
    short_term: 'Short-Term',
    long_term: 'Long-Term',
};

/** Integer cents -> `$1,234.56`. Locale-independent (no Intl dependency). */
function formatCents(cents: number): string {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.round(Math.abs(cents));
    const whole = Math.floor(abs / 100);
    const frac = String(abs % 100).padStart(2, '0');
    const withCommas = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${sign}$${withCommas}.${frac}`;
}

/** TABLE 1 — Deferred Maintenance / Opinion of Cost (Immediate + Short-Term lines). */
function buildTable1(lines: DocxCostLine[]): Array<Paragraph | Table> {
    const header = new TableRow({
        children: ['System', 'Description', 'Priority', 'Total'].map(
            (t) => new TableCell({ children: [new Paragraph(t)] }),
        ),
    });
    const rows = lines
        .filter((l) => l.bucket === 'immediate' || l.bucket === 'short_term')
        .map((l) => new TableRow({
            children: [l.system, l.description, BUCKET_LABEL[l.bucket], formatCents(l.totalCents)].map(
                (v) => new TableCell({ children: [new Paragraph(v)] }),
            ),
        }));
    return [
        new Paragraph({ text: 'TABLE 1 — Deferred Maintenance / Opinion of Cost', heading: HeadingLevel.HEADING_2 }),
        new Table({ rows: [header, ...rows], width: { size: 100, type: WidthType.PERCENTAGE } }),
    ];
}

/**
 * TABLE 2 — Capital Replacement Reserve Schedule. One shared year grid across
 * all rows: each item's replacement cost lands in its placement-year column
 * (empty in the others), with a per-item Total. The tfoot mirrors the HTML
 * report (CostTables.tsx): a "Total Uninflated" row (per-year uninflated + the
 * grand total), a "Cumulative Inflated" row (running inflated totals), and up
 * to three Per-SF summary rows — each rendered ONLY when its value is non-null
 * (null => building area unknown). Every row emits the same number of cells as
 * the header (a docx table requires a consistent column count per row).
 */
function buildTable2(schedule: DocxReserveSchedule): Array<Paragraph | Table> {
    const { years } = schedule;
    const textRow = (cells: string[]): TableRow => new TableRow({
        children: cells.map((v) => new TableCell({ children: [new Paragraph(v)] })),
    });

    const header = textRow(['System', 'Description', ...years.map(String), 'Total']);

    const body = schedule.rows.map((r) => {
        const yearCells = years.map((y) => (y === r.placementYear ? formatCents(r.replacementCents) : ''));
        return textRow([r.system, r.description, ...yearCells, formatCents(r.replacementCents)]);
    });

    const footer: TableRow[] = [
        textRow([
            'Total Uninflated', '',
            ...years.map((_y, i) => formatCents(schedule.uninflatedByYear[i] ?? 0)),
            formatCents(schedule.totalUninflatedCents),
        ]),
        textRow([
            'Cumulative Inflated', '',
            ...years.map((_y, i) => formatCents(schedule.cumulativeInflatedByYear[i] ?? 0)),
            formatCents(schedule.totalInflatedCents),
        ]),
    ];
    // Per-SF summary rows — label in the System cell, formatted value in the
    // Total cell, intervening cells blank so the column count matches the
    // header. Rendered only when the corresponding metric is non-null.
    const perSfRows: Array<[string, number | null]> = [
        ['Per-SF (Uninflated, all years)', schedule.perSfUninflatedAllYears],
        ['Per-SF (Inflated, all years)', schedule.perSfInflatedAllYears],
        ['Per-SF (Inflated, per year)', schedule.perSfInflatedPerYear],
    ];
    for (const [label, value] of perSfRows) {
        if (value === null) continue;
        footer.push(textRow([label, '', ...years.map(() => ''), formatCents(value)]));
    }

    return [
        new Paragraph({ text: 'TABLE 2 — Capital Replacement Reserve Schedule', heading: HeadingLevel.HEADING_2 }),
        new Table({ rows: [header, ...body, ...footer], width: { size: 100, type: WidthType.PERCENTAGE } }),
    ];
}

/**
 * TABLE 1 always renders when `costTables` is present; TABLE 2 (the Reserve
 * Schedule) only when `reserveSchedule` is non-null (tenant opt-in). Money is
 * formatted from integer cents. `[]` when `costTables` is null (light tier
 * with no cost items, or a report with no cost data at all).
 */
function buildCostTables(costTables: DocxCostTables | null): Array<Paragraph | Table> {
    if (!costTables) return [];
    return [
        ...buildTable1(costTables.table1),
        ...(costTables.reserveSchedule ? buildTable2(costTables.reserveSchedule) : []),
    ];
}

// Bound each embedded appendix photo's rendered width to this many px so the
// generated .docx stays a reasonable print-thumbnail size regardless of the
// source resolution (the consumer already downscales the source bytes; this
// is the *display* transformation docx writes into the drawing XML).
const PRINT_THUMB_WIDTH_PX = 480;

function scaledDimensions(widthPx: number, heightPx: number): { width: number; height: number } {
    if (widthPx <= PRINT_THUMB_WIDTH_PX || widthPx <= 0) return { width: widthPx, height: heightPx };
    const ratio = PRINT_THUMB_WIDTH_PX / widthPx;
    return { width: PRINT_THUMB_WIDTH_PX, height: Math.round(heightPx * ratio) };
}

/**
 * Appendix B — Photographs. `[]` for light_commercial (light uses inline
 * photos, out of Phase W scope — the consumer passes `appendixPhotos: []`)
 * or when there are no photos. Each photo emits one bounded `ImageRun` plus
 * its `PHOTO NO.` caption paragraph, in the order supplied.
 */
function buildAppendixPhotos(input: ReportDocxInput): Paragraph[] {
    if (isLight(input) || input.appendixPhotos.length === 0) return [];
    const out: Paragraph[] = [new Paragraph({ text: 'Appendix B — Photographs', heading: HeadingLevel.HEADING_1 })];
    for (const photo of input.appendixPhotos) {
        const { width, height } = scaledDimensions(photo.widthPx, photo.heightPx);
        out.push(new Paragraph({
            children: [new ImageRun({
                type: photo.type ?? 'jpg',
                data: photo.bytes,
                transformation: { width, height },
            })],
        }));
        const captionText = photo.caption ? `PHOTO NO. ${photo.photoNo} — ${photo.caption}` : `PHOTO NO. ${photo.photoNo}`;
        out.push(new Paragraph(captionText));
    }
    return out;
}

export async function buildReportDocx(input: ReportDocxInput): Promise<Uint8Array> {
    const summary = buildSystemsSummary(input);
    const children = [
        ...buildCover(input),
        ...buildBuildingProfile(input.buildingProfile),
        buildToc(),
        ...buildTransmittal(input),
        ...(Array.isArray(summary) ? summary : [summary]),
        ...buildSections(input.sections),
        ...buildCostTables(input.costTables),
        ...buildAppendixPhotos(input),
    ];
    const doc = new Document({ features: { updateFields: true }, sections: [{ children }] });
    const buf = await Packer.toBuffer(doc);
    return new Uint8Array(buf);
}
