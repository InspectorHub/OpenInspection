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
 * Re-measured against the corpus on 2026-08-24. Three of the five claims below
 * had numbers attached that did not survive; the numbers are now the measured
 * ones and the two that were simply wrong are marked. See
 * `tests/fixtures/intake/manifest.json`, which records each against a hash.
 *  · The rating vocabulary is USER-DEFINED — thirty-three distinct words across
 *    the corpus, and a bare majority of template pairs share not one of them.
 *    So the vocabulary is reported rather than interpreted, and reported
 *    verbatim: real entries carry leading and trailing spaces, and trimming
 *    them hides from the person classifying them exactly the thing he is
 *    classifying. ⚠️ Every template declares exactly FIVE entries, not the
 *    "three, four and five" this comment used to claim, and NONE of the
 *    twenty-two is without one — so the fallback below is a path no real file
 *    has ever taken. Keep it; do not mistake its green tests for evidence.
 *  · `showRatings` is ABSENT more often than present — thirteen against nine.
 *    Absent is null here, not false, because false is a statement the file did
 *    not make. ⚠️ Two things follow that this comment used to miss: where the
 *    flag IS present it is false in every case and true in none, so nothing
 *    downstream of "ratings shown" has been driven by a real file; and one more
 *    template supplies it as an object REFERENCE, which this reader reports as
 *    absent because resolving it would mean executing the graph. Three states,
 *    not two.
 *  · ⚠️ NOT twenty-one of twenty-two carrying no version. There are two things
 *    here that can be called a version: the attribute the document opens with,
 *    carried by all twenty-two and spanning about fifteen years, and a property
 *    inside the graph, absent on nine. Nothing branches on either — which is
 *    exactly how a number nobody read stayed wrong.
 *  · Archives held between three and fifty-four entries, so NOTHING is required
 *    to be present except the structure file.
 *  · One of the twenty-two is EMPTY. An empty template converts to an empty
 *    template; it does not refuse the upload. It still carries a full
 *    vocabulary, so empty template does not mean empty document.
 *
 * ── Purity ──────────────────────────────────────────────────────────────────
 * Ids are derived from position, never minted, so the same bytes convert to the
 * same bundle and a re-map can be compared against what was staged.
 */

import type {
    TemplateSchemaV2, TemplateSection, TemplateItem,
} from '../../../types/template-schema';
import {
    DEFAULT_IMPORTED_RATING_OPTIONS,
    type ConvertStats,
    type TemplateRatingKind,
} from '../bundle';
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
    /**
     * What the operator said this template's rating words mean.
     *
     * REQUIRED, and it has no default here. The file's vocabulary is
     * user-defined and unknowable from the bytes, so an adapter that picked
     * one would be answering the mapping step's only question on the
     * operator's behalf — quietly, and wrongly for whichever kind of template
     * it did not pick.
     */
    ratingKind: TemplateRatingKind;
}

/**
 * The part of an item that the operator's answer decides.
 *
 * One function, so the three readings live together and a fourth cannot be
 * added to one adapter and forgotten in the next. The shapes are what each
 * answer MEANS in this schema: a severity scale is what a rated item's options
 * are; a record of what was found is a list of choices; and words that are not
 * ratings leave an item with nothing to pick from, so it takes prose.
 *
 * ⚠️ The three shapes are mutually exclusive by the template schema's own
 * rules — its item schemas are strict, and only a rated item may carry `tabs`
 * or `ratingOptions`. So an item cannot come out of here carrying two answers.
 */
function itemShapeFor(
    words: readonly string[],
    ratingKind: TemplateRatingKind,
): Pick<TemplateItem, 'type' | 'ratingOptions' | 'options' | 'tabs'> {
    // ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED — our own reading of
    // a vocabulary, one of `TEMPLATE_RATING_KINDS`. Nothing here is matched
    // against anything a file says; it is matched against an answer we asked for.
    if (ratingKind === 'choices') {
        // The operator's own words, verbatim. An empty vocabulary produces a
        // list with nothing in it rather than ours — "these record what you
        // found" said of a file with no words is a choice about a list that
        // does not exist, and inventing five is not what he asked for.
        return words.length > 0
            ? { type: 'select', options: { choices: [...words] } }
            : { type: 'select' };
    }
    // ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED — as above.
    if (ratingKind === 'none') return { type: 'textarea' };
    // The operator's OWN words where the file has them. Replacing them with a
    // default would throw away the one thing the mapping step exists to ask
    // about; ours are the fallback for the eight-in-twenty-two that have none,
    // and a rated item must carry at least one option to be valid at all.
    return {
        type: 'rich',
        ratingOptions: words.length > 0
            ? [...words]
            : [...DEFAULT_IMPORTED_RATING_OPTIONS],
        // This format carries no canned comments in the structure file, so the
        // tabs start empty rather than being invented.
        tabs: { information: [], limitations: [], defects: [] },
    };
}

function toSchema(
    structure: Structure,
    ratingKind: TemplateRatingKind,
): { schema: TemplateSchemaV2; stats: ConvertStats } {
    const stats: ConvertStats = {
        sections: 0, items: 0,
        information: 0, limitations: 0, defects: 0,
        unknownCommentTypes: [],
    };

    const sections: TemplateSection[] = structure.sections.map((source, sectionIndex) => {
        stats.sections++;
        const items: TemplateItem[] = source.items.map((label, itemIndex) => {
            stats.items++;
            return {
                id: `item_${sectionIndex + 1}_${itemIndex + 1}`,
                label: (label || 'Untitled item').slice(0, 100),
                ...itemShapeFor(structure.ratings, ratingKind),
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
            // These words rate ITEMS: an inspector picks one per item as he
            // works. What they mean is genuinely unknown here, which is why
            // the wizard asks rather than guessing.
            ratingsDescribe: 'items',
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
        const { schema, stats } = toSchema(readTemplate(xml), options.ratingKind);
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
