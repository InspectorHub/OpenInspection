/**
 * The Spectora export button's file, converted to the v2 schema.
 *
 * ── What the export actually is ─────────────────────────────────────────────
 * A spreadsheet. One row per canned comment, 42 columns wide, with the section
 * and the item repeated on every row — so the structure is implied by repeated
 * values rather than nested. A real export measured 1873 rows: one header and
 * 1872 comments, resolving to 16 sections and 76 items.
 *
 * This adapter used to read a JSON object with a `sections` array and describe
 * a four-bucket comment model. That representation exists, but it is not what
 * the export button produces, and the four buckets are not what the file marks:
 * every row carries `info`, `limit` or `defect`, which are already our three
 * comment tabs. The mapping that was made complicated is the identity. The JSON
 * reader that served the retired paste endpoint is gone with it; a file in that
 * shape now arrives through the same upload the export button's file does.
 *
 * ── Purity ──────────────────────────────────────────────────────────────────
 * Ids are derived from a row's POSITION in the file, never minted. The same
 * bytes therefore convert to the same bundle, which is what lets a re-map
 * re-read a stored file and compare the result against what was staged.
 */

import type {
    TemplateSchemaV2, TemplateSection, TemplateItem,
    CannedInfoComment, CannedDefect,
} from '../../../types/template-schema';
import {
    DEFAULT_IMPORTED_DEFECT_CATEGORY,
    DEFAULT_IMPORTED_RATING_OPTIONS,
    type ConvertStats,
} from '../bundle';
import { readXlsxSheet } from '../formats/xlsx-sheet';
import type { AdapterInspection, BundleResult, MigrationAdapter } from './types';
import { emptyEntityCounts } from './types';

/** ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED. Our own adapter's version. */
const SPECTORA_ADAPTER_VERSION = '2';

/**
 * The column headings that identify this file as this product's export.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: FORMAT DISCRIMINATOR. These are the strings a
 * reader must match to recognise the format at all. Minimum necessary literal
 * use — the list stops at what identifies the format and does not continue into
 * the product's own section, item or comment vocabulary, which is theirs.
 * Matched case-insensitively on the PREFIX, because several headings continue
 * into a parenthesised note.
 */
const REQUIRED_HEADERS = ['section name', 'item name', 'comment name', 'comment text'];

/**
 * ⚠️ LITERAL-USE CLASSIFICATION: FORMAT DISCRIMINATOR. The heading of the
 * column holding the value below; a prefix, because the real heading continues
 * into a parenthesised list of its own values.
 */
const COMMENT_TYPE_HEADER = 'comment type';

/**
 * The comment-type column's values.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: REQUIRED ENUM. Three short functional tokens
 * the parser must match to do anything at all. They happen to be our own three
 * tabs, so the mapping below is the identity — a coincidence of the format,
 * not a taxonomy taken from it.
 */
const COMMENT_TYPES = ['info', 'limit', 'defect'] as const;
type CommentType = typeof COMMENT_TYPES[number];

/**
 * Which of our tabs each of those values names. The identity, spelled out.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED on the right-hand side
 * — `information`, `limitations` and `defects` are OUR tab names. That they
 * line up one-to-one with the column's values is a coincidence of the format.
 */
const TAB_FOR_COMMENT_TYPE: Record<CommentType, 'information' | 'limitations' | 'defects'> = {
    info: 'information',
    limit: 'limitations',
    defect: 'defects',
};

/** Where each thing this reader needs sits in the header row. */
interface SheetColumns {
    section: number;
    item: number;
    commentName: number;
    commentText: number;
    /** -1 when the export omits the column entirely — every row then reads untyped. */
    commentType: number;
}

/**
 * The workbook as this reader understands it, or why it does not.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED — our own refusal
 * codes, which the operator never sees; the sentences they map to are below.
 */
type SpectoraSheet =
    | { ok: true; rows: string[][]; columns: SheetColumns }
    | { ok: false; code: 'NOT_AN_EXPORT' | 'NO_SECTIONS' };

/** The index of the first heading starting with `prefix`, or -1. */
function headerIndex(header: string[], prefix: string): number {
    return header.findIndex((cell) => cell.startsWith(prefix));
}

/**
 * The bytes as this export, or why they are not it.
 *
 * ONE shape test, shared by `inspect` and `convert`. `inspect` throws the
 * reason away and answers null; `convert` turns it into the sentence the
 * operator reads. A second copy of this test is how the two come to disagree
 * about what this product's file is — silently, because each has its own tests.
 */
