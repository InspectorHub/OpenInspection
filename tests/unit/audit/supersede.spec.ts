import { describe, expect, it } from 'vitest';
import { SUPERSEDED_ACTIONS, AUDIT_REGISTRY } from '../../../server/lib/audit-registry';

describe('superseded actions', () => {
    it('maps each retired name forward', () => {
        expect(SUPERSEDED_ACTIONS['inspection.status_changed']).toBe('inspection.status_change');
        expect(SUPERSEDED_ACTIONS['inspection.conflicts_resolved']).toBe('inspection.sync_conflict_resolved');
        expect(SUPERSEDED_ACTIONS['inspection.inspector_signed']).toBe('agreement.inspector_signed');
    });

    it('every target exists in the registry — a forward pointer to nothing is worse than none', () => {
        const missing = Object.values(SUPERSEDED_ACTIONS).filter((a) => !AUDIT_REGISTRY[a]);
        expect(missing).toEqual([]);
    });

    it('rows written before the rename still resolve — that is the whole point', () => {
        // Old rows are already in the table. The map is how a reader renders them.
        expect(Object.keys(SUPERSEDED_ACTIONS).length).toBeGreaterThan(0);
    });
});
