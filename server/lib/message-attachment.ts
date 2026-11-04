/**
 * Message attachments: storing an upload, and deciding whether a descriptor sent back with a message is one of this company's
 * uploads for this inspection.
 *
 * The upload routes answer with a descriptor ({ id, key, name, size, type, uploadedAt }) and the sender posts it back when it
 * sends the message. The key in a posted descriptor is later what the download route reads from storage, so it is accepted only
 * when it is exactly the key the upload route produces: this company's folder, this inspection's subfolder, the attachment's own
 * id and a short extension. A key naming any other object (another company's, another inspection's, a photo) is refused.
 *
 * Only the key is taken from the posted descriptor. The name, type and size that go onto the message are read back from the stored
 * object, not the values posted with the message, so what a recipient is shown and served is what the upload stored.
 */
import { Errors } from './errors';
import { detectMime } from './file-validation';
import { r2Keys } from './r2-keys';
import { logger } from './logger';

const ATTACHMENT_ID = /^[A-Za-z0-9-]{1,64}$/;
const EXTENSION = /^[a-z0-9]{1,8}$/;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_NAME = 255;

/** A name cut to `max` characters by code point, so an emoji or other pair at the cut is kept whole or dropped whole. */
const truncateName = (name: string, max: number): string => Array.from(name).slice(0, max).join('');

/** The string with each unpaired surrogate replaced by U+FFFD, which `encodeURIComponent` would otherwise refuse. */
const wellFormed = (text: string): string => text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd');

/** A name that is safe to keep and to send: well formed, and at most MAX_NAME code points. */
const cleanName = (name: string): string => truncateName(wellFormed(name), MAX_NAME);

/** R2 failed on a call the caller cannot influence; the object is neither missing nor refused. The cause is logged, not sent. */
function storageUnavailable(op: 'put' | 'head' | 'get', cause: unknown) {
    logger.warn('message attachment storage failed', { op, cause: cause instanceof Error ? cause.message : String(cause) });
    return Errors.ServiceUnavailable('Attachment storage is unavailable. Try again shortly.');
}

interface AttachmentDescriptor { id: string; key: string; name: string; size: number; type: string; uploadedAt: number }

/** Validate and persist a multipart attachment under the inspection it is for; returns the descriptor. */
export async function storeAttachment(
    photos: R2Bucket | undefined,
    file: File | undefined,
    tenantId: string,
    inspectionId: string,
): Promise<AttachmentDescriptor> {
    if (!file) throw Errors.BadRequest('file required');
    if (file.size > MAX_BYTES) throw Errors.BadRequest('file too large (max 10MB)');
    const buf = new Uint8Array(await file.arrayBuffer());
    const detected = detectMime(buf);
    if (!detected && !file.name.toLowerCase().endsWith('.heic')) throw Errors.BadRequest('unsupported file type');
    const id = crypto.randomUUID();
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
    const key = r2Keys.messageAttachment(tenantId, inspectionId, id, ext);
    if (!photos) throw Errors.BadRequest('Storage not available');
    // The name is kept with the object: it is what a download is named after, regardless of the posted value. The type is the
    // sniffed one; the one case with none, a .heic file, is stored as image/heic and not as whatever the client declared.
    const type = detected ?? 'image/heic';
    const name = cleanName(file.name);
    await photos.put(key, buf, { httpMetadata: { contentType: type }, customMetadata: { originalName: name } })
        .catch((cause) => { throw storageUnavailable('put', cause); });
    return { id, key, name, size: file.size, type, uploadedAt: Date.now() };
}

/** True when every posted descriptor names the key the upload route would have produced for this company and inspection. */
function attachmentsAreOwn(attachments: ReadonlyArray<{ id: string; key: string }>, tenantId: string, inspectionId: string): boolean {
    return attachments.every((attachment) => {
        if (!ATTACHMENT_ID.test(attachment.id)) return false;
        const ext = attachment.key.slice(attachment.key.lastIndexOf('.') + 1);
        return EXTENSION.test(ext) && attachment.key === r2Keys.messageAttachment(tenantId, inspectionId, attachment.id, ext);
    });
}

export interface StoredAttachment { id: string; key: string; name: string; size: number; type: string; uploadedAt: number }

/**
 * The descriptors to store on a message, rebuilt from the objects themselves, or null when any posted descriptor is not one of
 * this company's uploads for this inspection, names the same upload twice, or its object is missing. Throws a 503 when storage
 * cannot be read.
 */
export async function verifyAttachments(
    photos: R2Bucket | undefined,
    posted: ReadonlyArray<{ id: string; key: string }>,
    tenantId: string,
    inspectionId: string,
): Promise<StoredAttachment[] | null> {
    if (posted.length === 0) return [];
    if (!photos || !attachmentsAreOwn(posted, tenantId, inspectionId)) return null;
    if (new Set(posted.map((attachment) => attachment.id)).size !== posted.length) return null;
    const out: StoredAttachment[] = [];
    for (const attachment of posted) {
        const head = await photos.head(attachment.key).catch((cause) => { throw storageUnavailable('head', cause); });
        if (!head) return null;
        out.push({
            id: attachment.id,
            key: attachment.key,
            name: cleanName(head.customMetadata?.originalName ?? '') || 'attachment',
            size: head.size,
            type: head.httpMetadata?.contentType || 'application/octet-stream',
            uploadedAt: head.uploaded instanceof Date ? head.uploaded.getTime() : Date.now(),
        });
    }
    return out;
}

/** True when a stored attachment key sits in this company's message folder; a download is refused for any other key. */
function attachmentKeyIsServable(key: string, tenantId: string): boolean {
    return key.startsWith(`${tenantId}/messages/`) && !key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

/** The Content-Disposition for a download: an ASCII fallback name plus the exact name in the RFC 5987 form. */
function dispositionFor(name: string): string {
    const clean = truncateName(Array.from(wellFormed(name || 'attachment'), (ch) => (ch.charCodeAt(0) < 32 || ch === '\x7f' || ch === '/' || ch === '\\' ? '_' : ch)).join(''), MAX_NAME);
    const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%]/g, '_');
    const encoded = encodeURIComponent(clean).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * A stored attachment as a download. The type comes from the stored object only, a download never sniffs, and the name is sent
 * in a form that survives any character. Null when the key is outside the company's message folder or the object is missing.
 * Throws a 503 when storage cannot be read.
 */
export async function serveAttachment(photos: R2Bucket | undefined, att: { key: string; name: string }, tenantId: string): Promise<Response | null> {
    if (!photos || !attachmentKeyIsServable(att.key, tenantId)) return null;
    const obj = await photos.get(att.key).catch((cause) => { throw storageUnavailable('get', cause); });
    if (!obj) return null;
    const headers = new Headers();
    headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Content-Disposition', dispositionFor(att.name));
    headers.set('Cache-Control', 'private, max-age=300');
    if (obj.httpEtag) headers.set('etag', obj.httpEtag);
    return new Response(obj.body, { status: 200, headers });
}
