import { describe, it, expect } from 'vitest';
import { membersFor, type TenantMemberState } from '../../../server/durable-objects/tenant-presence-view';

const members: Record<string, TenantMemberState> = {
    me:    { online: true,  currentInspectionId: 'i-mine',   lastSeenAt: 3 },
    peer:  { online: true,  currentInspectionId: 'i-hidden', lastSeenAt: 2 },
    quiet: { online: false, currentInspectionId: null,       lastSeenAt: 1 },
};

describe('company presence roster as one viewer sees it', () => {
    it('an unrestricted viewer gets the roster unchanged (control)', () => {
        expect(membersFor(members, { userId: 'me', restricted: false })).toEqual(members);
    });
    it('a restricted viewer is not told which inspection a colleague has open', () => {
        const view = membersFor(members, { userId: 'me', restricted: true });
        expect(view.peer?.currentInspectionId).toBeNull();
        expect(JSON.stringify(view)).not.toContain('i-hidden');
    });
    it('a restricted viewer keeps online state, last-seen time and their own open inspection', () => {
        const view = membersFor(members, { userId: 'me', restricted: true });
        expect(view.peer).toMatchObject({ online: true, lastSeenAt: 2 });
        expect(view.quiet).toEqual(members.quiet);
        expect(view.me?.currentInspectionId).toBe('i-mine');
    });
    it('does not mutate the stored roster', () => {
        membersFor(members, { userId: 'me', restricted: true });
        expect(members.peer?.currentInspectionId).toBe('i-hidden');
    });
    it('a viewer with no identity sees no inspection ids at all', () => {
        const view = membersFor(members, { userId: '', restricted: true });
        expect(Object.values(view).every(m => m.currentInspectionId === null)).toBe(true);
    });
});
