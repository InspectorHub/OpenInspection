export interface ReinspectionStatus {
    key: string;
    label: string;
    closed: boolean;   // true = the deficiency is considered resolved/closed
}

export const DEFAULT_REINSPECTION_STATUSES: ReinspectionStatus[] = [
    { key: 'resolved',     label: 'Resolved',     closed: true },
    { key: 'not_resolved', label: 'Not resolved', closed: false },
    { key: 'not_inspected', label: 'Not inspected', closed: false },
];

export function parseReinspectionStatuses(raw: string | null | undefined): ReinspectionStatus[] {
    if (!raw) return DEFAULT_REINSPECTION_STATUSES;
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0 &&
            parsed.every((s) => s && typeof s.key === 'string' && typeof s.label === 'string')) {
            return parsed.map((s) => ({ key: s.key, label: s.label, closed: !!s.closed }));
        }
        return DEFAULT_REINSPECTION_STATUSES;
    } catch {
        return DEFAULT_REINSPECTION_STATUSES;
    }
}

/** A deficiency item is "still open" if its follow-up status is missing or a non-closed category. */
export function isOpenStatus(statusKey: string | null | undefined, statuses: ReinspectionStatus[]): boolean {
    if (!statusKey) return true;
    const match = statuses.find((s) => s.key === statusKey);
    return match ? !match.closed : true;
}
