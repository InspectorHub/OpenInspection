/**
 * A Home Inspector Pro template, converted to the v2 schema.
 *
 * ── What the file is ────────────────────────────────────────────────────────
 * A `.tpz` is a zip. The structure lives in one entry inside it, a
 * `java.beans.XMLDecoder` document, and everything else in the archive is
 * attachments this reader has no use for.
 *
 * ⚠️ READS, NEVER EXECUTES — see `../formats/java-xml-encoder.ts`. Nothing here
 * instantiates anything the document names.
 *
 * ── What twenty-two real templates taught this reader to refuse to assume ───
 *  · The rating vocabulary is USER-DEFINED. Three, four and five entries were
 *    seen, sharing no words, and eight of the twenty-two had none at all. So
 *    the vocabulary is reported rather than interpreted, and reported verbatim:
 *    real entries carry leading and trailing spaces, and trimming them hides
 *    from the person classifying them exactly the thing he is classifying.
 *  · `showRatings` was ABSENT far more often than present. Absent is null here,
 *    not false, because false is a statement the file did not make.
 *  · Twenty-one of the twenty-two carry NO version, and the Java versions of
 *    the ones that do span fifteen years. Nothing branches on a version.
 *  · Archives held between three and fifty-four entries, so NOTHING is required
 *    to be present except the structure file.
 *  · One of the twenty-two is EMPTY. An empty template converts to an empty
 *    template; it does not refuse the upload.
 *
 * ── Purity ──────────────────────────────────────────────────────────────────
 * Ids are derived from position, never minted, so the same bytes convert to the
 * same bundle and a re-map can be compared against what was staged.
 */

import type {
    TemplateSchemaV2, TemplateSection, TemplateItem,
} from '../../../types/template-schema';
import { DEFAULT_IMPORTED_RATING_OPTIONS, type ConvertStats } from '../bundle';
import {
    objectsOfClass, propertyBoolean, propertyStrings,
} from '../formats/java-xml-encoder';
import { readZipEntry } from '../formats/zip';
import type { AdapterInspection, BundleResult, MigrationAdapter } from './types';
import { emptyEntityCounts } from './types';

/** ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED. Our own adapter's version. */
const HIP_ADAPTER_VERSION = '1';

/**
 * The archive entry the structure lives in.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: FORMAT DISCRIMINATOR. The one name a reader
 * must know to open the file at all. Minimum necessary literal use — the reader
 * requires nothing else in the archive to be present or to be called anything.
 */
const STRUCTURE_ENTRY = 'TabbedPanes.tpl';

/**
 * The serialised class names and property names the structure is written under.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: FORMAT DISCRIMINATORS. These are the tokens a
 * reader must match to locate anything in a serialised object graph — the
 * format's own requirements, not the product's content. Class names are matched
 * on their LAST SEGMENT, so a package rename across versions does not turn a
 * full template into an empty one.
 */
const TOKENS = {
    sectionClass: 'SavedTabbedPane',
    itemClass: 'SavedPanel',
    sectionName: 'tabbedPaneName',
    itemName: 'panelName',
    templateName: 'templateName',
    ratings: 'ratingNames',
    ratingsShown: 'showRatings',
    /** The element a document of this format opens with, whatever wrote it. */
    documentRoot: '<java',
} as const;

/** The structure document, or nothing — this reader's only refusal. */
async function readStructure(input: unknown): Promise<string | null> {
    if (!(input instanceof Uint8Array)) return null;
    const entry = await readZipEntry(input, STRUCTURE_ENTRY);
    if (entry === null) return null;
    const xml = new TextDecoder().decode(entry);
    // A document that names no decoder is not this format however it was named.
    // Checked on the ELEMENT rather than on any product string, so a template
    // written by a different tool in the same format still reads.
    return xml.includes(TOKENS.documentRoot) ? xml : null;
}

/** The template's own name, or null where the file carries none. */
function templateName(xml: string): string | null {
    const [name] = propertyStrings(xml, TOKENS.templateName);
    return name && name.trim() !== '' ? name : null;
}

interface Structure {
    sections: { title: string; items: string[] }[];
    ratings: string[];
    ratingsShown: boolean | null;
    name: string | null;
}

