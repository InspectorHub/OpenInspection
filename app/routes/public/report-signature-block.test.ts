// tests/web/unit/report-signature-block.spec.ts
//
// TDD for signatureBlockModel + verificationBlockModel exported from
// app/routes/public/report-card-stack.tsx (Task: report signature + verification UI).
//
// These are pure helpers with no React / router dependencies, so they can be
// imported and exercised directly without a full render harness.

import { describe, it, expect } from 'vitest';
import {
  signatureBlockModel,
  verificationBlockModel,
} from '~/routes/public/report-card-stack';

/* ------------------------------------------------------------------ */
/* signatureBlockModel */
/* ------------------------------------------------------------------ */

describe('signatureBlockModel', () => {
  // review decision (2026-08-15). The previous version of this spec asserted
  // that a published report with NO signature image renders variant "typed" —
  // the inspector's name set as a signature, captioned "Electronically signed
  // by". It pinned the defect as a feature, with a test name that read like one,
  // which is why nothing caught it: production had 7 published reports and all 7
  // took that branch.
  //
  // The invariant now is one sentence: never synthesize a signature from a
  // person's name.
  const baseSignature = {
    method: 'none' as const,
    signatureBase64: null,
    signedAt: 1718000000000,
    inspectorName: 'Jane Smith',
    inspectorLicense: 'HI-12345',
  };

  it('renders the inspector signature when they signed', () => {
    const result = signatureBlockModel({
      isPublished: true,
      signature: { ...baseSignature, method: 'manual', signatureBase64: 'data:image/png;base64,abc=' },
      ownerPreview: false,
    });
    expect(result.variant).toBe('image');
    expect(result.signatureBase64).toBe('data:image/png;base64,abc=');
    expect(result.showNudge).toBe(false);
    expect(result.inspectorName).toBe('Jane Smith');
    expect(result.license).toBe('HI-12345');
  });

  it('ATTRIBUTES authorship — and claims no signature — when nobody signed', () => {
    const result = signatureBlockModel({
      isPublished: true,
      signature: baseSignature,
      ownerPreview: false,
    });
    expect(result.variant).toBe('attribution');
    // The name is a name. Nothing is handed to the renderer that it could draw
    // as a signature, and no timestamp is offered for a signing that never was.
    expect(result.signatureBase64).toBeFalsy();
    expect(result.signedAt).toBeNull();
    expect(result.inspectorName).toBe('Jane Smith');
  });

  it('distinguishes an automatically applied signature from a hand-applied one', () => {
    const auto = signatureBlockModel({
      isPublished: true,
      signature: { ...baseSignature, method: 'authorized_auto', signatureBase64: 'data:image/png;base64,xyz=' },
      ownerPreview: false,
    });
    // Same image, same person. Different provenance, and the document says so —
    // the reader should not take a standing authorisation for an act at
    // publication time.
    expect(auto.variant).toBe('auto');
    expect(auto.signatureBase64).toBe('data:image/png;base64,xyz=');
    const manual = signatureBlockModel({
      isPublished: true,
      signature: { ...baseSignature, method: 'manual', signatureBase64: 'data:image/png;base64,xyz=' },
      ownerPreview: false,
    });
    expect(manual.variant).toBe('image');
    expect(auto.variant).not.toBe(manual.variant);
  });

  it('still nudges the OWNER to upload a signature, without claiming one to the reader', () => {
    const result = signatureBlockModel({
      isPublished: true,
      signature: baseSignature,
      ownerPreview: true,
    });
    expect(result.variant).toBe('attribution');
    expect(result.showNudge).toBe(true);
  });

  it('does NOT set showNudge when a signature exists (even if ownerPreview)', () => {
    const result = signatureBlockModel({
      isPublished: true,
      signature: { ...baseSignature, method: 'manual', signatureBase64: 'data:image/png;base64,xyz=' },
      ownerPreview: true,
    });
    expect(result.variant).toBe('image');
    expect(result.showNudge).toBe(false);
  });

  it('returns variant:"draft" when !isPublished (signature present)', () => {
    const result = signatureBlockModel({
      isPublished: false,
      signature: baseSignature,
      ownerPreview: false,
    });
    expect(result.variant).toBe('draft');
    expect(result.showNudge).toBe(false);
  });

  it('returns variant:"draft" when signature is null', () => {
    const result = signatureBlockModel({
      isPublished: true,
      signature: null,
      ownerPreview: false,
    });
    expect(result.variant).toBe('draft');
    expect(result.showNudge).toBe(false);
  });

  it('carries signedAt through when there was a signing to timestamp', () => {
    const result = signatureBlockModel({
      isPublished: true,
      signature: { ...baseSignature, method: 'manual', signatureBase64: 'data:image/png;base64,abc=', signedAt: 1718000000000 },
      ownerPreview: false,
    });
    expect(result.signedAt).toBe(1718000000000);
  });

  it('DROPS a signedAt that arrives on an unsigned report', () => {
    // This spec used to assert the opposite, and that is the whole point: a
    // timestamp on a report nobody signed dates an event that did not happen.
    // Publishing writes a timestamp readily; signing is what has to earn one.
    const result = signatureBlockModel({
      isPublished: true,
      signature: { ...baseSignature, signedAt: 1718000000000 },
      ownerPreview: false,
    });
    expect(result.variant).toBe('attribution');
    expect(result.signedAt).toBeNull();
  });

  it('license is null when inspectorLicense is null', () => {
    const result = signatureBlockModel({
      isPublished: true,
      signature: { ...baseSignature, inspectorLicense: null },
      ownerPreview: false,
    });
    expect(result.license).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* verificationBlockModel */
/* ------------------------------------------------------------------ */

describe('verificationBlockModel', () => {
  const baseVerification = {
    versionNumber: 3,
    contentHash: 'abcdef0123456789',
    verifyToken: 'tok_abc123',
    publishedAt: 1718000000,
  };

  it('returns show:true with correct fields when verification present', () => {
    const result = verificationBlockModel(
      { verification: baseVerification },
      'https://app.inspectorhub.io',
    );
    expect(result.show).toBe(true);
    expect(result.verifyUrl).toBe('https://app.inspectorhub.io/v/tok_abc123');
    expect(result.shortHash).toBe('abcdef01');
    expect(result.versionNumber).toBe(3);
    expect(result.publishedAt).toBe(1718000000);
  });

  it('shortHash is exactly 8 chars', () => {
    const result = verificationBlockModel(
      { verification: { ...baseVerification, contentHash: '0123456789abcdef' } },
      'https://app.inspectorhub.io',
    );
    expect(result.shortHash).toHaveLength(8);
    expect(result.shortHash).toBe('01234567');
  });

  it('returns show:false when verification is null', () => {
    const result = verificationBlockModel(
      { verification: null },
      'https://app.inspectorhub.io',
    );
    expect(result.show).toBe(false);
    expect(result.verifyUrl).toBe('');
    expect(result.shortHash).toBe('');
    expect(result.versionNumber).toBe(0);
    expect(result.publishedAt).toBe(0);
  });

  it('builds verifyUrl correctly with a trailing-slash base', () => {
    const result = verificationBlockModel(
      { verification: baseVerification },
      'https://example.com',
    );
    expect(result.verifyUrl).toBe('https://example.com/v/tok_abc123');
  });
});
