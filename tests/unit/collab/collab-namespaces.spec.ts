import { describe, expect, it } from 'vitest';
import { collabNamespaces, purgeDurableObjectsFromEnv } from '../../../server/lib/collab/collab-namespaces';

/** The helper is generic over the namespace type, so plain labels stand in for namespaces here. */
const ns = (label: string) => label;

describe('collabNamespaces', () => {
    it('is undefined when collaborative editing is not bound, even if a legacy namespace somehow is', () => {
        expect(collabNamespaces({})).toBeUndefined();
        expect(collabNamespaces({ INSPECTION_DOC_UNPINNED: ns('old') })).toBeUndefined();
    });

    it('has only the pinned side when pinning is off', () => {
        const pinned = ns('doc');
        expect(collabNamespaces({ INSPECTION_DOC: pinned })).toEqual({ pinned });
    });

    it('carries both sides when pinning is on, so a delete path cannot name one and forget the other', () => {
        const pinned = ns('pinned');
        const legacy = ns('legacy');
        expect(collabNamespaces({ INSPECTION_DOC: pinned, INSPECTION_DOC_UNPINNED: legacy })).toEqual({ pinned, legacy });
    });
});

describe('purgeDurableObjectsFromEnv', () => {
    it('maps all four bindings, and leaves absent ones absent', () => {
        const [a, b, c, d] = [ns('a'), ns('b'), ns('c'), ns('d')];
        expect(purgeDurableObjectsFromEnv({ INSPECTION_DOC: a, TENANT_PRESENCE: b, INSPECTION_DOC_UNPINNED: c, TENANT_PRESENCE_UNPINNED: d }))
            .toEqual({ INSPECTION_DOC: a, TENANT_PRESENCE: b, INSPECTION_DOC_UNPINNED: c, TENANT_PRESENCE_UNPINNED: d });
        expect(purgeDurableObjectsFromEnv({})).toEqual({});
    });
});