async function readSpectoraWorkbook(input: unknown): Promise<SpectoraSheet> {
    if (!(input instanceof Uint8Array)) return { ok: false, code: 'NOT_AN_EXPORT' };
    const rows = await readXlsxSheet(input);
    if (rows === null || rows.length === 0) return { ok: false, code: 'NOT_AN_EXPORT' };
    const header = rows[0]!.map((cell) => cell.trim().toLowerCase());
    if (!REQUIRED_HEADERS.every((h) => header.some((cell) => cell.startsWith(h)))) {
        return { ok: false, code: 'NOT_AN_EXPORT' };
    }
    const body = rows.slice(1).filter((row) => row.some((cell) => cell.trim() !== ''));
    if (body.length === 0) return { ok: false, code: 'NO_SECTIONS' };
    return {
        ok: true,
        rows: body,
        columns: {
            section: headerIndex(header, REQUIRED_HEADERS[0]!),
            item: headerIndex(header, REQUIRED_HEADERS[1]!),
            commentName: headerIndex(header, REQUIRED_HEADERS[2]!),
            commentText: headerIndex(header, REQUIRED_HEADERS[3]!),
            commentType: headerIndex(header, COMMENT_TYPE_HEADER),
        },
    };
}

function at(row: string[], column: number): string {
    return column < 0 ? '' : (row[column] ?? '').trim();
}

/** A comment whose type column said nothing this reader knows. */
interface UntypedComment {
    /** Where in the file, so the operator can find it. */
    at: string;
    name: string;
    /** What the cell held, verbatim. Empty when it held nothing. */
    said: string;
}

interface BuiltTemplate {
    template: TemplateSchemaV2;
    stats: ConvertStats;
    untyped: UntypedComment[];
}

/**
 * Rows to sections and items, in the file's own order.
 *
 * Order is the file's because the export repeats the section and item on every
 * row, so first appearance is the only ordering the file expresses — and an
 * inspector recognises his own template by its running order.
 */
function buildTemplate(sheet: Extract<SpectoraSheet, { ok: true }>): BuiltTemplate {
    const stats: ConvertStats = {
        sections: 0, items: 0,
        information: 0, limitations: 0, defects: 0,
        unknownCommentTypes: [],
    };
    const untyped: UntypedComment[] = [];
    const sections: TemplateSection[] = [];
    const sectionByTitle = new Map<string, TemplateSection>();
    const itemByKey = new Map<string, TemplateItem>();

    sheet.rows.forEach((row, index) => {
        // `+2` puts the number back in the operator's frame: the header is row
        // one and this list starts after it. A location that does not match
        // what the spreadsheet shows is worse than no location.
        const where = `row ${index + 2}`;
        const sectionTitle = at(row, sheet.columns.section);
        const itemLabel = at(row, sheet.columns.item);
        if (!sectionTitle || !itemLabel) return;

        let section = sectionByTitle.get(sectionTitle);
        if (!section) {
            stats.sections++;
            section = { id: `sec_${stats.sections}`, title: sectionTitle.slice(0, 50), items: [] };
            sectionByTitle.set(sectionTitle, section);
            sections.push(section);
        }

        const itemKey = `${sectionTitle}\u0000${itemLabel}`;
        let item = itemByKey.get(itemKey);
        if (!item) {
            stats.items++;
            item = {
                id: `item_${stats.items}`,
                label: itemLabel.slice(0, 100),
                type: 'rich',
                ratingOptions: [...DEFAULT_IMPORTED_RATING_OPTIONS],
                tabs: { information: [], limitations: [], defects: [] },
            };
            itemByKey.set(itemKey, item);
            section.items.push(item);
        }

        const name = at(row, sheet.columns.commentName);
        const text = at(row, sheet.columns.commentText);
        if (!name && !text) return;

        const said = at(row, sheet.columns.commentType).toLowerCase();
        const type = (COMMENT_TYPES as readonly string[]).includes(said)
            ? (said as CommentType)
            : null;
        if (type === null) {
            untyped.push({ at: where, name: name || text.slice(0, 40), said });
            if (said && !stats.unknownCommentTypes.includes(said)) {
                stats.unknownCommentTypes.push(said);
            }
        }

        // An untyped comment is KEPT, under information, because a dropped row
        // cannot be repaired and nothing left would say which one went. It is
        // named in the manifest's warnings instead.
        const tab = TAB_FOR_COMMENT_TYPE[type ?? 'info'];
        const tabs = item.tabs!;
        const id = `${tab === 'defects' ? 'rd' : 'ri'}_${index + 1}`;
        if (tab === 'defects') {
            stats.defects++;
            const defect: CannedDefect = {
                id, title: name || 'Defect', category: DEFAULT_IMPORTED_DEFECT_CATEGORY,
                location: '', comment: text, photos: [], default: false,
            };
            tabs.defects.push(defect);
        } else {
            const entry: CannedInfoComment = {
                id, title: name || 'Comment', comment: text, default: false,
            };
            if (tab === 'limitations') {
                stats.limitations++;
                tabs.limitations.push(entry);
            } else {
                stats.information++;
                tabs.information.push(entry);
            }
        }
    });

    return { template: { schemaVersion: 2, sections }, stats, untyped };
}

