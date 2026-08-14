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
    // Was `readwrite` until 2026-08-14. The old default let an external agent
    // WRITE a homebuyer's defect list at a company that had never been asked,
    // justified by continuity for companies predating the setting — an argument
    // that says nothing about a company created afterwards. Narrowed for every
    // company rather than split by signup date, so the answer to "what can an
    // agent do here" does not depend on when the company joined.
    it('defaults to read — an untouched setting does not grant write', () => {
        expect(resolveAgentRepairAccess(undefined)).toBe('read');
        expect(resolveAgentRepairAccess(null)).toBe('read');
        expect(resolveAgentRepairAccess({})).toBe('read');
    });

    it('still grants write only where the company chose it explicitly', () => {
        expect(resolveAgentRepairAccess({ agentRepairAccess: 'readwrite' })).toBe('readwrite');
        expect(agentMayWriteRepairList(resolveAgentRepairAccess({}))).toBe(false);
        expect(agentMayReadRepairList(resolveAgentRepairAccess({}))).toBe(true);
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
