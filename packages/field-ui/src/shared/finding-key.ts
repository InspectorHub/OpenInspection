const DEFAULT_UNIT = '_default';

export function findingKey(unitId: string | null | undefined, sectionId: string, itemId: string): string {
    return `${unitId || DEFAULT_UNIT}:${sectionId}:${itemId}`;
}

export function parseFindingKey(key: string): { unitId: string; sectionId: string; itemId: string } {
    const parts = key.split(':');
    if (parts.length === 3) return { unitId: parts[0], sectionId: parts[1], itemId: parts[2] };
    if (parts.length === 2) return { unitId: DEFAULT_UNIT, sectionId: parts[0], itemId: parts[1] };
    return { unitId: DEFAULT_UNIT, sectionId: '', itemId: key };
}

export function findingsForUnit(
    data: Record<string, unknown>,
    unitId: string,
): Record<string, unknown> {
    const prefix = `${unitId}:`;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
        if (key.startsWith(prefix)) result[key] = value;
    }
    return result;
}

export function isLegacyKey(key: string): boolean {
    return key.split(':').length < 3;
}

export function migrateLegacyKey(itemId: string, sectionId: string): string {
    return findingKey(null, sectionId, itemId);
}

/**
 * Enumerate every template item's composite findingKey from a stored
 * `inspections.template_snapshot` value.
 *
 * Mirrors the enumeration in inspection-core.service.ts (getReportData /
 * reinspection candidate resolution): the snapshot may be a JSON string, a v2
 * `{ sections: [...] }` object, or a flat legacy array (treated as a single
 * `general` section). Items with an empty/missing `id` are skipped. Section and
 * item ids are coerced to strings. Returns `[]` for null/garbage input — never
 * throws (used on the DO hydration hot path where a parse failure must not
 * crash the doc bootstrap).
 *
 * @see #181 — used by the Durable Object to seed full Condition-A structure.
 */
export function findingKeysFromTemplateSnapshot(snapshot: unknown): string[] {
    if (snapshot == null) return [];

    let parsed: unknown = snapshot;
    if (typeof snapshot === 'string') {
        try {
            parsed = JSON.parse(snapshot);
        } catch {
            return [];
        }
    }

    // Resolve sections: a flat array is a single legacy `general` section; a v2
    // object exposes `sections`; anything else has no enumerable items.
    let sections: Array<{ id?: unknown; items?: unknown }>;
    if (Array.isArray(parsed)) {
        sections = [{ id: 'general', items: parsed }];
    } else if (
        typeof parsed === 'object' &&
        parsed !== null &&
        Array.isArray((parsed as { sections?: unknown }).sections)
    ) {
        sections = (parsed as { sections: Array<{ id?: unknown; items?: unknown }> }).sections;
    } else {
        return [];
    }

    const keys: string[] = [];
    for (const section of sections) {
        const items = section?.items;
        if (!Array.isArray(items)) continue;
        const sectionId = String(section.id ?? '');
        for (const item of items) {
            if (typeof item !== 'object' || item === null) continue;
            const rawId = (item as { id?: unknown }).id;
            const itemId = String(rawId ?? '');
            if (!itemId) continue;
            keys.push(findingKey(DEFAULT_UNIT, sectionId, itemId));
        }
    }
    return keys;
}

export { DEFAULT_UNIT };
