/**
 * Whether two frozen snapshots hold the same report, and, when they do not, WHICH parts differ, in ONE pass.
 *
 * A snapshot is stored as a JSON string, but two strings can hold the same report: the findings are projected from a
 * live collaborative document whose object keys come out in the order its internal structures were built, which is not
 * stable across a reload of that document. Comparing strings therefore called an untouched report "changed" and made a
 * new version with an empty diff. The comparison here is on the parsed content with object keys sorted; ARRAYS keep their
 * order (photo order, unit order and the like are content), so any real change still differs.
 *
 * Cost matters (this runs inside a publish request on a snapshot of up to 1 MB): each side is parsed once, each part is
 * canonicalised once, and the list of differing part names is a by-product of that same pass, never a second one.
 */
import { canonical } from './report-freeze';

type Json = Record<string, unknown>;

export interface SnapshotComparison {
    /** Same report, same look. */
    same: boolean;
    /**
     * When not `same`: the parts that moved, as names only (top-level keys, and the finding keys or inspection columns
     * inside `data` and `inspection`), never values, capped. Empty when `same`. For a log line that says why a publish
     * was not "unchanged".
     */
    differs: string[];
}

const LIMIT = 20;
/** The two top-level parts whose entries are compared (and named) one by one. */
const NESTED = new Set(['data', 'inspection']);

function parse(json: string): Json | null {
    try {
        const v = JSON.parse(json) as unknown;
        return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Json : null;
    } catch {
        return null;
    }
}

function isObject(v: unknown): v is Json {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Exact content, with one allowance: a stored version written before the `presentation` part existed (no such part) is
 * compared without `presentation` and `schemaVersion`, so that the step from version 3 to 4 is not by itself a change.
 * A stored version that HAS the part compares in full, so a settings change after it still counts. An unreadable side is
 * always different.
 */
export function compareSnapshots(stored: string, fresh: string): SnapshotComparison {
    if (stored === fresh) return { same: true, differs: [] };
    const old = parse(stored);
    const now = parse(fresh);
    if (!old || !now) return { same: false, differs: ['(unreadable)'] };
    if (!('presentation' in old)) {
        delete old.schemaVersion;
        delete now.schemaVersion;
        delete now.presentation;
    }
    const differs: string[] = [];
    for (const key of new Set([...Object.keys(old), ...Object.keys(now)])) {
        if (differs.length >= LIMIT) break;
        const a = old[key];
        const b = now[key];
        // A key present on one side only differs even when its value reads as null.
        if ((key in old) !== (key in now)) { differs.push(key); continue; }
        if (NESTED.has(key) && isObject(a) && isObject(b)) {
            for (const sub of new Set([...Object.keys(a), ...Object.keys(b)])) {
                if (differs.length >= LIMIT) break;
                if ((sub in a) !== (sub in b) || canonical(a[sub]) !== canonical(b[sub])) differs.push(`${key}.${sub}`);
            }
        } else if (canonical(a) !== canonical(b)) {
            differs.push(key);
        }
    }
    return { same: differs.length === 0, differs };
}
