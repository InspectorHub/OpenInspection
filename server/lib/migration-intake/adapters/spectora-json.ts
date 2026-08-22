/**
 * A Spectora template as a JSON object, converted to the v2 schema.
 *
 * ⚠️ THIS IS NOT THE EXPORT BUTTON'S OUTPUT. The export button produces a
 * spreadsheet, which `spectora.ts` reads; this module reads a JSON object with
 * a `sections` array, which is a different representation of the same product's
 * templates. It survives because one older endpoint accepts a pasted document
 * of that shape, and that endpoint is retired with the paste modal it serves.
 *
 * Its four-bucket comment model (INFORMATIONAL / SATISFACTORY / MONITOR /
 * DEFECT) maps onto our three tabs:
 *
 * | bucket        | v2 tab      | defect category |
 * |---------------|-------------|-----------------|
 * | INFORMATIONAL | information | —               |
 * | SATISFACTORY  | information | — (prefixed)    |
 * | MONITOR       | defects     | recommendation  |
 * | DEFECT        | defects     | safety          |
 *
 * Unknown kinds fall through to information so nothing is silently lost, and
 * identifiers are preserved on every level via the v2 `source` field so a
 * re-import can detect already-mapped rows.
 */

import type {
    TemplateSchemaV2, TemplateSection, TemplateItem, RatingLevel,
    CannedInfoComment, CannedDefect,
} from '../../../types/template-schema';
import type { ConvertStats } from '../bundle';

/**
 * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED — the key this
 * deployment files this vendor's rows under, written into our own `source`
 * field so a re-import can recognise an already-mapped row.
 */
const SPECTORA_PLATFORM = 'spectora';

/** Subset of the document we actually consume. */
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

/**
 * The values this document's comment-type field carries.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: REQUIRED ENUM. Four short functional tokens
 * a parser must match to bucket anything at all. `string` remains in the union
 * because an unrecognised value is kept rather than refused.
 */
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

/**
 * Which of our three tabs an entry lands on.
 *
 * ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED. `information`,
 * `limitations` and `defects` are OUR tab names; the mapping onto them is the
 * part of this module that is a judgement rather than a reading.
 */
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
                // ⚠️ LITERAL-USE CLASSIFICATION: INDEPENDENTLY AUTHORED — our
                // own tab names; see `bucketComment`.
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

    // Custom rating levels from the document (top-level), if present. Mapped
    // onto v2 RatingSystem.levels with the `is_defect` flag preserved and
    // severity inferred from that bit — the source does not distinguish
    // marginal from significant, so assume significant when it is a defect and
    // marginal otherwise; the inspector can refine in the editor.
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
