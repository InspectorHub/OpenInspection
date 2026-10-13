import { describe, it, expect } from 'vitest';
import {
  compareSemver, upgradeStatus, readVersionPolicy, NEVER_BLOCK_PATHS,
} from '../../../server/lib/native/client-version';

describe('compareSemver', () => {
  it('orders numerically, not lexically', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareSemver('1.2.0', '1.2.0')).toBe(0);
    expect(compareSemver('1.2', '1.2.1')).toBeLessThan(0);
  });
});

describe('upgradeStatus', () => {
  const policy = { minSupported: '1.2.0', recommended: '1.4.0', downloadUrl: null };
  it('required below min, recommended below recommended, null otherwise', () => {
    expect(upgradeStatus('1.1.9', policy)).toBe('required');
    expect(upgradeStatus('1.3.0', policy)).toBe('recommended');
    expect(upgradeStatus('1.4.0', policy)).toBeNull();
  });
  it('never blocks when the operator configured nothing', () => {
    expect(upgradeStatus('0.0.1', { minSupported: null, recommended: null, downloadUrl: null })).toBeNull();
  });
  it('treats a missing or unparseable version as not blocking', () => {
    expect(upgradeStatus(undefined, policy)).toBeNull();
    expect(upgradeStatus('garbage', policy)).toBeNull();
  });
  it('ignores an unparseable operator setting instead of blocking everyone', () => {
    expect(upgradeStatus('0.0.1', { minSupported: 'soon', recommended: null, downloadUrl: null })).toBeNull();
  });
});

describe('readVersionPolicy', () => {
  it('reads per-platform env', () => {
    expect(readVersionPolicy({ NATIVE_MIN_VERSION_IOS: '1.0.0' }, 'ios').minSupported).toBe('1.0.0');
    expect(readVersionPolicy({ NATIVE_MIN_VERSION_IOS: '1.0.0' }, 'android').minSupported).toBeNull();
  });
  it('reads recommended version and download url, and treats blank as unset', () => {
    const env = {
      NATIVE_RECOMMENDED_VERSION_WINDOWS: '2.0.0',
      NATIVE_DOWNLOAD_URL_WINDOWS: 'https://example.com/app',
      NATIVE_MIN_VERSION_WINDOWS: '  ',
    };
    expect(readVersionPolicy(env, 'windows')).toEqual({
      minSupported: null, recommended: '2.0.0', downloadUrl: 'https://example.com/app',
    });
  });
});

describe('NEVER_BLOCK_PATHS', () => {
  const blocked = (p: string) => !NEVER_BLOCK_PATHS.some((r) => r.test(p));
  it('lets sync, upload and import through', () => {
    expect(blocked('/api/inspections/abc/collab/ws')).toBe(false);
    expect(blocked('/api/inspections/abc/collab/import')).toBe(false);
    expect(blocked('/api/inspections/abc/media/upload-url')).toBe(false);
    expect(blocked('/api/client/import')).toBe(false);
    expect(blocked('/api/client/session')).toBe(false);
    expect(blocked('/api/client/compat')).toBe(false);
  });
  it('blocks everything else', () => {
    expect(blocked('/api/inspections')).toBe(true);
    expect(blocked('/api/inspections/abc')).toBe(true);
    expect(blocked('/api/client/other')).toBe(true);
  });
});
