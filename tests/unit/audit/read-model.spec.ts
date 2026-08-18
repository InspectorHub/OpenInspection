import { describe, expect, it } from 'vitest';
import { fromActivityRow, fromEsignRow, type AuditActor } from '../../../server/lib/audit-read-model';
// NOT `compliance/erasure-manifest` — the sentinel is declared in
// `compliance/anonymize-pii.ts`, which is the single source both the erasure
// orchestrator and the retention sweep read. The manifest declares WHICH
// columns are erased; this is the VALUE they are erased to.
import { ERASED_SENTINEL } from '../../../server/lib/compliance/anonymize-pii';

const row = (over: Partial<Parameters<typeof fromActivityRow>[0]> = {}) => ({
    id: 'a1', createdAt: 1_760_000_000_000, action: 'inspection.status_change',
    entityType: 'inspection', entityId: 'i1', userId: 'u1' as string | null, actorName: 'Alice' as string | null,
    metadata: { from: 'scheduled', to: 'complete', reason: 'client rescheduled' } as Record<string, unknown> | null,
    ...over,
});

describe('activity rows project onto AuditEntry', () => {
    it('normalises metadata by role, not by key name', () => {
        expect(fromActivityRow(row()).facts).toEqual({ from: 'scheduled', to: 'complete', reason: 'client rescheduled' });
    });

    it('maps four spellings of a recipient onto one role', () => {
        const e = fromActivityRow(row({ action: 'inspection.share_agent', metadata: { agentEmail: 'x' } }));
        expect(e.facts.person, 'agentEmail, clientEmail, recipient and recipientEmail all render the same').toBe('x');
    });

    it('renders an old action under the name that replaced it', () => {
        expect(fromActivityRow(row({ action: 'inspection.status_changed' })).action).toBe('inspection.status_change');
    });

    it('drops a metadata key the registry does not declare — the registry is the contract', () => {
        const e = fromActivityRow(row({ metadata: { from: 'a', somethingNobodyDeclared: 'b' } }));
        expect(Object.values(e.facts)).not.toContain('b');
    });

    it('an action nobody declared still projects, marked unknown rather than dropped', () => {
        // Rows outlive vocabulary. A reader must be told a row exists even when
        // its name has been deleted from the registry since it was written.
        const e = fromActivityRow(row({ action: 'widget.view', entityType: 'widget', metadata: null }));
        expect(e.action).toBe('widget.view');
        expect(e.known).toBe(false);
        expect(fromActivityRow(row()).known, 'the control').toBe(true);
    });
});

describe('actor has four states and they are not interchangeable', () => {
    it('a named user', () => {
        const expected: AuditActor = { kind: 'user', id: 'u1', name: 'Alice' };
        expect(fromActivityRow(row()).actor).toEqual(expected);
    });

    it('covers all four kinds — a projection that can only ever return two of them is not four states', () => {
        const kinds = new Set<AuditActor['kind']>([
            fromActivityRow(row()).actor.kind,
            fromActivityRow(row({ actorName: ERASED_SENTINEL })).actor.kind,
            fromActivityRow(row({ userId: null, actorName: null })).actor.kind,
            fromActivityRow(row({ userId: null, actorName: null, action: 'booking.routing.applied' })).actor.kind,
        ]);
        expect([...kinds].sort()).toEqual(['anonymized', 'system', 'unrecorded', 'user']);
    });

    it('erased by retention is NOT the same as never recorded', () => {
        const erased = fromActivityRow(row({ actorName: ERASED_SENTINEL }));
        expect(erased.actor).toEqual({ kind: 'anonymized' });
        const never = fromActivityRow(row({ userId: null, actorName: null }));
        expect(never.actor).toEqual({ kind: 'unrecorded' });
        expect(erased.actor).not.toEqual(never.actor);
    });

    it('a row with an id but no resolvable name is still a user, not an absence', () => {
        expect(fromActivityRow(row({ actorName: null })).actor).toMatchObject({ kind: 'user', id: 'u1' });
    });

    it('a row the platform wrote with no actor is system, not unrecorded', () => {
        expect(fromActivityRow(row({ userId: null, actorName: null, action: 'booking.routing.applied' })).actor)
            .toEqual({ kind: 'system' });
    });
});

describe('esign rows project onto the same shape', () => {
    it('declares its integrity, because the guarantee differs', () => {
        const e = fromEsignRow({ id: 'e1', createdAt: 1, event: 'agreement.signed', requestId: 'r1', payloadJson: '{}' });
        expect(e.source).toBe('esign');
        expect(e.integrity).toBe('signed-chain');
    });

    it('an activity row never claims a chain it does not have — the control', () => {
        expect(fromActivityRow(row()).integrity).toBe('plain');
    });

    it('an esign event that has an audit-vocabulary name is rendered under it', () => {
        expect(fromEsignRow({ id: 'e2', createdAt: 1, event: 'request.sent', requestId: 'r1', payloadJson: '{}' }).action)
            .toBe('agreement.sent');
    });

    it('an esign event with no audit-vocabulary counterpart keeps its own name', () => {
        // `agreement.signed`, `signer.signed` and `workflow.complete` exist only
        // in the chain. Inventing an AuditAction for them would put a name in
        // the read model that `audit_logs` has never held.
        const e = fromEsignRow({ id: 'e3', createdAt: 1, event: 'workflow.complete', requestId: 'r1', payloadJson: '{}' });
        expect(e.action).toBe('workflow.complete');
        expect(e.known).toBe(false);
    });
});
