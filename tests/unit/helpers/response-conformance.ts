/**
 * Shared pieces of the native response conformance spec: the committed contract, the operations the
 * harness requests, the real-app requests, and the comparison with the recorded list of undeclared
 * keys. The spec (tests/unit/native/response-conformance.spec.ts) holds the assertions.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../../../server/index';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import * as schema from '../../../server/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isMoneyField } from '../../../server/lib/auth/money-redaction';
import { makeExecutionContext } from './exec-ctx';
import { createHarness, INSPECTOR_ID, OWNER_ID, TENANT_ID, type Harness } from './tenant-email-harness';
import { compareToSchema, declaredObjectArrays } from './response-shape';

const here = dirname(fileURLToPath(import.meta.url));

interface Contract {
    paths: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> }>>;
    components?: { schemas?: Record<string, unknown> };
}
export interface AllowEntry { method: string; path: string; at: string; keys: string[]; reason: string }
export interface Observation {
    method: string;
    path: string;
    /** The status the operation was expected to answer, and the one it did. */
    expected: number;
    status: number;
    contentType: string;
    /** Whether the committed contract declares a JSON body for the expected status. */
    declared: boolean;
    bodyKeys: number;
    extras: Array<{ at: string; key: string }>;
    missingRequired: string[];
    typeMismatch: string[];
    elements: Record<string, number>;
    /** For a body that carries the inspection record: the JSON type of its template snapshot as served, and as stored. */
    snapshot?: { served: string; stored: string };
    /** Every array of objects the response schema declares, from the schema alone. */
    arrays: string[];
}

export const contract: Contract = JSON.parse(readFileSync(resolve(here, '../../../contracts/native-contract.openapi.json'), 'utf-8'));
export const ALLOW_LIST_PATH = resolve(here, 'undeclared-response-keys.allowlist.json');

const INSPECTION_ID = '44444444-0000-4000-8000-0000000000e4';
type Vars = Record<string, string>;

/** One request. `status` is the response status whose schema the body is compared with (the schema key, not always 200). */
interface Operation {
    method: 'get' | 'post' | 'put' | 'patch' | 'delete';
    path: string;
    status?: number;
    body?: unknown;
    params?: (vars: Vars) => Vars;
    save?: (body: unknown, vars: Vars) => void;
}

/** The created row's id (`data.id`, or `data.<wrapper>.id`), or '' when the create did not answer one; the operations that need it then fail on their own status. */
function dataId(body: unknown, wrapper?: string): string {
    const field = (value: unknown, name: string): unknown => (typeof value === 'object' && value !== null && name in value ? (value as Record<string, unknown>)[name] : null);
    const data = field(body, 'data');
    const id = field(wrapper === undefined ? data : field(data, wrapper), 'id');
    return typeof id === 'string' ? id : '';
}

const B = '/api/inspections/{id}';
const COST_ITEM: Pick<typeof schema.costItems.$inferInsert, 'system' | 'component' | 'action' | 'costMethod' | 'lumpSumCents' | 'bucket'> = {
    system: 'roof', component: 'shingles', action: 'repair', costMethod: 'lump_sum', lumpSumCents: 150000, bucket: 'immediate',
};

