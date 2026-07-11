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

export interface ReportDocxInput {
    inspection: { propertyAddress?: string | null; companyName?: string | null };
    tier: 'light_commercial' | 'full_pca';
    outline: ReportOutlineEntry[];
    transmittal: { body: string } | null;
    signatures: { fieldObserver?: DocxSignatory; reviewer?: DocxSignatory } | null;
    systemsSummary: Array<{ system: string; condition: string; priority: string }>;
    // wired in Tasks 3a-3c:
    buildingProfile: unknown[];
    sections: unknown[];
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

export async function buildReportDocx(input: ReportDocxInput): Promise<Uint8Array> {
    const summary = buildSystemsSummary(input);
    const children = [
        ...buildCover(input),
        buildToc(),
        ...buildTransmittal(input),
        ...(Array.isArray(summary) ? summary : [summary]),
        // Tasks 3a-3c append Building Profile, S1-S10, cost tables, and
        // appendices here in canonical order.
    ];
    const doc = new Document({ features: { updateFields: true }, sections: [{ children }] });
    const buf = await Packer.toBuffer(doc);
    return new Uint8Array(buf);
}
