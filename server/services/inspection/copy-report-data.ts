/**
 * What a copy of a report takes from the source's findings, and nothing else.
 *
 * Like `clone-columns.ts` this is an allow-list, not "everything except": a field
 * added to the results document later is NOT carried until someone decides it should
 * be. A source that is signed, published and paid holds a good deal that describes
 * THAT job and must not describe the new one: the re-inspection snapshot and its
 * follow-up state, repair items attached to a finding, the inspector's signature and
 * report sign-off kept as `_`-prefixed meta keys, and any key the current code does
 * not know about.
 *
 * Nested structures are picked field by field too (canned and defect entries, custom comments,
 * photo entries), never cloned whole: a field an old document still carries, or one added later,
 * is not carried until it is added here. `attributes` and `value` are the two exceptions, copied as
 * stored by design: they are free-form answers to the template's own questions.
 *
 * Pure: no database, no storage. The service decides what to do with the result.
 */
import { findingKeysFromTemplateSnapshot, isMetaKey } from '@core/field-ui/shared/finding-key';
import type { CannedState, CustomCommentEntry, DefectState, ItemEntry, PhotoEntry } from '@core/field-ui/shared/results-doc.types';
import type { CopyReportScope } from '../../lib/validations/copy-report.schema';

type Tab = 'information' | 'limitations' | 'defects';
const TABS: readonly Tab[] = ['information', 'limitations', 'defects'];

/** Fields of a canned-comment or defect entry that describe the finding itself. The repair-item link is not one. */
const STATE_FIELDS = ['cannedId', 'included', 'comment', 'category', 'location', 'trade', 'deadline', 'timeframe'] as const;
/** Fields of a hand-written comment or defect. */
const CUSTOM_FIELDS = ['id', 'title', 'comment', 'included', 'category', 'location', 'trade'] as const;
/** Fields of a photo entry that describe an image the copy will own. Video and poster fields are not among them; `pendingUpload` is only here so the engine can see and skip such an entry. */
const PHOTO_FIELDS = ['key', 'croppedKey', 'crop', 'annotatedKey', 'annotationsJson', 'mediaId', 'mediaType', 'pendingUpload'] as const;

export interface SelectedFindings {
    /** The new results document: finding key to the entry the copy starts with, photos still the SOURCE's. */
    data: Record<string, ItemEntry>;
    /** Finding keys that found a matching place in the template. */
    keys: string[];
    copied: number;
    dropped: number;
}

function pick<T extends object>(source: T, fields: readonly string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const from = source as Record<string, unknown>;
    for (const f of fields) if (from[f] !== undefined) out[f] = structuredClone(from[f]);
    return out;
}

/** A photo entry reduced to the allow-listed fields (still pointing at the source's objects). */
function pickPhoto(entry: PhotoEntry): PhotoEntry {
    return pick(entry, PHOTO_FIELDS) as unknown as PhotoEntry;
}

function pickPhotos(list: PhotoEntry[] | undefined): PhotoEntry[] | undefined {
    return Array.isArray(list) ? list.map(pickPhoto) : undefined;
}

/**
 * Applies the allow-list to the source's findings. Keys with no place in the template are dropped
 * and counted; nothing is guessed. Photos stay the SOURCE's entries here: the item-level ones only
 * when `photos` is on, the ones on defects and custom comments only in the full scope and with it on.
 */
export function selectFindings(
    sourceData: Record<string, ItemEntry>,
    templateSnapshot: object | string | null,
    scope: CopyReportScope,
    opts: { photos: boolean },
): SelectedFindings {
    const placesInTemplate = new Set(findingKeysFromTemplateSnapshot(templateSnapshot));
    const data: Record<string, ItemEntry> = {};
    let dropped = 0;

    for (const [key, source] of Object.entries(sourceData)) {
        // A meta key (`_inspector_signature`, a report sign-off) is not a finding and is never counted as one.
        if (isMetaKey(key)) continue;
        if (!placesInTemplate.has(key) || typeof source !== 'object' || source === null || Array.isArray(source)) { dropped++; continue; }

        const from = source as ItemEntry;
        const item: Record<string, unknown> = {};
        if (from.rating !== undefined) item['rating'] = from.rating;
        if (scope !== 'rating' && from.notes !== undefined) item['notes'] = from.notes;
        if (scope === 'all') {
            if (from.value !== undefined) item['value'] = structuredClone(from.value);
            if (from.attributes !== undefined) item['attributes'] = structuredClone(from.attributes);
            if (from.tabs) {
                const tabs: Record<string, unknown> = {};
                for (const tab of TABS) {
                    const list = from.tabs[tab] as Array<CannedState | DefectState> | undefined;
                    if (!Array.isArray(list)) continue;
                    tabs[tab] = list.map((state) => {
                        const entry = pick(state, STATE_FIELDS);
                        const photos = opts.photos ? pickPhotos((state as DefectState).photos) : undefined;
                        if (photos) entry['photos'] = photos;
                        return entry;
                    });
                }
                item['tabs'] = tabs;
            }
            if (from.customComments) {
                const custom: Record<string, unknown> = {};
                for (const tab of TABS) {
                    const list = from.customComments[tab] as CustomCommentEntry[] | undefined;
                    if (!Array.isArray(list)) continue;
                    custom[tab] = list.map((c) => {
                        const entry = pick(c, CUSTOM_FIELDS);
                        const photos = opts.photos ? pickPhotos(c.photos) : undefined;
                        if (photos) entry['photos'] = photos;
                        return entry;
                    });
                }
                item['customComments'] = custom;
            }
        }
        if (opts.photos && Array.isArray(from.photos)) item['photos'] = pickPhotos(from.photos);
        data[key] = item as ItemEntry;
    }
    return { data, keys: Object.keys(data), copied: Object.keys(data).length, dropped };
}

/** Every photo array one item carries, so the caller can read the entries and later replace them. */
export function photoArrays(item: ItemEntry): Array<{ owner: { photos?: PhotoEntry[] } }> {
    const found: Array<{ owner: { photos?: PhotoEntry[] } }> = [];
    if (Array.isArray(item.photos)) found.push({ owner: item });
    for (const tab of TABS) {
        for (const entry of (item.tabs?.[tab] ?? []) as Array<{ photos?: PhotoEntry[] }>) {
            if (Array.isArray(entry.photos)) found.push({ owner: entry });
        }
        for (const entry of (item.customComments?.[tab] ?? []) as Array<{ photos?: PhotoEntry[] }>) {
            if (Array.isArray(entry.photos)) found.push({ owner: entry });
        }
    }
    return found;
}
