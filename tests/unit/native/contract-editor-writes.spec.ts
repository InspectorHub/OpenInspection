/**
 * The editor write routes the native app calls, pinned against the committed contract.
 *
 * Three questions, each asked with a positive control so a broken detector cannot read
 * as a clean result:
 *  - is every route the app calls registered (and is an unregistered one noticed)?
 *  - does each registered operation exist in the committed document with its method and path?
 *  - are the shapes the registry cannot express (multipart bodies, bodies deliberately left
 *    out of the schema, the size cap) still stated where a client reads them?
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    NATIVE_CONTRACT,
    NATIVE_NON_OPENAPI_CONTRACT,
    type NativeContractEntry,
} from '../../../scripts/lib/native-contract-registry';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = resolve(__dirname, '../../../contracts/native-contract.openapi.json');

interface Operation {
    description?: string;
    requestBody?: { content?: Record<string, { schema?: unknown }> };
}
interface Contract {
    paths: Record<string, Record<string, Operation>>;
    components?: { schemas?: Record<string, unknown> };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const contract: Contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf-8'));
const B = '/api/inspections/{id}';

/** Every write (and the editor reads) the native app issues, as the app source spells them. */
const APP_CALLS: readonly NativeContractEntry[] = [
    { method: 'post', path: `${B}/units` },
    { method: 'post', path: `${B}/units/bulk` },
    { method: 'post', path: `${B}/units/{unitId}/duplicate` },
    { method: 'patch', path: `${B}/units/{unitId}` },
    { method: 'delete', path: `${B}/units/{unitId}` },
    { method: 'post', path: `${B}/unit-mode` },
    { method: 'patch', path: `${B}/property-facts` },
    { method: 'post', path: `${B}/property-facts/autofill` },
    { method: 'patch', path: `${B}/pca-narrative` },
    { method: 'post', path: `${B}/inspector-signature` },
    { method: 'patch', path: `${B}/template-snapshot` },
    { method: 'post', path: `${B}/publish` },
    { method: 'get', path: `${B}/publish-readiness` },
    { method: 'patch', path: `${B}/statutory-details` },
    { method: 'post', path: `${B}/statutory-form/instances` },
    { method: 'post', path: `${B}/compliance/signoff` },
    { method: 'delete', path: `${B}/compliance/signoff/{role}` },
    { method: 'post', path: `${B}/compliance/doc-review/seed` },
    { method: 'patch', path: `${B}/compliance/doc-review/{documentKey}` },
    { method: 'put', path: `${B}/compliance/psq` },
    { method: 'post', path: `${B}/compliance/psq/status` },
    { method: 'post', path: `${B}/collab/restructure` },
    { method: 'post', path: `${B}/collab/followup` },
    { method: 'post', path: `${B}/collab/restore` },
    { method: 'post', path: `${B}/collab/snapshots` },
    { method: 'get', path: `${B}/collab/snapshots` },
    { method: 'get', path: `${B}/collab/snapshots/{seq}` },
    { method: 'get', path: '/api/inspections/templates' },
    { method: 'get', path: '/api/inspections/templates/{id}' },
    { method: 'post', path: '/api/inspections/templates' },
    { method: 'put', path: '/api/inspections/templates/{id}' },
    { method: 'get', path: `${B}/media` },
    { method: 'post', path: `${B}/upload` },
    { method: 'post', path: `${B}/media/upload` },
    { method: 'post', path: `${B}/cover` },
    { method: 'post', path: `${B}/items/{itemId}/photos/{photoIndex}/annotation` },
    { method: 'post', path: `${B}/items/{itemId}/photos/{photoIndex}/crop` },
    { method: 'post', path: `${B}/media/video/r2-upload-poster` },
];

function key(entry: { method: string; path: string }): string {
    return `${entry.method} ${entry.path}`;
}

/** The calls in `calls` that neither registry list names. */
function unregistered(
    calls: readonly NativeContractEntry[],
    registry: readonly NativeContractEntry[],
    nonOpenApi: readonly NativeContractEntry[],
): string[] {
    const known = new Set([...registry, ...nonOpenApi].map(key));
    return calls.filter((c) => !known.has(key(c))).map(key);
}

/** The registry entries the document does not declare, by method and path. */
function absentFromDocument(registry: readonly NativeContractEntry[], doc: Contract): string[] {
    return registry.filter((e) => doc.paths[e.path]?.[e.method] === undefined).map(key);
}

function operation(method: string, path: string): Operation {
    const found = contract.paths[path]?.[method];
    if (found === undefined) throw new Error(`${method} ${path} is not in the committed contract`);
    return found;
}

function resolveSchema(schema: unknown): Record<string, unknown> {
    if (!isRecord(schema)) return {};
    const ref = schema['$ref'];
    if (typeof ref === 'string') {
        const name = ref.replace('#/components/schemas/', '');
        const target = contract.components?.schemas?.[name];
        return isRecord(target) ? resolveSchema(target) : {};
    }
    return schema;
}

function bodyProperties(op: Operation, mediaType: string): string[] {
    const schema = resolveSchema(op.requestBody?.content?.[mediaType]?.schema);
    const properties = schema['properties'];
    return isRecord(properties) ? Object.keys(properties) : [];
}

