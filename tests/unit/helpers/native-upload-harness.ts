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

/** One multipart upload held by the stub. */
export interface StubMultipart {
    key: string;
    contentType: string;
    parts: Map<number, { etag: string; bytes: Uint8Array }>;
    state: 'open' | 'aborted' | 'completed';
}

export interface R2Stub {
    store: Map<string, { bytes: Uint8Array; contentType: string }>;
    bucket: R2Bucket;
    /** Every multipart upload ever created, by upload id. */
    uploads: Map<string, StubMultipart>;
    /** When set, `complete` reports this size instead of the real one (to prove the size audit). */
    reportCompleteSize: number | null;
    /** When set, `complete` joins the object and THEN throws this message: the call succeeded but its answer was lost. */
    throwAfterComplete: string | null;
    /** When set, `complete` throws this message before joining anything (a refusal from storage). */
    failComplete: string | null;
}

/** The part-size rule storage enforces on `complete`, approximated: all but the last part equal in size and 5 MiB or more. */
const MIN_PART_BYTES = 5 * 1024 * 1024;

export function makeR2(): R2Stub {
    const store = new Map<string, { bytes: Uint8Array; contentType: string }>();
    const uploads = new Map<string, StubMultipart>();
    const stubState = { reportCompleteSize: null as number | null, throwAfterComplete: null as string | null, failComplete: null as string | null };
    let counter = 0;
    const handle = (key: string, uploadId: string) => {
        const live = () => {
            const u = uploads.get(uploadId);
            if (!u || u.key !== key || u.state !== 'open') throw new Error('The specified multipart upload does not exist. (10024)');
            return u;
        };
        return {
            key, uploadId,
            uploadPart: async (partNumber: number, value: Uint8Array) => {
                const etag = `etag-${++counter}`;
                live().parts.set(partNumber, { etag, bytes: new Uint8Array(value) });
                return { partNumber, etag };
            },
            abort: async () => { live().state = 'aborted'; },
            complete: async (given: { partNumber: number; etag: string }[]) => {
                const u = live();
                if (stubState.failComplete) throw new Error(stubState.failComplete);
                const chosen = given.map((g) => {
                    const part = u.parts.get(g.partNumber);
                    if (!part || part.etag !== g.etag) throw new Error('One or more of the specified parts could not be found. (10025)');
                    return part.bytes;
                });
                chosen.slice(0, -1).forEach((b) => {
                    if (b.length < MIN_PART_BYTES || b.length !== chosen[0]?.length) throw new Error('Part sizes must match and be at least 5 MiB. (10048)');
                });
                const bytes = new Uint8Array(chosen.reduce((n, b) => n + b.length, 0));
                let at = 0;
                for (const b of chosen) { bytes.set(b, at); at += b.length; }
                store.set(key, { bytes, contentType: u.contentType });
                u.state = 'completed';
                if (stubState.throwAfterComplete) throw new Error(stubState.throwAfterComplete);
                return { key, size: stubState.reportCompleteSize ?? bytes.length };
            },
        };
    };
    const stub = {
        put: async (key: string, body: ArrayBuffer | Uint8Array | Blob, opts?: { httpMetadata?: { contentType?: string } }) => {
            const raw = body instanceof Blob ? await body.arrayBuffer() : body;
            store.set(key, { bytes: new Uint8Array(raw), contentType: opts?.httpMetadata?.contentType ?? '' });
            return {};
        },
        head: async (key: string) => (store.has(key) ? { size: store.get(key)!.bytes.length } : null),
        get: async () => null,
        delete: async (key: string) => { store.delete(key); },
        createMultipartUpload: async (key: string, opts?: { httpMetadata?: { contentType?: string } }) => {
            const uploadId = `mpu-${uploads.size + 1}`;
            uploads.set(uploadId, { key, contentType: opts?.httpMetadata?.contentType ?? '', parts: new Map(), state: 'open' });
            return handle(key, uploadId);
        },
        resumeMultipartUpload: (key: string, uploadId: string) => handle(key, uploadId),
    };
    return {
        store, uploads, bucket: stub as unknown as R2Bucket,
        get reportCompleteSize() { return stubState.reportCompleteSize; },
        set reportCompleteSize(v: number | null) { stubState.reportCompleteSize = v; },
        get throwAfterComplete() { return stubState.throwAfterComplete; },
        set throwAfterComplete(v: string | null) { stubState.throwAfterComplete = v; },
        get failComplete() { return stubState.failComplete; },
        set failComplete(v: string | null) { stubState.failComplete = v; },
    };
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
