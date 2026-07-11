// server/lib/pca-attestation.ts

/**
 * Commercial PCA Phase M — the canonical signature payload for a dual sign-off
 * attestation. The Ed25519 signature (signature_ref) is computed over the string
 * this returns. It MUST be deterministic and order-independent so the public
 * verifier reproduces identical bytes from the stored fields. A separate
 * attestation per role means one person holding both roles produces two distinct
 * payloads (the role field differs), hence two valid signatures (§7.6 dual-role).
 */
export interface SignoffAttestation {
  inspectionId: string;
  role: 'field_observer' | 'pcr_reviewer';
  personId: string;
  name: string;
  license: string | null;
  signedAt: number;
}

export function buildAttestationPayload(a: SignoffAttestation): string {
  // Versioned, fixed field order, explicit null sentinel so null !== "".
  // SEP / NULL_SENTINEL use printable tokens that cannot occur in the signed
  // fields (no embedded newlines in names/licenses), keeping the payload an
  // unambiguous, collision-free concatenation.
  const SEP = '|~|';
  const NULL_SENTINEL = '<null>';
  const fields = [
    'pca-signoff-v1',
    a.inspectionId,
    a.role,
    a.personId,
    a.name,
    a.license === null ? NULL_SENTINEL : a.license,
    String(a.signedAt),
  ];
  return fields.join(SEP);
}
