import { zipSync, strToU8 } from 'fflate';
import { r2Keys } from '../lib/r2-keys';

export interface BuildEvidencePackOpts {
    r2: R2Bucket;
    auditTrailJson: string;
    publicKeyPem: string;
    tenantId: string;
    /** Inspection the envelope belongs to — required to form the canonical R2 key. */
    inspectionId: string;
    envelopeId: string;
}

/**
 * Spec 5H P2 — assembles the legally-meaningful evidence pack zip from
 * artifacts already written to R2 by SignCompletionWorkflow:
 *   - signed.pdf            (Step 1 of the workflow)
 *   - certificate.pdf       (Step 2 of the workflow)
 *   - audit-trail.json      (this caller serializes)
 *   - public-key.pem        (the tenant's Ed25519 public key)
 *
 * Returns the zip bytes as an ArrayBuffer so callers can write to R2 or
 * embed in a Resend email attachment.
 */
export async function buildEvidencePack(opts: BuildEvidencePackOpts): Promise<ArrayBuffer> {
    const { r2, auditTrailJson, publicKeyPem, tenantId, inspectionId, envelopeId } = opts;
    const signedObj = await r2.get(r2Keys.agreementFile(tenantId, inspectionId, envelopeId, 'signed.pdf'));
    const certObj = await r2.get(r2Keys.agreementFile(tenantId, inspectionId, envelopeId, 'certificate.pdf'));
    const signedBytes = signedObj
        ? new Uint8Array(await new Response(signedObj.body).arrayBuffer())
        : new Uint8Array();
    const certBytes = certObj
        ? new Uint8Array(await new Response(certObj.body).arrayBuffer())
        : new Uint8Array();
    // OMIT any artifact that is missing/empty rather than writing a 0-byte entry.
    // A 0-byte PDF "opens with an error" in every viewer — strictly worse than
    // its absence (production incident: a failed cert render shipped a 0-byte
    // certificate.pdf the client could not open).
    const entries: Record<string, Uint8Array> = {
        'audit-trail.json': strToU8(auditTrailJson),
        'public-key.pem': strToU8(publicKeyPem),
    };
    if (signedBytes.length > 0) entries['signed.pdf'] = signedBytes;
    if (certBytes.length > 0) entries['certificate.pdf'] = certBytes;
    const zipped = zipSync(entries);
    // Copy into a plain ArrayBuffer (zipped.buffer may be ArrayBufferLike)
    return zipped.buffer.slice(0) as ArrayBuffer;
}