/** Reads first (they see the seeded rows), then writes in an order that leaves each one a fresh row to act on. */
export const OPERATIONS: readonly Operation[] = [
    ...[B, `${B}/results`, `${B}/report-data`, `${B}/compliance`, `${B}/tags`, `${B}/cost-items`, `${B}/media`, `${B}/publish-readiness`,
        '/api/inspections', '/api/inspections/templates', '/api/inspections/templates/{id}', '/api/session/context', '/api/client/compat',
        '/api/client/session', '/api/tags', '/api/recommendations', '/api/contractor-types', '/api/admin/defect-categories',
    ].map((path): Operation => (path === '/api/inspections/templates/{id}' ? { method: 'get', path, params: () => ({ id: 'tpl-1' }) } : { method: 'get', path })),
    { method: 'post', path: `${B}/cost-items`, status: 201, body: COST_ITEM, save: (b, v) => { v.costItem = dataId(b); } },
    { method: 'patch', path: `${B}/cost-items/{itemId}`, body: { component: 'flashing' }, params: (v) => ({ itemId: v.costItem ?? '' }) },
    { method: 'delete', path: `${B}/cost-items/{itemId}`, params: (v) => ({ itemId: v.costItem ?? '' }) },
    { method: 'post', path: `${B}/items/{itemId}/tags`, body: { tagId: 'tag-1' }, params: () => ({ itemId: 'itm_cover' }) },
    { method: 'delete', path: `${B}/items/{itemId}/tags/{tagId}`, params: () => ({ itemId: 'itm_cover', tagId: 'tag-1' }) },
    { method: 'post', path: '/api/inspections/templates', status: 201, body: { name: 'Written template', schema: { schemaVersion: 2, sections: [] } }, save: (b, v) => { v.template = dataId(b, 'template'); } },
    { method: 'put', path: '/api/inspections/templates/{id}', body: { name: 'Renamed template' }, params: (v) => ({ id: v.template ?? '' }) },
    { method: 'patch', path: B, body: { propertyAddress: '13 Harbor Lane' } },
    { method: 'post', path: '/api/inspections', status: 201, body: { id: '44444444-0000-4000-8000-0000000000e5', propertyAddress: '14 Harbor Lane', templateId: 'tpl-1' } },
    { method: 'patch', path: `${B}/property-facts`, body: { yearBuilt: 1990 } },
    { method: 'patch', path: `${B}/pca-narrative`, body: { purpose: 'To record observed conditions.' } },
];

export const opKey = (method: string, path: string): string => `${method.toUpperCase()} ${path}`;
export const COVERED_KEYS: ReadonlySet<string> = new Set(OPERATIONS.map((o) => opKey(o.method, o.path)));

/** The /api/client routes are answered for a native OAuth grant, not a staff session JWT; this stands in for the grant provider. */
const NATIVE_PROPS: NativeProps = { kind: 'native', userId: OWNER_ID, tenantId: TENANT_ID, role: 'owner', lastUsedAt: 0, grantedAt: 0 };
const NATIVE_PROVIDER = {
    unwrapToken: async (t: string) => (t === 'u:g:s' ? { scope: [NATIVE_SCOPE], grant: { clientId: 'c', scope: [NATIVE_SCOPE], props: NATIVE_PROPS } } : null),
};
const NATIVE_HEADERS = { 'X-Client-Platform': 'ios', 'X-Client-Version': '9.9.9' };

const SNAPSHOT = { schemaVersion: 2, sections: [{ id: 'sec_roof', title: 'Roof', items: [{ id: 'itm_cover', label: 'Roof cover', type: 'rich' }] }] };

