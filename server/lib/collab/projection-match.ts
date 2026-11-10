/**
 * Do a stored document and the database hold the same results?
 *
 * A collaborative document is not the only writer of `inspection_results.data`: photo, annotation, sync, sign and
 * re-inspection paths write the blob directly, and the next persist of a document replaces the blob with the document's
 * projection (see `durable-objects/results-divergence.ts`). So copying (or restoring) a document over a live object is only safe
 * when the document and the database already agree: a document that LACKS something the database gained would take it away on
 * the next save, and one that HAS something the database since cleared or deleted would bring it back.
 *
 * `projectionsMatch` is that test, kept pure. Empty values are all the same "nothing" on both sides (null, '', false, an empty
 * list, an empty object, an absent key), so a cleared note equals a note that was never written. Meta keys (an `_`-prefixed key
 * with fewer than three segments, such as the inspector signature) are not findings and are not compared. List order counts:
 * reordering photos is a change.
 */

import * as Y from 'yjs';
import { projectResults } from '@core/field-ui/shared/results-doc';
import { isMetaKey } from '@core/field-ui/shared/finding-key';
import type { ResultsProjection } from '@core/field-ui/shared/results-doc.types';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** A projection as plain JSON, so values of any shape compare the same way. */
const toJson = (value: object): Json => JSON.parse(JSON.stringify(value));

const isObject = (v: Json | undefined): v is { [key: string]: Json } => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The value with every empty part removed, or undefined when nothing is left. */
function normalise(v: Json | undefined): Json | undefined {
    if (v === undefined || v === null || v === '' || v === false) return undefined;
    if (Array.isArray(v)) {
        const kept = v.flatMap((e) => { const n = normalise(e); return n === undefined ? [] : [n]; });
        return kept.length > 0 ? kept : undefined;
    }
    if (isObject(v)) {
        const kept: { [key: string]: Json } = {};
        for (const key of Object.keys(v).sort()) {
            const n = normalise(v[key]);
            if (n !== undefined) kept[key] = n;
        }
        return Object.keys(kept).length > 0 ? kept : undefined;
    }
    return v;
}

/** Findings only, normalised: what is left to compare. */
function findings(projection: ResultsProjection | null): Json {
    const all = projection ? toJson(projection) : {};
    const items: { [key: string]: Json } = {};
    if (isObject(all)) for (const [key, value] of Object.entries(all)) if (!isMetaKey(key)) items[key] = value;
    return normalise(items) ?? {};
}

export function projectionsMatch(source: ResultsProjection | null, database: ResultsProjection | null): boolean {
    return JSON.stringify(findings(source)) === JSON.stringify(findings(database));
}

/** The projection of an encoded results document, or null when the bytes are not one. */
export function projectionOfBytes(bytes: Uint8Array): ResultsProjection | null {
    try {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, bytes);
        return projectResults(doc);
    } catch {
        return null;
    }
}
