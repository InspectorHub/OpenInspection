import { describe, expect, it } from 'vitest';
import { AUDIT_REGISTRY, type AuditStatus } from '../../../server/lib/audit-registry';
import { AUDIT_FAMILIES } from '../../../server/lib/audit-families';

const entries = Object.entries(AUDIT_REGISTRY);

describe('registry shape', () => {
    it('has entries at all', () => {
        expect(entries.length).toBeGreaterThan(90);
    });

    it('every family is a declared family', () => {
        const bad = entries.filter(([, d]) => !(AUDIT_FAMILIES as readonly string[]).includes(d.family));
        expect(bad.map(([a]) => a)).toEqual([]);
    });

    it('every alternate family is a declared family too', () => {
        const bad = entries.filter(([, d]) =>
            (d.altFamilies ?? []).some((f) => !(AUDIT_FAMILIES as readonly string[]).includes(f)));
        expect(bad.map(([a]) => a)).toEqual([]);
    });

    it('every label is a non-empty message key', () => {
        expect(entries.filter(([, d]) => !d.label.trim()).map(([a]) => a)).toEqual([]);
    });

    it('every superseded entry points at an action that exists', () => {
        const bad = entries.filter(([, d]) => d.status.kind === 'superseded' && !AUDIT_REGISTRY[d.status.by]);
        expect(bad.map(([a]) => a), 'a forward pointer to nothing is worse than none').toEqual([]);
    });

    it('no supersede chain — one hop must land somewhere a reader can stop', () => {
        // Deliberately NOT "the target must be live". One of the three renames,
        // `inspection.inspector_signed`, points at `agreement.inspector_signed`,
        // which is `in-esign-log`: that target has no `audit_logs` row and never
        // did, and saying so is exactly the answer a reader of an old row needs.
        // What explains nothing is a target that is ITSELF retired, because the
        // reader has to hop again and may never stop.
        const bad = entries.filter(([, d]) =>
            d.status.kind === 'superseded' &&
            AUDIT_REGISTRY[d.status.by]?.status.kind === 'superseded');
        expect(bad.map(([a]) => a), 'a supersede chain that lands on another retired name explains nothing').toEqual([]);
    });

    it('carries no never-wired or outbox-only status — this round removed the need', () => {
        const kinds = new Set<AuditStatus['kind']>(entries.map(([, d]) => d.status.kind));
        expect([...kinds].sort()).toEqual(['in-esign-log', 'live', 'superseded']);
    });
});
