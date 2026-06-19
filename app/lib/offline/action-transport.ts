/**
 * ActionTransport — ReplayTransport implementation that POSTs queued writes
 * and photos to the inspection-edit route action.
 *
 * ── Transport path: why `replay-write` intent ─────────────────────────────
 *
 * The inspection-edit action normally returns data via React Router's
 * turbo-stream encoding (the single-fetch wire format).  A raw `fetch()` from
 * outside the RR client receives that stream, not a plain JSON body — so a
 * 200 HTTP status is ALWAYS returned even when the inner API call failed
 * (`{ok:false}` is encoded in the stream, invisible to a status-only reader).
 *
 * Options considered:
 *   A. Plain form POST, read HTTP status  — status is always 200; cannot
 *      distinguish success from {ok:false} or 409. ✗
 *   B. Parse the turbo-stream body        — fragile coupling to RR internals. ✗
 *   C. Dedicated `replay-write` intent    — the action branch returns
 *      `Response.json({ ok, apiStatus }, { status: apiStatus })` (RR supports
 *      returning plain Response objects from actions).  The transport reads
 *      `res.status` directly: 200 → success, 409 → conflict, 5xx → error. ✓
 *
 * Path C was chosen.  The `replay-write` and `replay-photo` branches must be
 * added to the route action (see inspection-edit.tsx).
 *
 * ── FormData encoding ─────────────────────────────────────────────────────
 *
 * submitWrite encodes:
 *   intent          = "replay-write"
 *   replayIntent    = w.intent          (original intent, forwarded by action)
 *   inspectionId    = w.inspectionId
 *   itemId          = w.itemId ?? ""
 *   field           = w.field ?? ""
 *   payload         = JSON.stringify(w.payload)
 *
 * submitPhoto encodes:
 *   intent          = "replay-photo"
 *   inspectionId    = p.inspectionId
 *   itemId          = p.itemId
 *   name            = p.name
 *   file            = File([p.blob], p.name)
 */

import type { QueuedWrite, QueuedPhoto, QueuedCrop } from './queue-storage';
import type { ReplayTransport } from './offline-queue';
import { preprocessImage } from '~/components/media-studio/preprocessImage';

// ── Result shape returned by replay-write/replay-photo action branches ─────

interface ReplayActionResult {
    ok: boolean;
    apiStatus?: number;
}

// ── Factory ───────────────────────────────────────────────────────────────

/**
 * Create an ActionTransport.
 *
 * @param fetchImpl  Injected `fetch` implementation (defaults to global
 *                   `fetch`); callers may provide a mock in tests.
 */
export function createActionTransport(
    fetchImpl: typeof fetch = fetch,
): ReplayTransport {
    return {
        submitWrite: (w) => submitWrite(w, fetchImpl),
        submitPhoto: (p) => submitPhoto(p, fetchImpl),
        submitCrop: (c) => submitCrop(c, fetchImpl),
    };
}

// ── Write ─────────────────────────────────────────────────────────────────

async function submitWrite(
    w: QueuedWrite,
    fetchImpl: typeof fetch,
): Promise<{ ok: boolean; status: number }> {
    const body = new FormData();
    body.set('intent', 'replay-write');
    body.set('replayIntent', w.intent);
    body.set('inspectionId', w.inspectionId);
    body.set('itemId', w.itemId ?? '');
    body.set('field', w.field ?? '');
    body.set('payload', JSON.stringify(w.payload));

    const res = await fetchImpl(
        `/inspections/${w.inspectionId}/edit`,
        { method: 'POST', body, credentials: 'include' },
    );

    return mapStatus(res);
}

// ── Photo ─────────────────────────────────────────────────────────────────

