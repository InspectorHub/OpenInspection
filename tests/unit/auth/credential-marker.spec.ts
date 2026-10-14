/**
 * The credential-change marker has to outlive the longest a native grant can sit
 * unused and still refresh; otherwise a grant whose revocation failed would refresh
 * successfully once the marker had expired.
 */
import { describe, it, expect } from 'vitest';
import { CREDENTIAL_MARKER_TTL_S } from '../../../server/lib/auth/credential-marker';
import { NATIVE_IDLE_LIMIT_S } from '../../../server/lib/auth/native-token';

describe('credential-change marker lifetime', () => {
    it('outlives the native idle limit by at least a day', () => {
        expect(CREDENTIAL_MARKER_TTL_S).toBeGreaterThanOrEqual(NATIVE_IDLE_LIMIT_S + 86400);
    });

    it('is no longer than the 100 days the documentation promises', () => {
        expect(CREDENTIAL_MARKER_TTL_S).toBe(100 * 86400);
    });
});
