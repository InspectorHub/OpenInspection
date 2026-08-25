/**
 * ONE answer to "what credential, if any, does this deployment fund AI with".
 *
 * There are two readers of that answer — the per-request service assembly and
 * the provisioning console a deployment operator reads — and they used to read
 * the environment separately. That was survivable while there was exactly one
 * variable to read. It stops being survivable the moment a second KIND of
 * credential exists: a deployment configured one way and read the other way
 * reports every workspace as unprovisioned while the runtime happily resolves
 * a credential, and the console is then confidently wrong.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveManagedAiCredential } from '../../../server/lib/ai/managed-credential';
import { isAccessTokenSource } from '../../../server/lib/ai/credential';
import { logger } from '../../../server/lib/logger';

/** A syntactically complete document. The key is never used here — nothing in
 *  this file mints a token — so a placeholder is honest and no real key is
 *  committed. */
const SERVICE_ACCOUNT = JSON.stringify({
    client_email: 'sa@example.iam.gserviceaccount.test',
    private_key: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n',
    token_uri: 'https://oauth2.googleapis.test/token',
});

afterEach(() => vi.restoreAllMocks());

describe('resolveManagedAiCredential', () => {
    it('answers null when the deployment funds nothing', () => {
        // The self-hosted shape, and the assertion that this change adds no
        // configuration a self-hosted operator must now supply. Absent stays
        // absent — the feature is off by construction, not refused by a flag.
        expect(resolveManagedAiCredential({})).toBeNull();
    });

    it('returns a long-lived key unchanged when that is all there is', () => {
        // The positive control for everything below: the credential that
        // worked before this file existed must come back byte for byte, and
        // must still be a plain string so the adapter spends it as it always
        // did.
        expect(resolveManagedAiCredential({ AI_MANAGED_API_KEY: 'platform-key' }))
            .toBe('platform-key');
    });

    it('treats an empty key as no key', () => {
        expect(resolveManagedAiCredential({ AI_MANAGED_API_KEY: '   ' })).toBeNull();
    });

    it('returns a self-refreshing credential when a service account is configured', () => {
        const cred = resolveManagedAiCredential({ AI_VERTEX_SERVICE_ACCOUNT: SERVICE_ACCOUNT });
        expect(cred).not.toBeNull();
        expect(isAccessTokenSource(cred as NonNullable<typeof cred>)).toBe(true);
    });

    it('prefers the service account when both are configured, and says so', () => {
        // The failure this rules out: an operator provisions the new
        // credential, a superseded key is still sitting in the environment,
        // and the switch silently does not switch.
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const cred = resolveManagedAiCredential({
            AI_VERTEX_SERVICE_ACCOUNT: SERVICE_ACCOUNT,
            AI_MANAGED_API_KEY: 'platform-key',
        });
        expect(isAccessTokenSource(cred as NonNullable<typeof cred>)).toBe(true);
        expect(warn).toHaveBeenCalled();
    });

    it('falls back to the long-lived key when the service account will not parse', () => {
        // Fail SOFT here rather than hard: a deployment mid-migration with a
        // malformed new credential and a working old one should keep working,
        // and the log is what tells the operator the new one is not in use.
        vi.spyOn(logger, 'error').mockImplementation(() => {});
        expect(resolveManagedAiCredential({
            AI_VERTEX_SERVICE_ACCOUNT: '{not json',
            AI_MANAGED_API_KEY: 'platform-key',
        })).toBe('platform-key');
    });

    it('resolves nothing — not an error — when the only credential is malformed', () => {
        // An entitled workspace on a deployment whose credential is unusable
        // gets the feature OFF. It must not get a runtime failure partway
        // through a report, and it must never be told to change a setting of
        // its own.
        vi.spyOn(logger, 'error').mockImplementation(() => {});
        expect(resolveManagedAiCredential({ AI_VERTEX_SERVICE_ACCOUNT: '{not json' })).toBeNull();
    });

    it('names the missing field in the log, and quotes no value from the document', () => {
        const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
        const secret = '-----BEGIN PRIVATE KEY-----\nSECRET-MATERIAL\n-----END PRIVATE KEY-----\n';
        resolveManagedAiCredential({
            // A document carrying the key but missing the identity: the
            // operator has to learn WHICH half is absent without the log
            // reproducing the half that is present.
            AI_VERTEX_SERVICE_ACCOUNT: JSON.stringify({ private_key: secret }),
        });

        expect(error).toHaveBeenCalled();
        const logged = JSON.stringify(error.mock.calls);
        expect(logged).toContain('client_email');
        expect(logged).not.toContain('SECRET-MATERIAL');
    });
});
