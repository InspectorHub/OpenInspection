/**
 * An entry in the unauthenticated-path list for a route that does not exist is a standing invitation: whatever route is ever added at that path
 * silently needs no session. These paths once had handlers and no longer do, so they are not public. Beside them, the doors that exist and are
 * meant to be public stay public, and the paths the list names exactly are checked against the routes the application really registered.
 */
import { describe, it, expect } from 'vitest';
import { app } from '../../../server/index';
import { isUnauthenticatedPath } from '../../../server/lib/auth/public-paths';

const GHOSTS = [
    '/api/auth/register',
    '/api/agents/accept',
    '/agent-invite/some-token',
    '/api/concierge/book-info',
    '/api/concierge/book',
    '/api/concierge/confirm-info',
];

/** Exact public API paths a handler must exist for. */
const EXACT_API_DOORS = [
    '/api/auth/login', '/api/auth/setup', '/api/auth/login/2fa', '/api/agent-signup', '/api/agent-signup/terms',
    '/api/agent/login', '/api/agent/login-link', '/api/agent/magic-login/request', '/api/agent/report-context', '/api/concierge/confirm',
];

describe('unauthenticated path list', () => {
    it('does not name paths whose handlers are gone', () => {
        for (const path of GHOSTS) expect(isUnauthenticatedPath(path), path).toBe(false);
    });

    it('still opens the doors that exist, and every exact API path it names has a registered handler', () => {
        const registered = new Set(app.routes.map((r) => r.path));
        for (const path of EXACT_API_DOORS) {
            expect(isUnauthenticatedPath(path), path).toBe(true);
            expect(registered.has(path), `a handler for ${path}`).toBe(true);
        }
        // Control: the ghosts really are not registered either, so the list above is not just a different spelling.
        for (const path of GHOSTS.filter((p) => p.startsWith('/api/'))) expect(registered.has(path), path).toBe(false);
    });
});
