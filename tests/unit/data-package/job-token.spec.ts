/**
 * E-1 job token: a short-lived HMAC-signed bearer for one data-package job.
 *
 * It proves the holder recently started (or resumed) THIS job for THIS tenant
 * and user. It is deliberately domain-separated from the media upload tokens
 * so a video/photo token can never be replayed as a data-job credential, and
 * verification can bind the token to the tenant, job and user the route has
 * already established from the signed-in session.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { JOB_TOKEN_TTL_SECONDS, signJobToken, verifyJobToken } from '../../../server/lib/data-package/job-token';

const SECRET = 'test-job-token-secret-at-least-32-bytes-long';
const CLAIMS = { tenantId: 'tenant-1', jobId: 'job-abc', userId: 'user-7' };

describe('job token', () => {
    afterEach(() => vi.useRealTimers());

    it('round-trips all claims plus exp', async () => {
        const token = await signJobToken(CLAIMS, SECRET);
        const got = await verifyJobToken(token, SECRET);
        expect(got).not.toBeNull();
        expect(got).toMatchObject(CLAIMS);
        expect(got!.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('uses a one-hour TTL by default', async () => {
        const before = Math.floor(Date.now() / 1000);
        const token = await signJobToken(CLAIMS, SECRET);
        const got = await verifyJobToken(token, SECRET);
        expect(got!.exp - before).toBeGreaterThanOrEqual(JOB_TOKEN_TTL_SECONDS - 1);
        expect(got!.exp - before).toBeLessThanOrEqual(JOB_TOKEN_TTL_SECONDS + 1);
    });

    it('refuses a token signed with a different secret', async () => {
        const token = await signJobToken(CLAIMS, SECRET);
        expect(await verifyJobToken(token, 'a-different-secret')).toBeNull();
    });

    it('refuses a tampered payload or signature', async () => {
        const token = await signJobToken(CLAIMS, SECRET);
        const dot = token.lastIndexOf('.');
        const body = token.slice(0, dot);
        const sig = token.slice(dot + 1);
        const flipped = sig[0] === 'A' ? 'B' : 'A';
        expect(await verifyJobToken(`${body}.${flipped}${sig.slice(1)}`, SECRET)).toBeNull();
        const badBody = Buffer.from(JSON.stringify({ ...CLAIMS, tenantId: 'tenant-2', kind: 'data-job' }))
            .toString('base64url');
        expect(await verifyJobToken(`${badBody}.${sig}`, SECRET)).toBeNull();
    });

    it('refuses a malformed token', async () => {
        expect(await verifyJobToken('not-a-token', SECRET)).toBeNull();
        expect(await verifyJobToken('', SECRET)).toBeNull();
        expect(await verifyJobToken('.', SECRET)).toBeNull();
    });

    it('refuses an expired token', async () => {
        const token = await signJobToken(CLAIMS, SECRET, -10);
        expect(await verifyJobToken(token, SECRET)).toBeNull();
    });

    it('binds the token to the expected tenant, job and user when supplied', async () => {
        const token = await signJobToken(CLAIMS, SECRET);
        expect(await verifyJobToken(token, SECRET, CLAIMS)).not.toBeNull();
        expect(await verifyJobToken(token, SECRET, { ...CLAIMS, tenantId: 'tenant-2' })).toBeNull();
        expect(await verifyJobToken(token, SECRET, { ...CLAIMS, jobId: 'job-other' })).toBeNull();
        expect(await verifyJobToken(token, SECRET, { ...CLAIMS, userId: 'user-9' })).toBeNull();
    });

    it('is not interchangeable with a media upload token', async () => {
        const token = await signJobToken(CLAIMS, SECRET);
        // The media verifier expects different claims/kind; a job token must not pass it.
        const { verifyUploadToken, signUploadToken } = await import('../../../server/lib/video-upload-token');
        expect(await verifyUploadToken(token, SECRET, 'video')).toBeNull();
        // And the reverse: neither kind of media token may pass the job verifier.
        const mediaClaims = { ...CLAIMS, inspectionId: 'insp-1', mediaId: 'media-1' };
        const videoToken = await signUploadToken(mediaClaims, 3600, SECRET, 'video');
        const photoToken = await signUploadToken(mediaClaims, 3600, SECRET, 'photo');
        expect(await verifyJobToken(videoToken, SECRET, CLAIMS)).toBeNull();
        expect(await verifyJobToken(photoToken, SECRET, CLAIMS)).toBeNull();
    });
});
