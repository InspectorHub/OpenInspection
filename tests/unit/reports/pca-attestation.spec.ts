// tests/unit/reports/pca-attestation.spec.ts
import { describe, it, expect } from 'vitest';
import { buildAttestationPayload, type SignoffAttestation } from '../../../server/lib/pca-attestation';

const base: SignoffAttestation = {
  inspectionId: 'insp-1', role: 'pcr_reviewer', personId: 'u-1',
  name: 'Jane Reviewer', license: 'PE-12345', signedAt: 1_700_000_000_000,
};

describe('buildAttestationPayload', () => {
  it('is deterministic for the same attestation', () => {
    expect(buildAttestationPayload(base)).toBe(buildAttestationPayload({ ...base }));
  });

  it('is independent of key insertion order', () => {
    const reordered: SignoffAttestation = {
      signedAt: base.signedAt, name: base.name, license: base.license,
      personId: base.personId, role: base.role, inspectionId: base.inspectionId,
    };
    expect(buildAttestationPayload(reordered)).toBe(buildAttestationPayload(base));
  });

  it('changes when any signed field changes (role flip = different bytes)', () => {
    const asObserver = buildAttestationPayload({ ...base, role: 'field_observer' });
    expect(asObserver).not.toBe(buildAttestationPayload(base));
  });

  it('encodes a null license distinctly from an empty string', () => {
    expect(buildAttestationPayload({ ...base, license: null }))
      .not.toBe(buildAttestationPayload({ ...base, license: '' }));
  });
});
