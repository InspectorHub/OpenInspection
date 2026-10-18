/**
 * What the hub pay link does when it cannot be produced: the hub still loads, an expected refusal is a warning,
 * an unexpected fault is an error that alerting can see, and neither log carries the client's email, a token or a URL.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { hubPayLink, scrubbedMessage } from '../../../server/lib/inspection/hub-pay-url';
import { AppError, Errors } from '../../../server/lib/errors';
import { logger } from '../../../server/lib/logger';

const EMAIL = 'jane.client@example.com';
const TOKEN = 'tok_ABCDEFGHIJKLMNOPQRSTUVWX1234';

function ctxWith(opts: { client: { email: string | null } | null; issue: () => Promise<string> }) {
    return {
        var: { services: { people: { getPrimaryClient: async () => opts.client }, portalAccess: { issueToken: opts.issue } } },
        req: { url: 'https://acme.example.com/api/inspections/x/hub', header: () => undefined },
        env: { APP_BASE_URL: 'https://acme.example.com' },
        get: () => undefined,
    } as never;
}
const sent = { status: 'sent' };

afterEach(() => vi.restoreAllMocks());

describe('hubPayLink', () => {
    it('an expected refusal (AppError) is a warning, not an error, and says why there is no link', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const res = await hubPayLink(ctxWith({ client: { email: EMAIL }, issue: async () => { throw Errors.BadRequest('Portal token cannot be reconstructed'); } }), 't', 'i', sent);
        expect(res).toEqual({ url: null, unavailable: 'link_error' });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(error).not.toHaveBeenCalled();
        expect(JSON.stringify(warn.mock.calls)).not.toContain(EMAIL);
    });

    it('anything else is an error with the class and a message, and the log holds no email, token or URL', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        class D1Failure extends Error { override name = 'D1_ERROR'; }
        const boom = new D1Failure(`failed: SELECT ... params: ${EMAIL}, ${TOKEN} at https://acme.example.com/invoice/9?token=${TOKEN}`);
        const res = await hubPayLink(ctxWith({ client: { email: EMAIL }, issue: async () => { throw boom; } }), 't', 'i', sent);
        expect(res).toEqual({ url: null, unavailable: 'link_error' });
        expect(error).toHaveBeenCalledTimes(1);
        expect(warn).not.toHaveBeenCalled();
        const logged = JSON.stringify(error.mock.calls);
        expect(logged).toContain('D1_ERROR');
        expect(logged).toContain('failed: SELECT');
        for (const secret of [EMAIL, TOKEN, 'acme.example.com']) expect(logged).not.toContain(secret);
    });

    it('a primary client without an email is reported as such, quietly', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const issue = vi.fn();
        expect(await hubPayLink(ctxWith({ client: { email: null }, issue }), 't', 'i', sent)).toEqual({ url: null, unavailable: 'no_client_email' });
        expect(issue).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });

    it('no link is due for a draft or no invoice, and nothing is reported', async () => {
        const issue = vi.fn();
        for (const invoice of [{ status: 'draft' }, null, undefined]) {
            expect(await hubPayLink(ctxWith({ client: { email: EMAIL }, issue }), 't', 'i', invoice)).toEqual({ url: null, unavailable: null });
        }
        expect(issue).not.toHaveBeenCalled();
    });

    it('control: a healthy grant produces the link and no log line', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const res = await hubPayLink(ctxWith({ client: { email: EMAIL }, issue: async () => 'good-token' }), 't', 'inspection-1', sent);
        expect(res.unavailable).toBeNull();
        expect(res.url).toContain('good-token');
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });

    it('scrubbedMessage keeps the shape of a failure and bounds it', () => {
        const long = scrubbedMessage(new Error(`x ${'y'.repeat(1000)}`));
        expect(long.length).toBeLessThanOrEqual(300);
        expect(scrubbedMessage(new Error('no such column: foo'))).toBe('no such column: foo');
        expect(AppError).toBeDefined();
    });
});