async function submitPhoto(
    p: QueuedPhoto,
    fetchImpl: typeof fetch,
): Promise<{ ok: boolean; status: number }> {
    // Task 9c — a baked annotation PNG replays to the annotation endpoint, NOT
    // the plain upload endpoint. The blob is ALREADY the flattened derivative,
    // so it is forwarded verbatim (no preprocessImage re-bake — that is a
    // raw-upload privacy step and would mangle the rendered annotation).
    if (p.derivative?.kind === 'annotation') {
        const body = new FormData();
        body.set('intent', 'replay-annotation');
        body.set('inspectionId', p.inspectionId);
        body.set('itemId', p.itemId);
        body.set('photoIndex', String(p.derivative.photoIndex));
        body.set('nodes', p.derivative.nodes);
        if (p.derivative.sectionId) body.set('sectionId', p.derivative.sectionId);
        body.set('image', new File([p.blob], p.name, { type: 'image/png' }));

        const res = await fetchImpl(
            `/inspections/${p.inspectionId}/edit`,
            { method: 'POST', body, credentials: 'include' },
        );
        return mapStatus(res);
    }

    // N2+N4 — bake at REPLAY (not at enqueue): the queue stores the RAW blob, so
    // a failed-then-retried entry never double-bakes. This runs client-side
    // before the replay form is submitted; the server replay-photo action stays
    // unchanged (it just forwards whatever file it receives). preprocessImage
    // fails open, so the offline path degrades to the raw blob if the canvas
    // path is unavailable — the server env.IMAGES re-encode is the backstop.
    const srcFile = p.blob instanceof File ? p.blob : new File([p.blob], p.name, { type: p.blob.type || 'image/jpeg' });
    const baked = p.originalQuality ? srcFile : await preprocessImage(srcFile);

    const body = new FormData();
    body.set('intent', 'replay-photo');
    body.set('inspectionId', p.inspectionId);
    body.set('itemId', p.itemId);
    body.set('name', p.name);
    body.set('file', baked, p.name);

    const res = await fetchImpl(
        `/inspections/${p.inspectionId}/edit`,
        { method: 'POST', body, credentials: 'include' },
    );

    return mapStatus(res);
}

// ── Crop derivative (Plan 4, offline-capable crop) ────────────────────────
async function submitCrop(
    c: QueuedCrop,
    fetchImpl: typeof fetch,
): Promise<{ ok: boolean; status: number }> {
    const body = new FormData();
    body.set('intent', 'replay-crop');
    body.set('inspectionId', c.inspectionId);
    body.set('itemId', c.itemId);
    body.set('photoIndex', String(c.photoIndex));
    body.set('crop', JSON.stringify(c.crop));
    if (c.sectionId) body.set('sectionId', c.sectionId);
    body.set('file', new File([c.blob], `${c.itemId}_${c.photoIndex}_crop.jpg`, { type: 'image/jpeg' }));

    const res = await fetchImpl(
        `/inspections/${c.inspectionId}/edit`,
        { method: 'POST', body, credentials: 'include' },
    );
    return mapStatus(res);
}

// ── Status mapping ────────────────────────────────────────────────────────

/**
 * Map the raw Response from the `replay-write` / `replay-photo` action branch
 * to the {ok, status} contract expected by OfflineQueue._doReplay().
 *
 * The action returns `Response.json({ok, apiStatus?}, {status: apiStatus})`,
 * so `res.status` is the real API status code, NOT always 200.
 * - 2xx                → { ok: true,  status: res.status }
 * - 409                → { ok: false, status: 409 }        (conflict)
 * - other 4xx / 5xx   → { ok: false, status: res.status }  (active error)
 *
 * We still attempt to read the body for the `ok` flag when available, but
 * HTTP status is the authoritative signal (avoids turbo-stream parsing).
 */
async function mapStatus(
    res: Response,
): Promise<{ ok: boolean; status: number }> {
    const status = res.status;

    if (status >= 200 && status < 300) {
        // Try to parse body to get an explicit `ok: false` if the action says so.
        try {
            const json = (await res.json()) as ReplayActionResult;
            if (json.ok === false) {
                // Action body says it failed even though HTTP says 2xx.
                // Use the apiStatus from the body if present, else treat as 500.
                const apiStatus = typeof json.apiStatus === 'number' ? json.apiStatus : 500;
                return { ok: false, status: apiStatus };
            }
        } catch {
            // Not JSON (e.g. redirected to HTML) — treat HTTP status as truth.
        }
        return { ok: true, status };
    }

    return { ok: false, status };
}
