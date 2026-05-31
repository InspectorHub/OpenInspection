import { describe, it, expect, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildEvidencePack } from '../../server/services/evidence-pack.service';

describe('buildEvidencePack', () => {
  it('zips signed.pdf + certificate.pdf + audit-trail.json + public-key.pem', async () => {
    const r2 = {
      get: vi.fn(async (key: string) => {
        if (key.endsWith('signed.pdf')) return { body: new Uint8Array([1, 2, 3]).buffer };
        if (key.endsWith('certificate.pdf')) return { body: new Uint8Array([4, 5, 6]).buffer };
        return null;
      }),
    } as unknown as R2Bucket;
    const zip = await buildEvidencePack({
      r2,
      auditTrailJson: '{"events":[]}',
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nABC\n-----END PUBLIC KEY-----',
      tenantId: 'tA',
      envelopeId: 'eA',
    });
    const unzipped = unzipSync(new Uint8Array(zip));
    expect(Object.keys(unzipped).sort()).toEqual([
      'audit-trail.json',
      'certificate.pdf',
      'public-key.pem',
      'signed.pdf',
    ]);
    expect(strFromU8(unzipped['audit-trail.json'])).toBe('{"events":[]}');
    expect(unzipped['signed.pdf']).toEqual(new Uint8Array([1, 2, 3]));
    expect(unzipped['certificate.pdf']).toEqual(new Uint8Array([4, 5, 6]));
    expect(strFromU8(unzipped['public-key.pem'])).toContain('PUBLIC KEY');
  });

  it('still zips when one PDF is missing (writes empty entry)', async () => {
    const r2 = {
      get: vi.fn(async (key: string) => {
        if (key.endsWith('signed.pdf')) return { body: new Uint8Array([7, 8]).buffer };
        return null;
      }),
    } as unknown as R2Bucket;
    const zip = await buildEvidencePack({
      r2,
      auditTrailJson: '{}',
      publicKeyPem: 'PEM',
      tenantId: 't', envelopeId: 'e',
    });
    const unzipped = unzipSync(new Uint8Array(zip));
    expect(unzipped['certificate.pdf'].length).toBe(0);
    expect(unzipped['signed.pdf']).toEqual(new Uint8Array([7, 8]));
  });
});
