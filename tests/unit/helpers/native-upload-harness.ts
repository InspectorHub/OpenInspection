/**
 * Shared harness for the signed-upload specs: the real app over the standalone
 * tenant harness, a native bearer token the OAuth provider resolves, an
 * in-memory R2 bucket that records every object, and a seeded inspection.
 */
import { app } from '../../../server/index';
import { makeExecutionContext } from './exec-ctx';
import * as schema from '../../../server/lib/db/schema';
import { NATIVE_SCOPE, type NativeProps } from '../../../server/lib/auth/native-token';
import { createHarness, INSPECTOR_ID, TENANT_ID, type Harness } from './tenant-email-harness';

export { INSPECTOR_ID, TENANT_ID };
export const OTHER_TENANT_ID = '11111111-0000-4000-8000-0000000000ee';
export const INSPECTION_ID = '44444444-0000-4000-8000-000000000001';
export const OTHER_TENANT_INSPECTION_ID = '44444444-0000-4000-8000-0000000000ee';
export const NATIVE_TOKEN = 'u:g:s';

const nativeProps: NativeProps = {
    kind: 'native', userId: INSPECTOR_ID, tenantId: TENANT_ID, role: 'inspector', lastUsedAt: 0, grantedAt: 0,
};

const provider = {
    unwrapToken: async (t: string) => (t === NATIVE_TOKEN
        ? { scope: [NATIVE_SCOPE], grant: { clientId: 'c', scope: [NATIVE_SCOPE], props: nativeProps } }
        : null),
};

export interface R2Stub {
    store: Map<string, { bytes: Uint8Array; contentType: string }>;
    bucket: R2Bucket;
}

export function makeR2(): R2Stub {
    const store = new Map<string, { bytes: Uint8Array; contentType: string }>();
    const stub = {
        put: async (key: string, body: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) => {
            store.set(key, { bytes: new Uint8Array(body), contentType: opts?.httpMetadata?.contentType ?? '' });
            return {};
        },
        head: async (key: string) => (store.has(key) ? { size: store.get(key)!.bytes.length } : null),
        get: async () => null,
        delete: async (key: string) => { store.delete(key); },
    };
    return { store, bucket: stub as unknown as R2Bucket };
}

export interface UploadHarness {
    h: Harness;
    r2: R2Stub;
    /** Call the real app. `auth` defaults to the native token; pass null for no Authorization header. */
    call: (path: string, init?: RequestInit, opts?: { auth?: string | null; env?: Record<string, unknown> }) => Promise<Response>;
    close: () => void;
}

export async function createUploadHarness(): Promise<UploadHarness> {
    const h = await createHarness('standalone');
    const r2 = makeR2();
    await h.db.insert(schema.tenants).values({
        id: OTHER_TENANT_ID, slug: 'other-uploads', status: 'active', tier: 'free',
        maxUsers: 5, deploymentMode: 'shared', createdAt: new Date(),
    });
    for (const [id, tenantId] of [[INSPECTION_ID, TENANT_ID], [OTHER_TENANT_INSPECTION_ID, OTHER_TENANT_ID]] as const) {
        await h.db.insert(schema.inspections).values({
            id, tenantId, propertyAddress: '7 Upload Road', status: 'requested', date: '2026-06-01', createdAt: new Date(),
        } as typeof schema.inspections.$inferInsert);
    }
    const call: UploadHarness['call'] = async (path, init = {}, opts = {}) => {
        const env = {
            ...h.env, PHOTOS: r2.bucket, NATIVE_CLIENT_ENABLED: 'true', OAUTH_PROVIDER: provider, ...opts.env,
        } as typeof h.env;
        const auth = opts.auth === undefined ? NATIVE_TOKEN : opts.auth;
        const headers = new Headers(init.headers);
        if (auth) headers.set('authorization', `Bearer ${auth}`);
        let body = init.body;
        if (body instanceof FormData) {
            // A real client sends a multipart body with its length; the in-process request does not add one.
            const encoded = new Request('http://x/', { method: 'POST', body });
            headers.set('content-type', encoded.headers.get('content-type') ?? '');
            const bytes = new Uint8Array(await encoded.arrayBuffer());
            if (!headers.has('content-length')) headers.set('content-length', String(bytes.byteLength));
            body = bytes;
        }
        const exec = makeExecutionContext({ label: 'native-upload' });
        const res = await app.request(path, { ...init, body, headers }, env, exec.ctx);
        await exec.settle();
        return res;
    };
    return { h, r2, call, close: () => h.close() };
}

/** A multipart body with one `file` part of the given type. */
export function filePart(type: string, bytes: Uint8Array<ArrayBuffer> = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]), name = 'capture'): FormData {
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type }), name);
    return fd;
}

export function jsonPost(body: unknown): RequestInit {
    return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

/** The `exp` claim of an upload token, in seconds (the payload is base64url JSON before the dot). */
export function tokenExp(token: string): number {
    const payload = token.split('.')[0] ?? '';
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as { exp: number }).exp;
}
