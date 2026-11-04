import { z } from '@hono/zod-openapi';

/** The bytes of a drawn signature sent as bare base64 or a data:image URL, or null when it cannot be decoded or holds nothing. */
function drawingBytes(drawing: string): Uint8Array | null {
    try {
        const bin = atob(drawing.replace(/^data:image\/[a-z]+;base64,/, ''));
        if (bin.length === 0) return null;
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
        return out;
    } catch {
        return null;
    }
}

/** The request field for a drawn signature on both signing doors: an undecodable drawing is a 400 before anything is claimed. */
export const DrawingSchema = z.string().min(1).max(500_000)
    .refine((drawing) => drawingBytes(drawing) !== null, 'The signature is not valid base64 image data.');

/** `sha256:<hex>` of the decoded drawing, as the audit row records it. Null only for an undecodable drawing, which the schema refuses. */
export async function drawingHash(drawing: string): Promise<string | null> {
    const bytes = drawingBytes(drawing);
    if (!bytes) return null;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer));
    return `sha256:${Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
