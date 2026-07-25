import { describe, it, expect } from 'vitest';
import {
    resolveAgentRepairAccess,
    agentMayReadRepairList,
    agentMayWriteRepairList,
} from '../../../server/lib/people/agent-repair-access';

/**
 * The API enforces this policy and the agent portal decides what to offer from
 * it. Both must read the SAME answer, or the portal shows an agent a button the
 * API refuses.
 */
describe('agent repair-list access policy', () => {
    it('defaults to readwrite when the company never touched the setting', () => {
        expect(resolveAgentRepairAccess(undefined)).toBe('readwrite');
        expect(resolveAgentRepairAccess(null)).toBe('readwrite');
        expect(resolveAgentRepairAccess({})).toBe('readwrite');
    });

    it('returns exactly what the company configured', () => {
        expect(resolveAgentRepairAccess({ agentRepairAccess: 'off' })).toBe('off');
        expect(resolveAgentRepairAccess({ agentRepairAccess: 'read' })).toBe('read');
        expect(resolveAgentRepairAccess({ agentRepairAccess: 'readwrite' })).toBe('readwrite');
    });

    it('off hides the list; read opens it but forbids writing; readwrite allows both', () => {
        expect(agentMayReadRepairList('off')).toBe(false);
        expect(agentMayWriteRepairList('off')).toBe(false);

        expect(agentMayReadRepairList('read')).toBe(true);
        expect(agentMayWriteRepairList('read')).toBe(false);

        expect(agentMayReadRepairList('readwrite')).toBe(true);
        expect(agentMayWriteRepairList('readwrite')).toBe(true);
    });
});
