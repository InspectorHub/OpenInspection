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

/**
 * One inspector as the report presents them, with the credentials they held on
 * publish day.
 *
 * A LIST FROM DAY ONE even though only the lead is populated. An inspection can
 * have more than one inspector — the roster lives in `inspection_inspectors`;
 * `leadInspectorId` and `helperInspectorIds` survive only as the request-payload
 * field names that write into it (`schedule.schema.ts`, `wizard.schema.ts`) —
 * and the report shows a single name today. Which of them the cover should credit is
 * a product question, not this change's; what this change fixes is that the
 * answer must not cost a migration of every stored snapshot to revisit. A scalar
 * that becomes a list AFTER snapshots exist is exactly that migration. Getting
 * the shape right while the field is empty is free.
 *
 * A badge is a claim about a PERSON on a document about an INSPECTION, so the
 * role travels with it — an unattributed pool of five badges would turn a
 * per-person claim into a per-inspection one that nobody made.
 */
export interface SnapshotInspector {
    userId:      string;
    name:        string | null;
    role:        'lead' | 'helper';
    credentials: Array<{ label: string; memberNumber: string | null; imageUrl: string | null }>;
}

/**
 * SNAPSHOT SCHEMA VERSIONS
 *
 * 1 — `{ inspection, data, units }`. Every row written before the credential
 *     snapshot. Absent `schemaVersion` means 1; the field did not exist.
 * 2 — adds `inspectors` and `styleProfile`.
 *
 * The version exists so a READER can tell "this report predates credentials"
 * from "this inspector held none" — two states that look identical as an empty
 * array and mean opposite things on a cover page.
 *
 * It is NOT a hashing basis. `report_versions.content_hash` is the SHA-256 of
 * the stored `snapshot_json` STRING, and `verifyByToken` recomputes it from that
 * same stored column — so a row written under v1 keeps hashing to exactly what
 * it hashed to, whatever later versions contain. Growing this type cannot
 * invalidate a signature that already exists, and no dual-basis verifier is
 * needed. `report-version-service.spec.ts` pins that directly, because it is the
 * kind of reasoning that is easy to get wrong in the safe direction and
 * expensive to get wrong in the other.
 */
export const SNAPSHOT_SCHEMA_VERSION = 2;

/**
 * The inspector a PINNED version credits, or null when the snapshot cannot say.
 *
 * Returns the WHOLE person, not just their badges, because everything the report
 * shows about them has to come from the same place. Pinning the badge strip and
 * leaving the name and licence line to resolve live produces one document
 * carrying two answers about one person — an inspector who renews their licence
 * gets the old number in the strip and the new one on the signature block.
 *
 * Null means "this snapshot cannot answer": no version pinned, a v1 row written
 * before inspectors were captured, or an empty list. Live resolution applies in
 * all three. It does NOT mean "held no credentials" — that is a lead whose
 * `credentials` is `[]`, which is a real answer, and rendering live state over
 * it would resurrect badges the delivered document never carried.
 *
 * OPTION A on the cover: the LEAD only, matching the report's single inspector
 * name and single signer. The snapshot keeps the helpers, so crediting them
 * later is a rendering decision rather than a migration.
 */
export function pinnedLead(
    snapshot: Snapshot | null | undefined,
): SnapshotInspector | null {
    const inspectors = snapshot?.inspectors;
    if (!inspectors?.length) return null;
    return inspectors.find((i) => i.role === 'lead') ?? inspectors[0] ?? null;
}

export interface Snapshot {
    /** Absent on rows written before the credential snapshot — treat as 1. */
    schemaVersion?: number;
    inspection?: Record<string, unknown>;
    data:        Record<string, Record<string, unknown>>;
    units:       Array<{ id: string; [key: string]: unknown }>;
    /** v2+. The people the report credits, and what they held on publish day. */
    inspectors?: SnapshotInspector[];
    /** v2+. The appearance profile resolved at publish (Report Style Presets). */
    styleProfile?: Record<string, unknown> | null;
}

interface ItemDiff {
    itemId:  string;
    kind:    'added' | 'removed' | 'changed';
    field?:  string;
    from?:   unknown;
    to?:     unknown;
}

interface UnitDiff {
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
