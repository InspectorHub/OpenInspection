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
  const baseSignature = {
    signatureBase64: null,
    signedAt: 1718000000000,
    inspectorName: 'Jane Smith',
    inspectorLicense: 'HI-12345',
  };

  it('returns variant:"image" when published + signatureBase64 present', () => {
    const result = signatureBlockModel({
      isPublished: true,
      signature: { ...baseSignature, signatureBase64: 'data:image/png;base64,abc=' },
      ownerPreview: false,
    });
    expect(result.variant).toBe('image');
    expect(result.signatureBase64).toBe('data:image/png;base64,abc=');
    expect(result.showNudge).toBe(false);
    expect(result.inspectorName).toBe('Jane Smith');
    expect(result.license).toBe('HI-12345');
  });

  it('returns variant:"typed" when published + signature present but signatureBase64 null', () => {
    const result = signatureBlockModel({
      isPublished: true,
      signature: baseSignature,
      ownerPreview: false,
    });
    expect(result.variant).toBe('typed');
    expect(result.showNudge).toBe(false);
    expect(result.inspectorName).toBe('Jane Smith');
    expect(result.license).toBe('HI-12345');
  });

  it('sets showNudge:true when published + no image + ownerPreview:true', () => {
    const result = signatureBlockModel({
      isPublished: true,
      signature: baseSignature,
      ownerPreview: true,
    });
    expect(result.variant).toBe('typed');
    expect(result.showNudge).toBe(true);
  });

  it('does NOT set showNudge when published + image present (even if ownerPreview)', () => {
    const result = signatureBlockModel({
      isPublished: true,
      signature: { ...baseSignature, signatureBase64: 'data:image/png;base64,xyz=' },
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

  it('carries signedAt through for image variant', () => {
    const result = signatureBlockModel({
      isPublished: true,
      signature: { ...baseSignature, signatureBase64: 'data:image/png;base64,abc=', signedAt: 1718000000000 },
      ownerPreview: false,
    });
    expect(result.signedAt).toBe(1718000000000);
  });

  it('carries signedAt through for typed variant', () => {
    const result = signatureBlockModel({
      isPublished: true,
      signature: { ...baseSignature, signedAt: 1718000000000 },
      ownerPreview: false,
    });
    expect(result.signedAt).toBe(1718000000000);
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
