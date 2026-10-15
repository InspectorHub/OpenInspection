import { describe, it, expect } from 'vitest';
import { enforceApiAccess } from '../../../server/lib/auth/api-access-policy';
import { AppError } from '../../../server/lib/errors';

/**
 * Characterization: green on arrival. An identity-less request to an inspection
 * read used to reach a handler with no company and fail with a 500 in the
 * multi-company mode. The access policy now refuses it before any handler runs,
 * independent of deployment mode, so the answer is a 401.
 */
function statusOf(path: string, role: string | undefined): number | null {
    try {
        enforceApiAccess(path, role);
        return null;
    } catch (err) {
        if (err instanceof AppError) return err.status;
        throw err;
    }
}

describe('anonymous inspection reads are refused, not crashed', () => {
    it.each([
        '/api/inspections/insp-1',
        '/api/inspections/insp-1/results',
    ])('%s answers 401 without an identity', (path) => {
        expect(statusOf(path, undefined)).toBe(401);
    });

    it('control: the same path passes the policy for a signed-in role', () => {
        expect(statusOf('/api/inspections/insp-1', 'inspector')).toBeNull();
    });
});
