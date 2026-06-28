/**
 * Per-tenant legal pages (TFV/A2P compliance URLs).
 *
 * Tests the loader and pure helpers from `routes/public/legal.tsx`:
 *   - /legal/<slug>/privacy → 200, contains company name + SMS clause
 *   - /legal/<slug>/terms  → 200, contains company name
 *   - unknown tenant       → 404
 *   - unknown doc type     → 404
 *   - mergeCompany()       → replaces {{company}} token
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock resolveTenantBrand so tests don't need a real Hono context or D1.
// ---------------------------------------------------------------------------
const mockResolveTenantBrand = vi.fn();

vi.mock('~/lib/tenant-brand.server', () => ({
  resolveTenantBrand: (...args: unknown[]) => mockResolveTenantBrand(...args),
}));

import {
  loader,
  mergeCompany,
  SMS_CLAUSE_TEXT,
  SMS_CLAUSE_HEADING,
} from '~/routes/public/legal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LoaderArgs = Parameters<typeof loader>[0];

function makeArgs(tenant: string, doc: string): LoaderArgs {
  return {
    request: new Request(`http://app.test/legal/${tenant}/${doc}`),
    context: {} as never,
    params: { tenant, doc },
  } as unknown as LoaderArgs;
}

/** Calls the loader and asserts it throws a Response with the given status. */
async function expect404(args: LoaderArgs) {
  let thrown: unknown;
  try {
    await loader(args);
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(Response);
  expect((thrown as Response).status).toBe(404);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockResolveTenantBrand.mockReset();
});

// ---------------------------------------------------------------------------
// mergeCompany — pure helper
// ---------------------------------------------------------------------------

describe('mergeCompany', () => {
  it('replaces {{company}} with the provided name', () => {
    expect(mergeCompany('Hello {{company}}!', 'Acme Inspections')).toBe(
      'Hello Acme Inspections!',
    );
  });

  it('replaces multiple occurrences', () => {
    expect(mergeCompany('{{company}} is {{company}}.', 'Foo Corp')).toBe(
      'Foo Corp is Foo Corp.',
    );
  });

  it('falls back to [Your Company] when name is null', () => {
    expect(mergeCompany('Hello {{company}}', null)).toBe(
      'Hello [Your Company]',
    );
  });

  it('leaves text unchanged when there is no token', () => {
    expect(mergeCompany('No token here.', 'Acme')).toBe('No token here.');
  });
});

// ---------------------------------------------------------------------------
// SMS clause constants — must contain Twilio-required strings
// ---------------------------------------------------------------------------

describe('SMS_CLAUSE_TEXT', () => {
  it('contains the STOP opt-out keyword', () => {
    expect(SMS_CLAUSE_TEXT).toMatch(/\bSTOP\b/);
  });

  it('contains the HELP keyword', () => {
    expect(SMS_CLAUSE_TEXT).toMatch(/\bHELP\b/);
  });

  it('contains "message and data rates may apply" (Twilio required)', () => {
    expect(SMS_CLAUSE_TEXT.toLowerCase()).toContain(
      'message and data rates may apply',
    );
  });

  it('mentions Twilio, Inc. as the provider', () => {
    expect(SMS_CLAUSE_TEXT).toContain('Twilio, Inc.');
  });

  it('contains the "not sell or share" no-transfer clause', () => {
    expect(SMS_CLAUSE_TEXT.toLowerCase()).toMatch(/do not sell or share/);
  });

  it('heading is "SMS & Text Messaging"', () => {
    expect(SMS_CLAUSE_HEADING).toBe('SMS & Text Messaging');
  });
});

// ---------------------------------------------------------------------------
// loader — known tenant, privacy
// ---------------------------------------------------------------------------

describe('loader /legal/:tenant/privacy', () => {
  beforeEach(() => {
    mockResolveTenantBrand.mockResolvedValue({
      companyName: 'Acme Inspections',
      primaryColor: null,
      logoUrl: null,
    });
  });

  it('returns 200 with the company name for a known tenant', async () => {
    const data = await loader(makeArgs('acme', 'privacy'));
    expect(data.companyName).toBe('Acme Inspections');
    expect(data.doc).toBe('privacy');
    expect(data.tenantSlug).toBe('acme');
  });

  it('passes the tenant slug through to resolveTenantBrand', async () => {
    await loader(makeArgs('acme', 'privacy'));
    expect(mockResolveTenantBrand).toHaveBeenCalledWith(
      expect.anything(), // context
      'acme',
    );
  });

  it('the SMS clause text contains the company name after mergeCompany', () => {
    const merged = mergeCompany(SMS_CLAUSE_TEXT, 'Acme Inspections');
    expect(merged).toContain('Acme Inspections');
    expect(merged).toContain('STOP');
    expect(merged).toContain('Twilio, Inc.');
  });
});

// ---------------------------------------------------------------------------
// loader — known tenant, terms
// ---------------------------------------------------------------------------

describe('loader /legal/:tenant/terms', () => {
  beforeEach(() => {
    mockResolveTenantBrand.mockResolvedValue({
      companyName: 'Sunrise Home Inspections',
      primaryColor: null,
      logoUrl: null,
    });
  });

  it('returns 200 with the company name for a known tenant', async () => {
    const data = await loader(makeArgs('sunrise', 'terms'));
    expect(data.companyName).toBe('Sunrise Home Inspections');
    expect(data.doc).toBe('terms');
  });
});

// ---------------------------------------------------------------------------
// loader — unknown tenant → 404
// ---------------------------------------------------------------------------

describe('loader — unknown tenant → 404', () => {
  beforeEach(() => {
    // resolveTenantBrand returns companyName: null for unknown slugs
    // (the brand endpoint returns !ok, so EMPTY_BRAND is used).
    mockResolveTenantBrand.mockResolvedValue({
      companyName: null,
      primaryColor: null,
      logoUrl: null,
    });
  });

  it('throws a 404 Response when the tenant brand resolves to null name', async () => {
    await expect404(makeArgs('no-such-tenant', 'privacy'));
  });

  it('throws 404 for terms with unknown tenant too', async () => {
    await expect404(makeArgs('ghost-co', 'terms'));
  });
});

// ---------------------------------------------------------------------------
// loader — unknown doc → 404 (regardless of tenant)
// ---------------------------------------------------------------------------

describe('loader — unknown doc → 404', () => {
  it('throws 404 for an unrecognized doc type', async () => {
    await expect404(makeArgs('acme', 'cookies'));
  });

  it('throws 404 for an empty doc', async () => {
    await expect404(makeArgs('acme', ''));
  });

  it('throws 404 for "disclaimer" (not in allowed set)', async () => {
    await expect404(makeArgs('acme', 'disclaimer'));
  });
});
