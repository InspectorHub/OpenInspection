/**
 * Commercial PCA Phase U — pure bulk-unit generators. No DB, no ids: the service
 * (UnitService.createMany) assigns id/tenantId/sortOrder. floors×stacks is the
 * common apartment layout (stack = the vertical column of units); CSV covers the
 * irregular cases. Richer patterns are deferred (spec §11).
 */
export interface UnitDraft {
    label: string;
    floor: string | null;
}

export function expandFloorsStacks(input: {
    floors: number[];
    stacks: number;
    startAt?: number;
}): UnitDraft[] {
    const { floors, stacks } = input;
    const startAt = input.startAt ?? 1;
    if (!floors.length || stacks <= 0) return [];
    // Stack index is zero-padded to at least 2 digits (the common apartment
    // convention: 101, 102, ... even for a 2-stack floor) and widens further
    // only if the highest stack index needs more digits than that.
    const width = Math.max(2, String(startAt + stacks - 1).length);
    const out: UnitDraft[] = [];
    for (const floor of floors) {
        for (let i = 0; i < stacks; i++) {
            const stack = String(startAt + i).padStart(width, '0');
            out.push({ label: `${floor}${stack}`, floor: String(floor) });
        }
    }
    return out;
}

export function parseUnitCsv(csv: string): UnitDraft[] {
    const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out: UnitDraft[] = [];
    for (const line of lines) {
        const [rawLabel, rawFloor] = line.split(',').map((c) => c.trim());
        if (rawLabel.toLowerCase() === 'label' && (rawFloor ?? '').toLowerCase() === 'floor') continue; // header
        if (!rawLabel) continue;
        out.push({ label: rawLabel, floor: rawFloor ? rawFloor : null });
    }
    return out;
}
