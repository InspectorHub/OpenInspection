// @vitest-environment node
/**
 * Per-tenant legal pages (TFV/A2P compliance URLs).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLegalGet = vi.fn();

vi.mock('~/lib/api-client.server', () => ({
  createApi: () => ({
    publicReport: {
      legal: {
        ':tenant': {
          ':doc': {
            $get: (...args: unknown[]) => mockLegalGet(...args),
          },
        },
      },
    },
  }),
}));

import {
  loader,
  mergeCompany,
  SMS_CLAUSE_TEXT,
  SMS_CLAUSE_HEADING,
} from '~/routes/public/legal';

type LoaderArgs = Parameters<typeof loader>[0];

function makeArgs(tenant: string, doc: string): LoaderArgs {
  return {
    request: new Request(`http://app.test/legal/${tenant}/${doc}`),
    context: {} as never,
    params: { tenant, doc },
  } as unknown as LoaderArgs;
}

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

beforeEach(() => {
  mockLegalGet.mockReset();
});

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

describe('loader /legal/:tenant/privacy', () => {
  beforeEach(() => {
    mockLegalGet.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { companyName: 'Acme Inspections', body: null },
      }),
    });
  });

  it('returns 200 with the company name for a known tenant', async () => {
    const data = await loader(makeArgs('acme', 'privacy'));
    expect(data.companyName).toBe('Acme Inspections');
    expect(data.doc).toBe('privacy');
    expect(data.tenantSlug).toBe('acme');
    expect(data.customBody).toBeNull();
  });

  it('returns custom body when configured', async () => {
    mockLegalGet.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { companyName: 'Acme Inspections', body: 'Custom privacy text' },
      }),
    });
    const data = await loader(makeArgs('acme', 'privacy'));
    expect(data.customBody).toBe('Custom privacy text');
  });

  it('requests the privacy doc for the tenant slug', async () => {
    await loader(makeArgs('acme', 'privacy'));
    expect(mockLegalGet).toHaveBeenCalledWith({
      param: { tenant: 'acme', doc: 'privacy' },
    });
  });

  it('the SMS clause text contains the company name after mergeCompany', () => {
    const merged = mergeCompany(SMS_CLAUSE_TEXT, 'Acme Inspections');
    expect(merged).toContain('Acme Inspections');
    expect(merged).not.toContain('{{company}}');
  });
});

describe('loader /legal/:tenant/terms', () => {
  beforeEach(() => {
    mockLegalGet.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { companyName: 'Acme Inspections', body: null },
      }),
    });
  });

  it('returns 200 with the company name', async () => {
    const data = await loader(makeArgs('acme', 'terms'));
    expect(data.companyName).toBe('Acme Inspections');
    expect(data.doc).toBe('terms');
  });
});

describe('loader errors', () => {
  it('404s for an unknown doc type', async () => {
    await expect404(makeArgs('acme', 'cookies'));
  });

  it('404s when the API returns not ok', async () => {
    mockLegalGet.mockResolvedValue({ ok: false });
    await expect404(makeArgs('missing', 'privacy'));
  });

  it('404s when company name is missing', async () => {
    mockLegalGet.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { companyName: '', body: null } }),
    });
    await expect404(makeArgs('acme', 'privacy'));
  });
});
