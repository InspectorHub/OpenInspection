/**
 * Pure formatting helpers the email send path uses on its way to a provider.
 *
 * Carved out of `base.ts` when the cooling-window gate pushed that file past the
 * 400-line ceiling. The split is not arbitrary: none of these touches the
 * service, its dependencies or its state — they are string and buffer
 * transforms, and `escapeHtml` already had a consumer outside this directory
 * (`server/api/agreements-render.ts` takes it as a parameter). Keeping them in a
 * class file made that borrowing look like a reach into a service.
 */
import { inspectorSignature, type SignatureUser } from '../../lib/inspector-signature';

export function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Sprint B-4 — when callers pass `inspector` + `host`, every customer-facing
 * automation appends the inspector's business-card signature to its HTML body
 * so customers can rebook with that specific inspector by clicking the link.
 * Legacy callers that omit the args get the unmodified body (no signature).
 */
export function appendSignature(html: string, inspector?: SignatureUser, host?: string): string {
    if (!inspector || !host) return html;
    const sig = inspectorSignature(inspector, host);
    return html + sig.html;
}

/**
 * Chunked because `String.fromCharCode(...bytes)` blows the argument limit on a
 * large attachment; 0x8000 is comfortably under it on every runtime we target.
 */
export function arrayBufferToBase64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}