async function seed(h: Harness): Promise<void> {
    const now = new Date();
    // The cast is unavoidable: `inspections` has dozens of columns with database defaults that the insert type still lists as required.
    await h.db.insert(schema.inspections).values({
        id: INSPECTION_ID, tenantId: TENANT_ID, inspectorId: INSPECTOR_ID, propertyAddress: '12 Harbor Lane', propertyType: 'single_family',
        date: '2026-11-01', status: 'requested', reportStatus: 'in_progress', paymentStatus: 'unpaid', createdAt: now,
        // Stored as a JSON-encoded string, the way the editor saves it; the routes serve it as an object.
        templateSnapshot: JSON.stringify(SNAPSHOT),
        scheduledStartMs: new Date('2026-11-01T14:00:00Z'), scheduledEndMs: new Date('2026-11-01T16:00:00Z'), confirmedAt: now, addressGeocodedAt: now,
        deviations: [{ id: 'dev-1', area: 'Roof', baselineRequirement: 'Walk the roof surface.', deviation: 'Viewed from the ground.', reason: 'Steep pitch.' }],
    } as never);
    await h.db.insert(schema.tags).values([
        { id: 'tag-1', tenantId: TENANT_ID, name: 'Follow up', color: '#ff0000', isSeed: false, createdAt: now },
        { id: 'tag-2', tenantId: TENANT_ID, name: 'Urgent', color: '#00ff00', isSeed: false, createdAt: now },
    ]);
    await h.db.insert(schema.inspectionItemTagLinks).values({ inspectionId: INSPECTION_ID, itemId: 'itm_cover', tagId: 'tag-2', tenantId: TENANT_ID, createdAt: now });
    await h.db.insert(schema.contractorTypes).values({ id: 'ct-1', tenantId: TENANT_ID, name: 'Licensed Electrician', sortOrder: 1, createdAt: now });
    await h.db.insert(schema.defectCategories).values({ id: 'dc-1', tenantId: TENANT_ID, name: 'Safety', color: '#cc0000', drivesSummary: true, sortOrder: 1, isSeed: false, createdAt: now });
    await h.db.insert(schema.costItems).values({ id: 'cost-1', tenantId: TENANT_ID, inspectionId: INSPECTION_ID, ...COST_ITEM, createdAt: now });
    await h.db.insert(schema.comments).values({ id: 'rec-1', tenantId: TENANT_ID, text: 'Replace the damaged shingles.', category: 'maintenance', section: 'Roof', severity: 'significant', repairSummary: 'Replace the damaged shingles.', createdAt: now });
    await h.db.insert(schema.templates).values({ id: 'tpl-1', tenantId: TENANT_ID, name: 'Standard', schema: { schemaVersion: 2, sections: [] }, version: 1, createdAt: now });
    await h.db.insert(schema.inspectionMediaPool).values({ id: 'media-1', inspectionId: INSPECTION_ID, tenantId: TENANT_ID, r2Key: `${TENANT_ID}/${INSPECTION_ID}/a.jpg`, url: '/a.jpg', uploadedAt: now });
    await h.db.insert(schema.reportSignoff).values({
        id: 'so-1', tenantId: TENANT_ID, inspectionId: INSPECTION_ID, role: 'field_observer', personId: INSPECTOR_ID, name: 'Ivan Inspector', license: 'LIC-1',
        qualificationsRef: 'q-ref', signedAt: now, signatureRef: 'sig-ref', dualRole: false,
    });
    await h.db.insert(schema.documentReviewItems).values({
        id: 'dr-1', tenantId: TENANT_ID, inspectionId: INSPECTION_ID, documentKey: 'pcr', label: 'Prior PCR', requested: true, received: true, reviewed: true,
        na: false, notes: 'Reviewed on site', sortOrder: 1,
    });
    await h.db.insert(schema.inspectionResults).values({
        id: 'res-1', tenantId: TENANT_ID, inspectionId: INSPECTION_ID, lastSyncedAt: now,
        data: { itm_cover: { rating: 'satisfactory', value: 'Intact', notes: 'No visible wear.', photos: [{ key: `${TENANT_ID}/${INSPECTION_ID}/a.jpg` }],
            original: { rating: 'poor', notes: 'Earlier finding.', photos: [{ key: `${TENANT_ID}/${INSPECTION_ID}/old.jpg` }] } } },
    });
    await h.db.insert(schema.inspectorCredentials).values({
        id: 'cred-1', tenantId: TENANT_ID, userId: INSPECTOR_ID, label: 'InterNACHI CPI', memberNumber: '12345', sortOrder: 1, active: true, createdAt: now, updatedAt: now,
    });
}

function jsonType(value: unknown): string {
    return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}

/** The JSON type of the snapshot as it sits in the table (a string when the editor wrote it). */
function storedSnapshotType(h: Harness, id: string): string {
    const row = h.sqlite.prepare('SELECT template_snapshot AS raw FROM inspections WHERE id = ?').get(id) as { raw: string | null } | undefined;
    if (row?.raw == null) return 'null';
    return jsonType(JSON.parse(row.raw));
}

function responseSchema(method: string, path: string, status: number): unknown {
    return contract.paths[path]?.[method]?.responses?.[String(status)]?.content?.['application/json']?.schema;
}

function fill(path: string, vars: Vars): string {
    return path.replace(/\{(\w+)\}/g, (_m, name: string) => vars[name] ?? '');
}

