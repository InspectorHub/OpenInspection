/**
 * Design System 0520 subsystem D phase 7 — pure version diff computer.
 *
 * Walks two snapshot bundles (the JSON written into report_versions.
 * snapshot_json on publish) and produces a flat { items, units } diff
 * payload. Field-level mutations on rating / notes / value yield
 * `{ kind: 'changed', from, to }`; full-item additions/removals get
 * `{ kind: 'added' | 'removed' }`. _v / _by / _at metadata suffixes
 * are skipped on field walks so version bumps don't show as changes.
 */

export interface Snapshot {
    inspection?: Record<string, unknown>;
    data:        Record<string, Record<string, unknown>>;
    units:       Array<{ id: string; [key: string]: unknown }>;
}

export interface ItemDiff {
    itemId:  string;
    kind:    'added' | 'removed' | 'changed';
    field?:  string;
    from?:   unknown;
    to?:     unknown;
}

export interface UnitDiff {
    added:   Array<{ id: string; [key: string]: unknown }>;
    removed: Array<{ id: string; [key: string]: unknown }>;
}

export interface DiffPayload {
    items: ItemDiff[];
    units: UnitDiff;
}

const FIELDS_OF_INTEREST: ReadonlyArray<string> = ['rating', 'notes', 'value'];

export function computeDiff(from: Snapshot, to: Snapshot): DiffPayload {
    const items: ItemDiff[] = [];
    const fromData = from.data ?? {};
    const toData   = to.data ?? {};

    const ids = new Set<string>([...Object.keys(fromData), ...Object.keys(toData)]);
    for (const id of ids) {
        const f = fromData[id];
        const t = toData[id];
        if (!f && t) { items.push({ itemId: id, kind: 'added' });   continue; }
        if (f && !t) { items.push({ itemId: id, kind: 'removed' }); continue; }
        if (!f || !t) continue;  // defensive — guards against both undefined
        for (const field of FIELDS_OF_INTEREST) {
            if (f[field] !== t[field]) {
                items.push({ itemId: id, field, kind: 'changed', from: f[field], to: t[field] });
            }
        }
    }

    const fromUnits = from.units ?? [];
    const toUnits   = to.units ?? [];
    const fromUnitIds = new Set(fromUnits.map(u => u.id));
    const toUnitIds   = new Set(toUnits.map(u => u.id));
    const units: UnitDiff = {
        added:   toUnits.filter(u => !fromUnitIds.has(u.id)),
        removed: fromUnits.filter(u => !toUnitIds.has(u.id)),
    };

    return { items, units };
}
