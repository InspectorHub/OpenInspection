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

export { DEFAULT_UNIT };