/** Requests every operation through the real application and compares each body with the contract. */
export async function observeAll(): Promise<Observation[]> {
    const h = await createHarness('standalone');
    try {
        await seed(h);
        const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
        const now = Math.floor(Date.now() / 1000);
        const jwt = await signJwt({ sub: OWNER_ID, 'custom:tenantId': TENANT_ID, 'custom:userRole': 'owner', iat: now, exp: now + 3600 }, keyring);
        const vars: Vars = { id: INSPECTION_ID };
        const out: Observation[] = [];
        for (const op of OPERATIONS) {
            const url = fill(op.path, { ...vars, ...op.params?.(vars) }) + (op.path === '/api/client/compat' ? '?platform=ios' : '');
            const native = op.path.startsWith('/api/client/');
            const env = native ? ({ ...h.env, NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: NATIVE_PROVIDER } as typeof h.env) : h.env;
            const headers: Record<string, string> = native ? { authorization: 'Bearer u:g:s', ...NATIVE_HEADERS } : { authorization: `Bearer ${jwt}` };
            if (op.body !== undefined) headers['content-type'] = 'application/json';
            const exec = makeExecutionContext({ label: 'response-conformance' });
            const res = await app.request(url, { method: op.method.toUpperCase(), headers, ...(op.body !== undefined ? { body: JSON.stringify(op.body) } : {}) }, env, exec.ctx);
            await exec.settle();
            const text = await res.text();
            const expected = op.status ?? 200;
            const schemaNode = responseSchema(op.method, op.path, expected);
            let body: unknown = null;
            try { body = JSON.parse(text); } catch { body = null; }
            const checked = res.status === expected && schemaNode !== undefined;
            const served = (body as { data?: { inspection?: { templateSnapshot?: unknown } } } | null)?.data?.inspection;
            const snapshot = !op.path.includes('{id}') || typeof served !== 'object' || served === null || !('templateSnapshot' in served) ? undefined : { served: jsonType(served.templateSnapshot), stored: storedSnapshotType(h, INSPECTION_ID) };
            const components = contract.components?.schemas ?? {};
            const problems = checked ? compareToSchema(body, schemaNode, components) : null;
            if (res.status === expected) op.save?.(body, vars);
            const bodyKeys = body !== null && typeof body === 'object' ? Object.keys(body).length : 0;
            out.push({
                method: op.method, path: op.path, expected, status: res.status, contentType: res.headers.get('content-type') ?? '',
                declared: schemaNode !== undefined, bodyKeys,
                extras: problems?.extras ?? [], missingRequired: problems?.missingRequired ?? [], typeMismatch: problems?.typeMismatch ?? [],
                elements: problems?.elements ?? {}, ...(snapshot === undefined ? {} : { snapshot }), arrays: schemaNode === undefined ? [] : declaredObjectArrays(schemaNode, components),
            });
        }
        return out;
    } finally { h.close(); }
}

/** Groups an observation's extra keys by the object they sit in. */
function groupExtras(o: Pick<Observation, 'extras'>): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const { at, key: k } of o.extras) groups.set(at, [...(groups.get(at) ?? []), k]);
    return groups;
}

const PLACEHOLDERS = new Set(['todo', 'tbd', 'fixme', 'wip', 'later', 'n/a', 'none', 'misc', 'unknown', 'xxx']);

