/**
 * Spectora → OpenInspection v2 schema converter.
 *
 * Best-effort translation of a Spectora template export into the strict
 * v2 schema. Spectora's per-item canned-comment model has four buckets
 * (INFORMATIONAL / SATISFACTORY / MONITOR / DEFECT) which we map onto
 * OpenInspection's three (information / limitations / defects):
 *
 * | Spectora        | v2 tab          | Defect category    |
 * |-----------------|-----------------|--------------------|
 * | INFORMATIONAL   | information     | —                  |
 * | SATISFACTORY    | information     | — (prefixed)       |
 * | MONITOR         | defects         | recommendation     |
 * | DEFECT          | defects         | safety             |
 *
 * Unknown comment kinds fall through to information so no data is
 * silently lost. Spectora identifiers are preserved on every level via
 * the v2 `source` field so re-imports can detect already-mapped rows.
 */

import type { TemplateSchemaV2, TemplateSection, TemplateItem, RatingLevel, CannedInfoComment, CannedDefect } from '../../../types/template-schema';
import type { ConvertStats } from '../bundle';
import type { AdapterInspection, BundleResult, MigrationAdapter } from './types';
import { emptyEntityCounts } from './types';

const SPECTORA_PLATFORM = 'spectora';

/** Subset of the Spectora export we actually consume. */
export interface SpectoraTemplate {
    id?: string;
    name?: string;
    sections?: SpectoraSection[];
    /** Custom rating levels defined at template level. */
    rating_levels?: SpectoraRatingLevel[];
    ratingLevels?: SpectoraRatingLevel[];
}

interface SpectoraRatingLevel {
    id?: string;
    name?: string;
    label?: string;
    abbreviation?: string;
    color?: string;
    is_defect?: boolean;
    isDefect?: boolean;
    default?: boolean;
    description?: string;
}

interface SpectoraSection {
    id?: string;
    name?: string;
    title?: string;
    identifier?: string;
    items?: SpectoraItem[];
    /** Legal text rendered at the bottom of the section in the published report. */
    disclaimer?: string;
    disclaimer_text?: string;
}

interface SpectoraItem {
    id?: string;
    name?: string;
    label?: string;
    /** Free-text description shown under the item label. */
    description?: string;
    comments?: SpectoraComment[];
}

type SpectoraCommentType = 'INFORMATIONAL' | 'SATISFACTORY' | 'MONITOR' | 'DEFECT' | string;

interface SpectoraComment {
    id?: string;
    type?: SpectoraCommentType;
    title?: string;
    text?: string;
    body?: string;
    default?: boolean;
    location?: string;
}

export interface ConvertResult {
    template: TemplateSchemaV2;
    /** Counts of source comments mapped into each v2 tab. Useful for surfacing import diffs. */
    stats: ConvertStats;
}

