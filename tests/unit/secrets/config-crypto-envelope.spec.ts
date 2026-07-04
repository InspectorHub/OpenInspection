import { describe, it, expect } from 'vitest';
import {
    sealSecrets,
    openSecrets,
    wrapDek,
    unwrapDek,
    encryptSecrets, // legacy, for the legacy-read test
} from '../../../server/lib/config-crypto';

const TENANT = 'tenant-abc';
const SECRET = 'master-secret-current';
const PREVIOUS = 'master-secret-previous';
const DATA = { STRIPE_SECRET_KEY: 'sk_test_123', RESEND_API_KEY: 're_456' };

describe('envelope encryption (DEK + KEK wrap)', () => {
    it('seal → open roundtrip', async () => {
        const sealed = await sealSecrets(DATA, TENANT, SECRET);
        expect(sealed.blob.startsWith('v2:')).toBe(true);
        expect(sealed.dekEnc.startsWith('k1:')).toBe(true);
        const out = await openSecrets(sealed.blob, sealed.dekEnc, TENANT, SECRET);
        expect(out).toEqual(DATA);
    });

    it('reuses the existing DEK when it unwraps (blob changes, dek payload stable)', async () => {
        const first = await sealSecrets(DATA, TENANT, SECRET);
        const dek1 = await unwrapDek(first.dekEnc, TENANT, SECRET);
        const second = await sealSecrets({ ...DATA, X: 'y' }, TENANT, SECRET, first.dekEnc);
        const dek2 = await unwrapDek(second.dekEnc, TENANT, SECRET);
        expect(Array.from(dek2)).toEqual(Array.from(dek1));
    });

    it('AAD binds ciphertext to the tenant — transplanting both columns fails', async () => {
        const sealed = await sealSecrets(DATA, TENANT, SECRET);
        await expect(openSecrets(sealed.blob, sealed.dekEnc, 'other-tenant', SECRET))
            .rejects.toThrow();
    });

    it('falls back to JWT_SECRET_PREVIOUS for the DEK unwrap', async () => {
        const sealed = await sealSecrets(DATA, TENANT, PREVIOUS); // wrapped under OLD key
        const out = await openSecrets(sealed.blob, sealed.dekEnc, TENANT, SECRET, PREVIOUS);
        expect(out).toEqual(DATA);
    });

    it('fails without the previous secret when DEK was wrapped under the old key', async () => {
        const sealed = await sealSecrets(DATA, TENANT, PREVIOUS);
        await expect(openSecrets(sealed.blob, sealed.dekEnc, TENANT, SECRET)).rejects.toThrow();
    });

    it('opens a LEGACY (un-prefixed PBKDF2) blob, with previous-secret fallback', async () => {
        const legacy = await encryptSecrets(DATA, SECRET);
        expect(legacy.startsWith('v2:')).toBe(false);
        expect(await openSecrets(legacy, null, TENANT, SECRET)).toEqual(DATA);
        const legacyOld = await encryptSecrets(DATA, PREVIOUS);
        expect(await openSecrets(legacyOld, null, TENANT, SECRET, PREVIOUS)).toEqual(DATA);
    });

    it('rejects a v2 blob with no dek_enc, and malformed dek_enc', async () => {
        const sealed = await sealSecrets(DATA, TENANT, SECRET);
        await expect(openSecrets(sealed.blob, null, TENANT, SECRET)).rejects.toThrow();
        await expect(unwrapDek('bogus', TENANT, SECRET)).rejects.toThrow();
    });
});
