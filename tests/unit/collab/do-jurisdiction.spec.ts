import { describe, expect, it } from 'vitest';
import { pinDurableObjects, readDoJurisdiction, type DoJurisdiction, type PinnableNamespace } from '../../../server/lib/collab/do-jurisdiction';

/** A namespace stand-in that records which jurisdiction it was narrowed to. */
interface FakeNs extends PinnableNamespace {
    label: string;
    pinnedTo: DoJurisdiction | null;
}

function fakeNs(label: string, pinnedTo: DoJurisdiction | null = null): FakeNs {
    return { label, pinnedTo, jurisdiction: (j) => fakeNs(`${label}@${j}`, j) };
}

describe('readDoJurisdiction', () => {
    it('is null when the variable is absent or empty: nothing is pinned and nothing changes', () => {
        expect(readDoJurisdiction({})).toBeNull();
        expect(readDoJurisdiction({ DO_JURISDICTION: '' })).toBeNull();
        expect(readDoJurisdiction({ DO_JURISDICTION: '  ' })).toBeNull();
    });

    it('accepts the three Cloudflare jurisdictions, any case', () => {
        expect(readDoJurisdiction({ DO_JURISDICTION: 'us' })).toBe('us');
        expect(readDoJurisdiction({ DO_JURISDICTION: 'EU' })).toBe('eu');
        expect(readDoJurisdiction({ DO_JURISDICTION: 'fedramp' })).toBe('fedramp');
    });

    it('throws on anything else: a typo must not silently leave the objects unpinned', () => {
        expect(() => readDoJurisdiction({ DO_JURISDICTION: 'usa' })).toThrow(/DO_JURISDICTION/);
        expect(() => readDoJurisdiction({ DO_JURISDICTION: 'germany' })).toThrow(/DO_JURISDICTION/);
    });
});

describe('pinDurableObjects', () => {
    it('returns the very same env when no jurisdiction is configured', () => {
        const env = { INSPECTION_DOC: fakeNs('doc'), OTHER: 1 };
        expect(pinDurableObjects(env)).toBe(env);
    });

    it('narrows each Durable Object namespace to the jurisdiction and leaves other bindings alone', () => {
        const env = { DO_JURISDICTION: 'us', INSPECTION_DOC: fakeNs('doc'), INSPECTION_PRESENCE: fakeNs('presence'), TENANT_PRESENCE: fakeNs('tenant'), INSPECTOR_MCP: fakeNs('mcp'), DB: { d1: true } };
        const pinned = pinDurableObjects(env);
        expect(pinned.INSPECTION_DOC.pinnedTo).toBe('us');
        expect(pinned.INSPECTION_PRESENCE.pinnedTo).toBe('us');
        expect(pinned.TENANT_PRESENCE.pinnedTo).toBe('us');
        expect(pinned.INSPECTOR_MCP.pinnedTo).toBe('us');
        expect(pinned.DB).toBe(env.DB);
    });

    it('keeps the original, unpinned collab namespace reachable for the one-off state copy', () => {
        const doc = fakeNs('doc');
        const pinned = pinDurableObjects({ DO_JURISDICTION: 'us', INSPECTION_DOC: doc });
        expect(pinned.INSPECTION_DOC_UNPINNED).toBe(doc);
    });

    it('keeps the original tenant presence namespace reachable too, because those objects hold storage that a purge must reach', () => {
        const presence = fakeNs('tenant');
        const pinned = pinDurableObjects({ DO_JURISDICTION: 'us', TENANT_PRESENCE: presence });
        expect(pinned.TENANT_PRESENCE_UNPINNED).toBe(presence);
        expect(pinned.TENANT_PRESENCE?.pinnedTo).toBe('us');
    });

    it('is stable: the same env gives the same pinned object, so a mutation made through it survives the next request', () => {
        const env = { DO_JURISDICTION: 'us', INSPECTION_DOC: fakeNs('doc') };
        expect(pinDurableObjects(env)).toBe(pinDurableObjects(env));
    });

    it('skips a binding that is not bound or is not a namespace, rather than throwing', () => {
        // @ts-expect-error TENANT_PRESENCE is deliberately not a namespace: pinning must skip it, not trust it.
        expect(() => pinDurableObjects({ DO_JURISDICTION: 'us', INSPECTION_DOC: undefined, TENANT_PRESENCE: { notANamespace: true } })).not.toThrow();
    });

    it('throws on a bad jurisdiction value, on every call', () => {
        expect(() => pinDurableObjects({ DO_JURISDICTION: 'mars', INSPECTION_DOC: fakeNs('doc') })).toThrow(/DO_JURISDICTION/);
    });
});
