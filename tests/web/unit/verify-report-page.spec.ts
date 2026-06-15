import { describe, it, expect } from 'vitest';
import { verifyResultModel } from '~/routes/public/v.$token';

describe('verifyResultModel', () => {
  it('returns verified when all checks pass and not legacy', () => {
    const result = verifyResultModel({
      hashValid: true,
      signatureValid: true,
      chainValid: true,
      legacy: false,
      versionNumber: 1,
      publishedAt: 1,
      contentHash: 'h',
      propertyAddressMasked: '••• St',
    });
    expect(result.state).toBe('verified');
    expect(result.versionNumber).toBe(1);
    expect(result.contentHash).toBe('h');
    expect(result.address).toBe('••• St');
  });

  it('returns legacy when legacy flag is true', () => {
    const result = verifyResultModel({ legacy: true });
    expect(result.state).toBe('legacy');
  });

  it('returns failed when signatureValid is false', () => {
    const result = verifyResultModel({
      legacy: false,
      hashValid: true,
      signatureValid: false,
      chainValid: true,
    });
    expect(result.state).toBe('failed');
  });

  it('returns failed when hashValid is false', () => {
    const result = verifyResultModel({
      legacy: false,
      hashValid: false,
      signatureValid: true,
      chainValid: true,
    });
    expect(result.state).toBe('failed');
  });

  it('returns failed when chainValid is false', () => {
    const result = verifyResultModel({
      legacy: false,
      hashValid: true,
      signatureValid: true,
      chainValid: false,
    });
    expect(result.state).toBe('failed');
  });

  it('passes through metadata fields', () => {
    const result = verifyResultModel({
      legacy: false,
      hashValid: true,
      signatureValid: true,
      chainValid: true,
      versionNumber: 3,
      publishedAt: 1718323200,
      contentHash: 'abc123',
      propertyAddressMasked: '••• Main St',
    });
    expect(result.versionNumber).toBe(3);
    expect(result.publishedAt).toBe(1718323200);
    expect(result.contentHash).toBe('abc123');
    expect(result.address).toBe('••• Main St');
  });

  it('notPublished overrides to a not_published state', () => {
    const m = verifyResultModel({ legacy: false, hashValid: true, signatureValid: true, chainValid: true, notPublished: true } as any);
    expect(m.state).toBe('not_published');
  });

  it('published verified report still verifies', () => {
    const m = verifyResultModel({ legacy: false, hashValid: true, signatureValid: true, chainValid: true, notPublished: false } as any);
    expect(m.state).toBe('verified');
  });
});
