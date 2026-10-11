import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../server/lib/logger';
import { logRouteError, shouldLogRouteError } from '../../../server/lib/route-error-logging';

afterEach(() => vi.restoreAllMocks());

const req = (url = 'https://x.test/read-document?token=SECRET', init: RequestInit = { method: 'POST' }) =>
  new Request(url, init);

/** The shape React Router throws for an unmatched route (404) or a wrong method (405). */
const routeError = (status: number) => ({
  status, statusText: 'x', internal: true, data: 'Error: No route matches URL',
});

describe('shouldLogRouteError', () => {
  it.each([404, 405, 400, 422])('does not log a %i route error (scanner and client noise)', (status) => {
    expect(shouldLogRouteError(routeError(status), req())).toBe(false);
  });

  it('logs a 5xx route error', () => {
    expect(shouldLogRouteError(routeError(500), req())).toBe(true);
  });

  it('logs an ordinary thrown Error', () => {
    expect(shouldLogRouteError(new Error('Network connection lost.'), req())).toBe(true);
  });

  it('does not log a Response with a 4xx status', () => {
    expect(shouldLogRouteError(new Response('nope', { status: 404 }), req())).toBe(false);
  });

  it('does not log when the client already aborted the request', () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(shouldLogRouteError(new Error('aborted'), new Request('https://x.test/', { signal: ctrl.signal }))).toBe(false);
  });
});

describe('logRouteError', () => {
  it('logs a real error with the method and the path only, never the query string', () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    logRouteError(new Error('boom'), req());
    expect(spy).toHaveBeenCalledTimes(1);
    const text = JSON.stringify(spy.mock.calls);
    expect(text).toContain('/read-document');
    expect(text).toContain('POST');
    expect(text).not.toContain('SECRET');
  });

  it('logs nothing for a 404', () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    logRouteError(routeError(404), req());
    expect(spy).not.toHaveBeenCalled();
  });
});
