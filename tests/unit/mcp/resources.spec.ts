import { describe, it, expect } from 'vitest';
import {
    selectResources,
    resourceNameFromOperationId,
    buildResourceRequest,
    RESOURCE_URI_SCHEME,
} from '../../../server/lib/mcp/resources';

const snap = [
    { operationId: 'listInspections', method: 'get',  pathTemplate: '/api/inspections',        scopes: ['read'],  tag: 'inspections', tier: 'primary',  inputSchema: {} },
    { operationId: 'getInspection',   method: 'get',  pathTemplate: '/api/inspections/{id}',   scopes: ['read'],  tag: 'inspections', tier: 'primary',  inputSchema: {} },
    { operationId: 'createInspection',method: 'post', pathTemplate: '/api/inspections',        scopes: ['write'], tag: 'inspections', tier: 'primary',  inputSchema: {} },
    { operationId: 'getInspItem',     method: 'get',  pathTemplate: '/api/inspections/{id}/items/{itemId}', scopes: ['read'], tag: 'inspections', tier: 'primary', inputSchema: {} },
    { operationId: 'getRecommendation',method:'get',  pathTemplate: '/api/recommendations/{id}',scopes: ['read'], tag: 'recommendations', tier: 'extended', inputSchema: {} },
    { operationId: 'listContacts',    method: 'get',  pathTemplate: '/api/contacts',           scopes: ['read'],  tag: 'contacts',    tier: 'primary',  inputSchema: {} },
] as const;

describe('resourceNameFromOperationId', () => {
    it('snake-cases without the tool prefix', () => {
        expect(resourceNameFromOperationId('getInspection')).toBe('get_inspection');
    });
});

describe('selectResources', () => {
    it('exposes granted GETs with 0 or 1 path param; skips POST and 2+ params', () => {
        const out = selectResources(snap as never, ['read:inspections']);
        const ops = out.map((r) => r.entry.operationId).sort();
        expect(ops).toEqual(['getInspection', 'listInspections']);
        // POST createInspection excluded (not a GET); getInspItem excluded (2 params)
        expect(ops).not.toContain('createInspection');
        expect(ops).not.toContain('getInspItem');
    });

    it('marks collections vs templates and builds the URI', () => {
        const out = selectResources(snap as never, ['read:inspections']);
        const list = out.find((r) => r.entry.operationId === 'listInspections')!;
        const item = out.find((r) => r.entry.operationId === 'getInspection')!;
        expect(list.pathParam).toBeNull();
        expect(list.uri).toBe(`${RESOURCE_URI_SCHEME}/api/inspections`);
        expect(item.pathParam).toBe('id');
        expect(item.uri).toBe(`${RESOURCE_URI_SCHEME}/api/inspections/{id}`);
    });

    it('honors scope grants (contacts not granted → absent)', () => {
        const out = selectResources(snap as never, ['read:inspections']);
        expect(out.map((r) => r.entry.operationId)).not.toContain('listContacts');
    });

    it('excludes extended-tier resources unless opted in', () => {
        const off = selectResources(snap as never, ['read:recommendations']);
        expect(off.map((r) => r.entry.operationId)).not.toContain('getRecommendation');
        const on = selectResources(snap as never, ['read:recommendations'], { includeExtended: true });
        expect(on.map((r) => r.entry.operationId)).toContain('getRecommendation');
    });
});

describe('buildResourceRequest', () => {
    it('GETs the collection path unchanged', () => {
        const entry = snap.find((e) => e.operationId === 'listInspections')!;
        const req = buildResourceRequest(entry as never, {});
        expect(req.method).toBe('GET');
        expect(new URL(req.url).pathname).toBe('/api/inspections');
    });

    it('substitutes the path param (URI-encoded)', () => {
        const entry = snap.find((e) => e.operationId === 'getInspection')!;
        const req = buildResourceRequest(entry as never, { id: 'abc 123' });
        expect(new URL(req.url).pathname).toBe('/api/inspections/abc%20123');
    });
});
