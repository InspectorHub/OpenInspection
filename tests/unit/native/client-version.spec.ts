import { describe, it, expect } from 'vitest';
import {
  compareSemver, upgradeStatus, readVersionPolicy, isNeverBlocked,
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

describe('NEVER_BLOCK_RULES', () => {
  const blocked = (method: string, p: string) => !isNeverBlocked(method, p);
  it('lets sync, upload and import through, whatever the method', () => {
    for (const method of ['GET', 'POST']) {
      expect(blocked(method, '/api/inspections/abc/collab/ws')).toBe(false);
      expect(blocked(method, '/api/inspections/abc/collab/import')).toBe(false);
      expect(blocked(method, '/api/inspections/abc/media/upload-url')).toBe(false);
      expect(blocked(method, '/api/client/import')).toBe(false);
      expect(blocked(method, '/api/client/session')).toBe(false);
      expect(blocked(method, '/api/client/compat')).toBe(false);
    }
  });
  it('lets the ticket, the inspection presence socket and video upload calls through', () => {
    expect(blocked('POST', '/api/inspections/abc/collab/ticket')).toBe(false);
    expect(blocked('GET', '/api/inspections/abc/presence/ws')).toBe(false);
    expect(blocked('POST', '/api/inspections/abc/media/video/create-upload')).toBe(false);
    expect(blocked('POST', '/api/inspections/abc/media/video/finalize')).toBe(false);
    expect(blocked('POST', '/api/inspections/abc/media/video/r2-upload')).toBe(false);
    expect(blocked('POST', '/api/inspections/abc/media/video/r2-upload-poster')).toBe(false);
    expect(blocked('POST', '/api/public/uploads/photo')).toBe(false);
    expect(blocked('POST', '/api/public/uploads/video')).toBe(false);
  });
  it('lets the three REST writes that hand over a captured inspection through, by method', () => {
    expect(blocked('POST', '/api/inspections')).toBe(false);
    expect(blocked('PATCH', '/api/inspections/abc')).toBe(false);
    expect(blocked('POST', '/api/inspections/abc/complete')).toBe(false);
    expect(blocked('post', '/api/inspections')).toBe(false);
  });
  it('still blocks the reads and every other verb on those same paths', () => {
    expect(blocked('GET', '/api/inspections')).toBe(true);
    expect(blocked('GET', '/api/inspections/abc')).toBe(true);
    expect(blocked('DELETE', '/api/inspections/abc')).toBe(true);
    expect(blocked('PUT', '/api/inspections/abc')).toBe(true);
    expect(blocked('GET', '/api/inspections/abc/complete')).toBe(true);
    expect(blocked('PATCH', '/api/inspections')).toBe(true);
  });
  it('does not let a bulk update through: PATCH /api/inspections/bulk is a fixed route, not an inspection id (positive control: a real id)', () => {
    expect(blocked('PATCH', '/api/inspections/bulk')).toBe(true);
    expect(blocked('patch', '/api/inspections/bulk')).toBe(true);
    expect(blocked('PATCH', '/api/inspections/bulk1')).toBe(false);
    expect(blocked('PATCH', '/api/inspections/abc')).toBe(false);
  });
  it('no longer lists the tenant presence socket (it has no ticket path for a WebView)', () => {
    expect(blocked('GET', '/api/tenant/presence/ws')).toBe(true);
  });
  it('still blocks neighbouring paths that are not part of capture or sync', () => {
    expect(blocked('POST', '/api/inspections/abc/media/video')).toBe(true);
    expect(blocked('POST', '/api/inspections/abc/media/video/delete')).toBe(true);
    expect(blocked('POST', '/api/inspections/abc/collab/ticket/extra')).toBe(true);
    expect(blocked('GET', '/api/tenant/settings')).toBe(true);
    expect(blocked('POST', '/api/inspections/abc/other')).toBe(true);
  });
  it('blocks everything else', () => {
    expect(blocked('GET', '/api/client/other')).toBe(true);
    expect(blocked('POST', '/api/inspections/abc')).toBe(true);
  });
});
