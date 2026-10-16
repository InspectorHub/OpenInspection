import { describe, it, expect } from 'vitest';
import { isUnauthenticatedPath } from '../../../server/lib/auth/public-paths';

/**
 * `/api/admin/*` is the authenticated staff surface. Two bare prefixes,
 * `/api/admin/connect` and `/api/admin/silo`, used to sit in the no-session
 * list although no route is mounted under either. A prefix match with no
 * trailing slash meant any future `/api/admin/connect*` or `/api/admin/silo*`
 * route would have skipped authentication silently. Machine-to-machine entry
 * points live under `/api/platform/`, which is the one prefix that stays public.
 */
describe('no-session path list and the admin family', () => {
    it.each([
        '/api/admin/connect',
        '/api/admin/connect/start',
        '/api/admin/connectX',
        '/api/admin/silo',
        '/api/admin/silo/provision',
    ])('%s requires a session', (path) => {
        expect(isUnauthenticatedPath(path)).toBe(false);
    });

    it('controls: the intended public prefixes are still public, other admin paths are not', () => {
        expect(isUnauthenticatedPath('/api/platform/anything')).toBe(true);
        expect(isUnauthenticatedPath('/api/public/book/acme')).toBe(true);
        expect(isUnauthenticatedPath('/api/admin/team')).toBe(false);
    });
});