function bodyField(op: Operation, name: string): unknown {
    const schema = resolveSchema(op.requestBody?.content?.['multipart/form-data']?.schema);
    const properties = schema['properties'];
    return isRecord(properties) ? properties[name] : undefined;
}

describe('editor write routes in the native contract', () => {
    it('registers every route in the app call list kept in this spec', () => {
        expect(unregistered(APP_CALLS, NATIVE_CONTRACT, NATIVE_NON_OPENAPI_CONTRACT)).toEqual([]);
    });

    it('notices an app call that nothing registers (negative fixture), and stays quiet once it is listed', () => {
        const stray: NativeContractEntry = { method: 'post', path: `${B}/native-contract-control` };
        expect(unregistered([...APP_CALLS, stray], NATIVE_CONTRACT, NATIVE_NON_OPENAPI_CONTRACT)).toEqual([key(stray)]);
        expect(unregistered([stray], [...NATIVE_CONTRACT, stray], NATIVE_NON_OPENAPI_CONTRACT)).toEqual([]);
    });

    it('finds every registered operation in the committed document with its method and path', () => {
        expect(NATIVE_CONTRACT.length).toBeGreaterThanOrEqual(71);
        expect(absentFromDocument(NATIVE_CONTRACT, contract)).toEqual([]);
    });

    it('reports a registered operation the document lacks (positive control)', () => {
        const control: NativeContractEntry = { method: 'delete', path: `${B}/units/{unitId}/native-contract-control` };
        expect(absentFromDocument([...NATIVE_CONTRACT, control], contract)).toEqual([key(control)]);
        const wrongMethod: NativeContractEntry = { method: 'get', path: `${B}/units/bulk` };
        expect(absentFromDocument([wrongMethod], contract)).toEqual([key(wrongMethod)]);
    });

    it.each([
        ['units create', 'post', `${B}/units`, ['parentUnitId', 'kind', 'type', 'name']],
        ['compliance signoff', 'post', `${B}/compliance/signoff`, ['role', 'personId', 'name', 'license', 'dualRole']],
        ['publish', 'post', `${B}/publish`, ['summary']],
        ['psq status', 'post', `${B}/compliance/psq/status`, ['status']],
    ] as const)('%s declares every key the app sends', (_label, method, path, sent) => {
        const declared = bodyProperties(operation(method, path), 'application/json');
        expect(sent.filter((k) => !declared.includes(k))).toEqual([]);
        // Control: a key nothing declares is reported.
        expect([...sent, 'nativeContractControl'].filter((k) => !declared.includes(k))).toEqual(['nativeContractControl']);
    });

    it.each([
        ['upload', `${B}/upload`, ['file', 'itemId']],
        ['media upload', `${B}/media/upload`, ['file']],
        ['cover', `${B}/cover`, ['image', 'sourceKey', 'crop']],
        ['annotation', `${B}/items/{itemId}/photos/{photoIndex}/annotation`, ['image', 'nodes']],
        ['crop', `${B}/items/{itemId}/photos/{photoIndex}/crop`, ['image', 'crop']],
    ] as const)('%s is multipart with the form fields the app appends', (_label, path, fields) => {
        const op = operation('post', path);
        expect(Object.keys(op.requestBody?.content ?? {})).toEqual(['multipart/form-data']);
        const declared = bodyProperties(op, 'multipart/form-data');
        expect(fields.filter((f) => !declared.includes(f))).toEqual([]);
        const binary = resolveSchema(bodyField(op, fields[0]));
        expect(binary['format']).toBe('binary');
    });

    it('describes the poster upload as a binary non-OpenAPI entry', () => {
        const poster = NATIVE_NON_OPENAPI_CONTRACT.find((e) => e.path === `${B}/media/video/r2-upload-poster`);
        expect(poster?.kind).toBe('binary');
        expect(poster?.method).toBe('post');
        expect(NATIVE_CONTRACT.some((e) => e.path === `${B}/media/video/r2-upload-poster`)).toBe(false);
    });

    it.each([
        ['collab followup', `${B}/collab/followup`, '{itemId, status, notes?}'],
        ['collab restore', `${B}/collab/restore`, '{seq}'],
    ] as const)('%s leaves its request body out of the schema on purpose and states it in the description', (_label, path, shape) => {
        const op = operation('post', path);
        expect(op.requestBody).toBeUndefined();
        expect(op.description).toContain(shape);
        // Control: a route that does declare a body has one.
        expect(operation('post', `${B}/units`).requestBody).toBeDefined();
    });

    it.each([
        ['annotation', `${B}/items/{itemId}/photos/{photoIndex}/annotation`],
        ['crop', `${B}/items/{itemId}/photos/{photoIndex}/crop`],
        ['cover', `${B}/cover`],
    ] as const)('%s states the 413 size cap', (_label, path) => {
        expect(operation('post', path).description).toContain('An image over 10 MiB is refused with 413.');
        expect(operation('post', path).description).not.toContain('No size cap');
        // Control: the photo upload states the same cap, with 413.
        expect(operation('post', `${B}/upload`).description).toContain('A file over 10 MiB is refused with 413');
    });
});
