import { describe, it, expect } from 'vitest';
import { buildPortalUrl } from '../../server/lib/portal-urls';

describe('buildPortalUrl', () => {
  it('points at the tenant-scoped portal hub with token; omits to= for overview', () => {
    expect(buildPortalUrl('https://app.x.io', 'acme', 'insp1', 'tok9'))
      .toBe('https://app.x.io/portal/acme/i/insp1?token=tok9');
  });
  it('adds to=<section> for non-overview sections', () => {
    expect(buildPortalUrl('https://app.x.io', 'acme', 'insp1', 'tok9', 'report'))
      .toBe('https://app.x.io/portal/acme/i/insp1?token=tok9&to=report');
  });
  it('strips a trailing slash on baseUrl', () => {
    expect(buildPortalUrl('https://app.x.io/', 'acme', 'insp1', 'tok9'))
      .toBe('https://app.x.io/portal/acme/i/insp1?token=tok9');
  });

  // Regression: the report-ready email must carry an ABSOLUTE link (scheme +
  // host) so mail clients treat it as a URL, not a relative path. The prior
  // bug was the *caller* wiring (inspections.ts passed getBookingHost(c), a
  // bare host, where buildPortalUrl expects a full origin). buildPortalUrl
  // does not invent a scheme, so its baseUrl MUST already include one — this
  // test pins the contract that protects the fixed call sites.
  it('keeps the link absolute (starts with http) when given a full origin', () => {
    const url = buildPortalUrl('https://app.x.io', 'acme', 'insp1', 'tok9');
    expect(url.startsWith('http')).toBe(true);
    expect(new URL(url).protocol).toMatch(/^https?:$/);
  });

  it('produces a scheme-less (broken) link when given a BARE host — documents the prior caller bug', () => {
    // This is the old buggy behavior: passing a bare host yields a relative-looking
    // value with no scheme. The fix was at the call site (getBaseUrl, not getBookingHost).
    const url = buildPortalUrl('inspectorhub.io', 'acme', 'insp1', 'tok9');
    expect(url.startsWith('http')).toBe(false);
  });
});