/** What the caller must supply that the file does not contain. */
export interface SpectoraAdapterOptions {
    /** The name the imported template gets. The file carries none of its own. */
    name: string;
}

/**
 * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED. Prose written here
 * for the operator to read, and our own refusal codes. Nothing in it is
 * reproduced from any product's own text.
 */
const REFUSALS: Record<'NOT_AN_EXPORT' | 'NO_SECTIONS', string> = {
    NOT_AN_EXPORT:
        'This file is not a Spectora template export. In Spectora, open the template and use its '
        + 'export button, then upload the spreadsheet it downloads.',
    NO_SECTIONS:
        'This export has its column headings and no comment rows, so there is no template '
        + 'structure to import. Export the template itself rather than an empty one.',
};

/**
 * The Spectora entry into the normalised format.
 *
 * Both halves are async because reading the file means decompressing it, and
 * decompression on this platform is a stream. That is why the adapter contract
 * allows a promise on either method.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED. Every string in this
 * object is ours — the adapter's own name, the vendor key this deployment files
 * these files under, and prose written here for the operator to read.
 */
export const spectoraAdapter: MigrationAdapter<SpectoraAdapterOptions> = {
    name: 'spectora',
    version: SPECTORA_ADAPTER_VERSION,
    vendor: 'spectora',
    /**
     * What this export says about itself, before converting it.
     *
     * The vocabulary it reports is the comment-type column's, which is the only
     * vocabulary the file has. The wizard offers the identity mapping from it
     * rather than asking the operator to re-derive a fact about his own file.
     */
    async inspect(input: unknown): Promise<AdapterInspection | null> {
        const read = await readSpectoraWorkbook(input);
        if (!read.ok) return null;
        const sections = new Set<string>();
        const items = new Set<string>();
        for (const row of read.rows) {
            const section = at(row, read.columns.section);
            const item = at(row, read.columns.item);
            if (section) sections.add(section);
            if (section && item) items.add(`${section}\u0000${item}`);
        }
        return {
            kind: 'template',
            // This export carries no template name of its own — the caller's
            // filename is the fallback, and that decision is the caller's.
            name: null,
            sections: sections.size,
            items: items.size,
            ratings: [...COMMENT_TYPES],
            // These words file COMMENTS, not items. They are already this
            // product's three comment tabs, so the mapping is the identity and
            // there is nothing to ask — the wizard reads this and skips the
            // question rather than making an inspector re-derive a fact about
            // his own file.
            ratingsDescribe: 'comments',
            // The format has no such property, and saying `false` would assert
            // something it did not say.
            ratingsShown: null,
        };
    },
    async convert(input: unknown, options: SpectoraAdapterOptions): Promise<BundleResult> {
        const read = await readSpectoraWorkbook(input);
        if (!read.ok) {
            return { ok: false, error: { code: read.code, message: REFUSALS[read.code] } };
        }
        const { template, stats, untyped } = buildTemplate(read);
        return {
            ok: true,
            bundle: {
                formatVersion: 1,
                manifest: {
                    source: { vendor: 'spectora' },
                    adapter: { name: 'spectora', version: SPECTORA_ADAPTER_VERSION },
                    counts: {
                        template: { readFromSource: 1, emitted: 1, dropped: [] },
                        contact: emptyEntityCounts(),
                        member: emptyEntityCounts(),
                    },
                    // Each untyped comment is NAMED. A count would tell the
                    // operator that 65 of 1872 comments need attention without
                    // telling them which 65, and the file is too long to find
                    // them by reading.
                    warnings: untyped.map((comment) => ({
                        code: 'COMMENT_TYPE_NOT_READ',
                        message: comment.said
                            ? `"${comment.name}" (${comment.at}) is marked "${comment.said}", which this reader `
                                + 'does not know. It was kept under Information — move it in the editor.'
                            : `"${comment.name}" (${comment.at}) has no comment type. It was kept under `
                                + 'Information — move it in the editor.',
                    })),
                },
                templates: [{ name: options.name, schema: template, stats }],
                contacts: [],
                members: [],
            },
        };
    },
};
