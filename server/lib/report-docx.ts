// Phase W spike: GO — docx@9.7.1 verified on workerd <2026-07-12>
// Commercial PCA Phase W (#186) — pure payload -> .docx builder. Server-only:
// pulls in `docx`, so MUST NOT be imported by app/. Emits the Phase S canonical
// section order; tier-gated (Phase T); headings carry the Phase O outline ids so
// the native Word TOC field + document outline mirror the HTML/PDF.
import {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    Table, TableRow, TableCell, WidthType, TableOfContents,
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

export interface ReportDocxInput {
    inspection: { propertyAddress?: string | null; companyName?: string | null };
    tier: 'light_commercial' | 'full_pca';
    outline: ReportOutlineEntry[];
    transmittal: { body: string } | null;
    signatures: { fieldObserver?: DocxSignatory; reviewer?: DocxSignatory } | null;
    systemsSummary: Array<{ system: string; condition: string; priority: string }>;
    buildingProfile: DocxProfileRow[];
    sections: DocxSection[];
    // wired in Tasks 3b-3c:
    costTables: unknown | null;
    appendixPhotos: unknown[];
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

export async function buildReportDocx(input: ReportDocxInput): Promise<Uint8Array> {
    const summary = buildSystemsSummary(input);
    const children = [
        ...buildCover(input),
        ...buildBuildingProfile(input.buildingProfile),
        buildToc(),
        ...buildTransmittal(input),
        ...(Array.isArray(summary) ? summary : [summary]),
        ...buildSections(input.sections),
        // Task 3b-3c append cost tables and appendices here in canonical order.
    ];
    const doc = new Document({ features: { updateFields: true }, sections: [{ children }] });
    const buf = await Packer.toBuffer(doc);
    return new Uint8Array(buf);
}