/** Every way the recorded list can be wrong or out of date; empty when it matches what was observed. */
export function checkConformance(observed: readonly Observation[], entries: readonly AllowEntry[]): string[] {
    const problems: string[] = [];
    const seen = new Set<string>();
    const listed = new Map<string, Set<string>>();
    for (const e of entries) {
        const id = `${opKey(e.method, e.path)} @ ${e.at}`;
        if (seen.has(id)) problems.push(`duplicate entry: ${id}`);
        seen.add(id);
        const reason = e.reason.trim();
        if (reason.length < 20 || PLACEHOLDERS.has(reason.toLowerCase())) problems.push(`reason too short or a placeholder: ${id}`);
        if (e.keys.length === 0) problems.push(`entry lists no keys: ${id}`);
        listed.set(id, new Set([...(listed.get(id) ?? []), ...e.keys]));
    }
    const seenKeys = new Map<string, Set<string>>();
    for (const o of observed) {
        for (const missing of o.missingRequired) problems.push(`required key missing: ${opKey(o.method, o.path)} ${missing}`);
        for (const path of o.typeMismatch) problems.push(`value does not fit the declared type: ${opKey(o.method, o.path)} ${path}`);
        for (const [at, keys] of groupExtras(o)) {
            const id = `${opKey(o.method, o.path)} @ ${at}`;
            seenKeys.set(id, new Set(keys));
            for (const k of keys) if (!listed.get(id)?.has(k)) problems.push(`undeclared key not listed: ${id} ${k}`);
        }
    }
    for (const [id, keys] of listed) {
        for (const k of keys) if (!seenKeys.get(id)?.has(k)) problems.push(`stale entry (declared now or no longer returned): ${id} ${k}`);
    }
    return problems;
}

/** The reads that carry money, which a caller without the fees capability must receive without any money key. */
export const MONEY_READS: readonly string[] = [B, `${B}/report-data`, '/api/inspections', `${B}/cost-items`];

export interface MoneyObservation {
    method: string; path: string; status: number;
    /** Every key anywhere in the body that the money naming rule matches (`*Cents`, price, discountAmount, priceOverride, priceSnapshot). */
    moneyKeys: string[];
    missingRequired: string[]; typeMismatch: string[];
    /** The body's top-level keys, so a caller can see the pass read a real body. */
    bodyKeys: number;
}

function collectMoneyKeys(value: unknown, out: Set<string>): void {
    if (Array.isArray(value)) { for (const v of value) collectMoneyKeys(v, out); return; }
    if (value === null || typeof value !== 'object' || value instanceof Date) return;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (isMoneyField(key)) out.add(key);
        collectMoneyKeys(v, out);
    }
}

/**
 * Requests the money-bearing reads once as the company owner and once as an inspector whose inspection-fees capability is switched off,
 * and reports, per read, the status, the shape problems against the schema and every money key found in the body.
 */
export async function observeMoneyReads(as: 'owner' | 'inspector-without-fees'): Promise<MoneyObservation[]> {
    const h = await createHarness('standalone');
    try {
        await seed(h);
        const inspector = as === 'inspector-without-fees';
        if (inspector) await h.db.update(schema.users).set({ permissionOverrides: { inspectionFees: false } }).where(eq(schema.users.id, INSPECTOR_ID));
        const keyring = await buildKeyring(h.env as unknown as Record<string, string | undefined>);
        const now = Math.floor(Date.now() / 1000);
        const jwt = await signJwt({ sub: inspector ? INSPECTOR_ID : OWNER_ID, 'custom:tenantId': TENANT_ID, 'custom:userRole': inspector ? 'inspector' : 'owner', iat: now, exp: now + 3600 }, keyring);
        const out: MoneyObservation[] = [];
        for (const path of MONEY_READS) {
            const exec = makeExecutionContext({ label: 'response-conformance-money' });
            const res = await app.request(fill(path, { id: INSPECTION_ID }), { method: 'GET', headers: { authorization: `Bearer ${jwt}` } }, h.env, exec.ctx);
            await exec.settle();
            let body: unknown = null;
            try { body = JSON.parse(await res.text()); } catch { body = null; }
            const schemaNode = responseSchema('get', path, 200);
            const problems = res.status === 200 && schemaNode !== undefined ? compareToSchema(body, schemaNode, contract.components?.schemas ?? {}) : null;
            const found = new Set<string>();
            collectMoneyKeys(body, found);
            out.push({
                method: 'get', path, status: res.status, moneyKeys: [...found].sort(),
                missingRequired: problems?.missingRequired ?? [], typeMismatch: problems?.typeMismatch ?? [],
                bodyKeys: body !== null && typeof body === 'object' ? Object.keys(body).length : 0,
            });
        }
        return out;
    } finally { h.close(); }
}
