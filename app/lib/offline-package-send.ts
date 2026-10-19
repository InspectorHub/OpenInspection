/**
 * Browser transport for importing an offline data package: the `Send` that
 * `runImport` (`@core/offline-package`) calls once per part.
 *
 * This is a component-level same-origin `fetch`, an accepted exception to the
 * "loaders and actions first" rule, for three reasons:
 *  - A package is up to 24 MiB. Routing it through a React Router action would
 *    make the SSR worker hold the form data (`formData()` keeps several copies)
 *    and add the session and loader revalidation work on top of an import that
 *    already spends most of the request's subrequest budget.
 *  - The request must carry a `Content-Length`, which the server requires. A
 *    `Blob` body lets the browser set it; this file never sets it by hand.
 *  - The session is the HttpOnly cookie, which a same-origin request carries
 *    (`credentials: 'same-origin'`). No bearer token is involved.
 *
 * The caller owns the same-frame guard (the import page runs the whole import
 * behind `useActionLatch`); this module only sends.
 *
 * Contract with `runImport`: a refusal is a RESULT (status, code, details,
 * body); only a request that got no answer at all (network failure, timeout,
 * abort) rejects, and `runImport` then sends the part again, which is safe
 * because an import is idempotent.
 */
import { IMPORT_LIMIT_CEILINGS, type SendResult } from '@core/offline-package';

export const IMPORT_PATH = '/api/client/import';
export const DEFAULT_SEND_TIMEOUT_MS = 120_000;
/** Longest piece of a non-JSON answer kept in `body`. */
const MAX_TEXT_BODY_CHARS = 2000;

export interface SendOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Code and details from the server's `{ error: { code, details } }` shape, when the body has one. */
function errorFieldsOf(body: unknown): Pick<SendResult, 'code' | 'details'> {
    if (!isRecord(body) || !isRecord(body.error)) return {};
    const { code, details } = body.error;
    return {
        ...(typeof code === 'string' ? { code } : {}),
        ...(details !== undefined ? { details } : {}),
    };
}

export async function sendOfflinePackage(bytes: Uint8Array, opts: SendOptions = {}): Promise<SendResult> {
    const max = IMPORT_LIMIT_CEILINGS.compressedBytes;
    // The server answers 413 for this without reading it; do not upload what cannot be accepted.
    if (bytes.byteLength > max) {
        return { status: 413, code: 'PACKAGE_TOO_LARGE', details: { limit: 'compressedBytes', max, actual: bytes.byteLength } };
    }

    const doFetch = opts.fetchImpl ?? fetch;
    const controller = new AbortController();
    const onAbort = (): void => controller.abort(opts.signal?.reason);
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Import request timed out')), opts.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS);

    try {
        const response = await doFetch(IMPORT_PATH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/zip', Accept: 'application/json' },
            body: new Blob([bytes as BlobPart], { type: 'application/zip' }),
            credentials: 'same-origin',
            signal: controller.signal,
        });
        const text = await response.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            // Not JSON (a proxy or gateway page): keep a bounded piece of it and let the classifier
            // decide from the status. A 200 like this is never read as a confirmation.
            return { status: response.status, body: text.slice(0, MAX_TEXT_BODY_CHARS) };
        }
        return { status: response.status, ...errorFieldsOf(parsed), body: parsed };
    } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
    }
}
