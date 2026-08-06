import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QBOServiceBase } from '../../../server/services/qbo/api-base';

/**
 * QuickBooks has two API hosts, and the credentials are NOT interchangeable:
 * Intuit Development keys authenticate only against sandbox companies, and
 * Production keys only against real ones. A build that can only ever talk to
 * `quickbooks.api.intuit.com` therefore cannot be exercised against a sandbox
 * at all — which is why this integration has never been tested end to end.
 *
 * The host is asserted through `apiCall`, not against a helper in isolation:
 * what matters is the URL that actually leaves the worker.
 *
 * Unset fails CLOSED. There is no default host, because either default is
 * wrong half the time and the wrong one is the expensive half — a build that
 * silently points at production and is handed sandbox keys fails with an auth
 * error nobody reads as a configuration mistake, and one that silently points
 * at sandbox writes a customer's real books nowhere.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
class ProbeQbo extends QBOServiceBase {
    public call(path: string) { return this.apiCall<unknown>('t1', 'GET', path); }
    protected override async getToken() {
        return { accessToken: 'at', realmId: '9130350000000000', tenantId: 't1' };
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const build = (qboEnv?: string) => new ProbeQbo({} as any, 'cid', 'csec', 'whsec', 'a'.repeat(32), qboEnv);

describe('QBO API host selection', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => { vi.unstubAllGlobals(); });

    it('calls the SANDBOX host when QBO_ENV=sandbox', async () => {
        await build('sandbox').call('companyinfo/9130350000000000');
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'https://sandbox-quickbooks.api.intuit.com/v3/company/9130350000000000/companyinfo/9130350000000000?minorversion=75',
        );
    });

    it('calls the PRODUCTION host when QBO_ENV=production', async () => {
        await build('production').call('companyinfo/9130350000000000');
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'https://quickbooks.api.intuit.com/v3/company/9130350000000000/companyinfo/9130350000000000?minorversion=75',
        );
    });

    it('fails closed when QBO_ENV is unset — no request is made', async () => {
        await expect(build(undefined).call('companyinfo/1')).rejects.toThrow(/QBO_ENV/);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails closed on an unrecognised QBO_ENV rather than guessing', async () => {
        await expect(build('staging').call('companyinfo/1')).rejects.toThrow(/QBO_ENV/);
        await expect(build('').call('companyinfo/1')).rejects.toThrow(/QBO_ENV/);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