/**
 * The whole structure, read once.
 *
 * Shared by `inspect` and `convert` so the two cannot come to disagree about
 * what the file holds — and they would disagree silently, because each has its
 * own tests.
 */
function readTemplate(xml: string): Structure {
    return {
        name: templateName(xml),
        ratings: propertyStrings(xml, TOKENS.ratings),
        ratingsShown: propertyBoolean(xml, TOKENS.ratingsShown),
        sections: objectsOfClass(xml, TOKENS.sectionClass).map((section) => ({
            title: propertyStrings(section, TOKENS.sectionName)[0] ?? '',
            items: objectsOfClass(section, TOKENS.itemClass)
                .map((item) => propertyStrings(item, TOKENS.itemName)[0] ?? ''),
        })),
    };
}

/** What the caller must supply that the file does not contain. */
export interface HomeInspectorProOptions {
    /** The name the imported template gets. The file's own name is a suggestion. */
    name: string;
}

function toSchema(structure: Structure): { schema: TemplateSchemaV2; stats: ConvertStats } {
    const stats: ConvertStats = {
        sections: 0, items: 0,
        information: 0, limitations: 0, defects: 0,
        unknownCommentTypes: [],
    };
    // The operator's OWN words where the file has them. Replacing them with a
    // default would throw away the one thing the mapping step exists to ask
    // about; ours are the fallback for the eight-in-twenty-two that have none.
    const ratingOptions = structure.ratings.length > 0
        ? [...structure.ratings]
        : [...DEFAULT_IMPORTED_RATING_OPTIONS];

    const sections: TemplateSection[] = structure.sections.map((source, sectionIndex) => {
        stats.sections++;
        const items: TemplateItem[] = source.items.map((label, itemIndex) => {
            stats.items++;
            return {
                id: `item_${sectionIndex + 1}_${itemIndex + 1}`,
                label: (label || 'Untitled item').slice(0, 100),
                type: 'rich',
                ratingOptions: [...ratingOptions],
                // This format carries no canned comments in the structure file,
                // so the tabs start empty rather than being invented.
                tabs: { information: [], limitations: [], defects: [] },
            };
        });
        return {
            id: `sec_${sectionIndex + 1}`,
            title: (source.title || 'Untitled section').slice(0, 50),
            items,
        };
    });
    return { schema: { schemaVersion: 2, sections }, stats };
}

/**
 * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED. Every string in this
 * object is ours — the adapter's own name, the vendor key this deployment files
 * these files under, and prose written here for the operator to read.
 */
export const homeInspectorProAdapter: MigrationAdapter<HomeInspectorProOptions> = {
    name: 'home-inspector-pro',
    version: HIP_ADAPTER_VERSION,
    vendor: 'home_inspector_pro',
    async inspect(input: unknown): Promise<AdapterInspection | null> {
        const xml = await readStructure(input);
        if (xml === null) return null;
        const structure = readTemplate(xml);
        return {
            kind: 'template',
            name: structure.name,
            sections: structure.sections.length,
            items: structure.sections.reduce((n, s) => n + s.items.length, 0),
            ratings: structure.ratings,
            ratingsShown: structure.ratingsShown,
        };
    },
    async convert(input: unknown, options: HomeInspectorProOptions): Promise<BundleResult> {
        const xml = await readStructure(input);
        if (xml === null) {
            return {
                ok: false,
                error: {
                    code: 'NOT_AN_EXPORT',
                    message: 'This file is not a Home Inspector Pro template. Send the .tpz file from '
                        + 'the Templates folder of its data directory.',
                },
            };
        }
        // An EMPTY template is converted, not refused. One real template in
        // twenty-two is empty, and refusing it would tell an operator his own
        // file is wrong. It stages as a row the repair step calls out instead.
        const { schema, stats } = toSchema(readTemplate(xml));
        return {
            ok: true,
            bundle: {
                formatVersion: 1,
                manifest: {
                    source: { vendor: 'home_inspector_pro' },
                    adapter: { name: 'home-inspector-pro', version: HIP_ADAPTER_VERSION },
                    counts: {
                        template: { readFromSource: 1, emitted: 1, dropped: [] },
                        contact: emptyEntityCounts(),
                        member: emptyEntityCounts(),
                    },
                    warnings: [],
                },
                templates: [{ name: options.name, schema, stats }],
                contacts: [],
                members: [],
            },
        };
    },
};