function freshId(prefix: string, externalId: string | undefined): string {
    if (externalId && externalId.trim()) return `${prefix}_${externalId.trim()}`;
    const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}_${random}`;
}

function pickText(c: SpectoraComment): string {
    return (c.text ?? c.body ?? '').toString();
}

function pickTitle(c: SpectoraComment, fallback: string): string {
    const t = (c.title ?? '').toString().trim();
    return t.length > 0 ? t : fallback;
}

function bucketComment(c: SpectoraComment, stats: ConvertResult['stats']):
    | { tab: 'information'; entry: CannedInfoComment }
    | { tab: 'limitations'; entry: CannedInfoComment }
    | { tab: 'defects'; entry: CannedDefect } {
    const externalId = c.id;
    const kind = (c.type ?? 'INFORMATIONAL').toString().toUpperCase();
    const def = !!c.default;
    const body = pickText(c);
    if (kind === 'INFORMATIONAL') {
        stats.information++;
        return { tab: 'information', entry: { id: freshId('ri', externalId), title: pickTitle(c, 'Information'), comment: body, default: def } };
    }
    if (kind === 'SATISFACTORY') {
        stats.information++;
        const title = pickTitle(c, 'Satisfactory');
        return { tab: 'information', entry: { id: freshId('ri', externalId), title: `Satisfactory · ${title}`, comment: body, default: def } };
    }
    if (kind === 'MONITOR') {
        stats.defects++;
        return {
            tab: 'defects',
            entry: {
                id: freshId('rd', externalId),
                title: pickTitle(c, 'Monitor'),
                category: 'recommendation',
                location: (c.location ?? '').toString(),
                comment: body,
                photos: [],
                default: def,
            },
        };
    }
    if (kind === 'DEFECT') {
        stats.defects++;
        return {
            tab: 'defects',
            entry: {
                id: freshId('rd', externalId),
                title: pickTitle(c, 'Defect'),
                category: 'safety',
                location: (c.location ?? '').toString(),
                comment: body,
                photos: [],
                default: def,
            },
        };
    }
    // Unknown comment kind — preserve it under information so the inspector
    // can still see and re-categorise the content.
    if (!stats.unknownCommentTypes.includes(kind)) stats.unknownCommentTypes.push(kind);
    stats.information++;
    return { tab: 'information', entry: { id: freshId('ri', externalId), title: `${kind} · ${pickTitle(c, '')}`.trim(), comment: body, default: def } };
}

export function convertSpectoraTemplate(input: SpectoraTemplate): ConvertResult {
    const stats: ConvertResult['stats'] = {
        sections: 0, items: 0,
        information: 0, limitations: 0, defects: 0,
        unknownCommentTypes: [],
    };

    const sections: TemplateSection[] = (input.sections ?? []).map((s) => {
        stats.sections++;
        const sectionTitle = (s.title ?? s.name ?? 'Untitled section').toString().slice(0, 50);
        const sectionId = freshId('sec', s.id);
        const items: TemplateItem[] = (s.items ?? []).map((it) => {
            stats.items++;
            const itemLabel = (it.label ?? it.name ?? 'Untitled item').toString().slice(0, 100);
            const itemId = freshId('item', it.id);
            const tabs = { information: [] as CannedInfoComment[], limitations: [] as CannedInfoComment[], defects: [] as CannedDefect[] };
            for (const c of (it.comments ?? [])) {
                const bucketed = bucketComment(c, stats);
                if (bucketed.tab === 'defects') tabs.defects.push(bucketed.entry);
                else if (bucketed.tab === 'limitations') tabs.limitations.push(bucketed.entry);
                else tabs.information.push(bucketed.entry);
            }
            const item: TemplateItem = {
                id: itemId,
                label: itemLabel,
                type: 'rich',
                ratingOptions: ['Satisfactory', 'Monitor', 'Defect', 'Not Inspected', 'Not Present'],
                tabs,
            };
            const description = (it.description ?? '').toString().trim();
            if (description) item.description = description;
            if (it.id) item.source = { platform: SPECTORA_PLATFORM, externalId: String(it.id) };
            return item;
        });
        const section: TemplateSection = { id: sectionId, title: sectionTitle, items };
        if (s.identifier) section.identifier = String(s.identifier);
        const disclaimer = (s.disclaimer ?? s.disclaimer_text ?? '').toString().trim();
        if (disclaimer) section.disclaimerText = disclaimer.slice(0, 4000);
        if (s.id) section.source = { platform: SPECTORA_PLATFORM, externalId: String(s.id) };
        return section;
    });

    const template: TemplateSchemaV2 = {
        schemaVersion: 2,
        sections,
    };

    // Custom rating levels from Spectora (top-level), if present. Map onto
    // v2 RatingSystem.levels with the Spectora `is_defect` flag preserved
    // and severity inferred from the `is_defect` bit (Spectora doesn't
    // distinguish marginal vs significant — assume significant when
    // is_defect, marginal otherwise; inspector can refine in the editor).
    const rawLevels = input.rating_levels ?? input.ratingLevels;
    if (Array.isArray(rawLevels) && rawLevels.length > 0) {
        const levels: RatingLevel[] = rawLevels.map((rl, i) => {
            const id = (rl.id ?? `L${i + 1}`).toString();
            const label = (rl.label ?? rl.name ?? id).toString();
            const isDefect = !!(rl.is_defect ?? rl.isDefect);
            const lvl: RatingLevel = { id, label };
            if (rl.abbreviation) lvl.abbreviation = rl.abbreviation;
            if (rl.color)        lvl.color = rl.color;
            lvl.severity = isDefect ? 'significant' : 'marginal';
            lvl.isDefect = isDefect;
            lvl.pausesAdvance = isDefect;
            if (rl.default)      lvl.default = true;
            if (rl.description)  lvl.description = rl.description;
            return lvl;
        });
        const defaultLevel = levels.find(l => l.default);
        template.ratingSystem = {
            levels,
            ...(defaultLevel ? { defaultLevelId: defaultLevel.id } : {}),
        };
    }
    return { template, stats };
}

/** What the caller must supply that the vendor file does not contain. */
export interface SpectoraAdapterOptions {
    /** The name the imported template gets. The export's own name is a suggestion, not an answer. */
    name: string;
}

const SPECTORA_ADAPTER_VERSION = '1';

/**
 * The comment vocabulary this format has.
 *
 * Fixed rather than read, because this export marks every comment as one of
 * these three and they are already our three tabs. A format whose vocabulary is
 * user-defined reports what it found in the file instead — which is the whole
 * reason the template arm carries a list rather than a flag.
 */
const SPECTORA_RATINGS = ['info', 'limit', 'defect'];

/** A value that is not a Spectora export, and the reason it is not one. */
type SpectoraShape =
    | { ok: true; doc: SpectoraTemplate }
    | { ok: false; code: 'NOT_AN_EXPORT' | 'NO_SECTIONS' };

/**
 * The value as a Spectora export, or why it is not one.
 *
 * ONE shape test, shared by `inspect` and `convert`. `inspect` throws the reason
 * away and answers null; `convert` turns it into the sentence the operator
 * reads. A second copy of this test is how the two come to disagree about what
 * a Spectora file is — and they would disagree silently, because each has its
 * own tests.
 */
function readSpectoraDocument(value: unknown): SpectoraShape {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, code: 'NOT_AN_EXPORT' };
    }
    const doc = value as SpectoraTemplate;
    if (!Array.isArray(doc.sections)) return { ok: false, code: 'NO_SECTIONS' };
    return { ok: true, doc };
}

/**
 * The uploaded file as a value, whichever form the caller holds it in.
 *
 * `inspect` is handed the file as TEXT by the registry, while `convert` is
 * handed the already-parsed document. The parse therefore lives on this side of
 * the boundary rather than being required of every caller.
 */
function valueOf(input: unknown): unknown {
    if (typeof input !== 'string') return input;
    try {
        return JSON.parse(input) as unknown;
    } catch {
        return null;
    }
}

/**
 * The Spectora entry into the normalised format.
 *
 * A thin shell over `convertSpectoraTemplate` on purpose: the four-bucket to
 * three-tab mapping is the part that is specific to this vendor, and it should
 * not also have to know what a bundle is. What the shell adds is the
 * accounting — one template read, one emitted, nothing dropped — which the
 * format requires before it will validate.
 */
export const spectoraAdapter: MigrationAdapter<SpectoraAdapterOptions> = {
    name: 'spectora',
    version: SPECTORA_ADAPTER_VERSION,
    vendor: 'spectora',
    /**
     * What this export says about itself, before converting it.
     *
     * Its ABSENCE used to mean "a vendor export has no columns, so the wizard
     * has no question" — which was true of columns and false of the file. A
     * template's question is what its comment vocabulary means, and this is
     * what carries it.
     */
    inspect(input: unknown): AdapterInspection | null {
        const read = readSpectoraDocument(valueOf(input));
        if (!read.ok) return null;
        const { doc } = read;
        return {
            kind: 'template',
            name: typeof doc.name === 'string' && doc.name.trim() !== '' ? doc.name : null,
            sections: doc.sections?.length ?? 0,
            items: (doc.sections ?? []).reduce((n, s) => n + (s.items?.length ?? 0), 0),
            ratings: [...SPECTORA_RATINGS],
            // The format has no such property, and saying `false` would assert
            // something it did not say.
            ratingsShown: null,
        };
    },
    convert(input: unknown, options: SpectoraAdapterOptions): BundleResult {
        const read = readSpectoraDocument(input);
        if (!read.ok) {
            return {
                ok: false,
                error: read.code === 'NOT_AN_EXPORT'
                    ? {
                        code: 'NOT_AN_EXPORT',
                        message: 'This file is not a Spectora template export. Export a single template as JSON and upload that file.',
                    }
                    : {
                        code: 'NO_SECTIONS',
                        message: 'This Spectora export contains no sections, so there is no template structure to import.',
                    },
            };
        }

        const { template, stats } = convertSpectoraTemplate(read.doc);

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
                    warnings: stats.unknownCommentTypes.map((kind) => ({
                        code: 'UNKNOWN_COMMENT_TYPE',
                        message: `Comments of type "${kind}" were kept under Information so nothing was lost; recategorise them in the editor.`,
                    })),
                },
                templates: [{ name: options.name, schema: template, stats }],
                contacts: [],
                members: [],
            },
        };
    },
};
