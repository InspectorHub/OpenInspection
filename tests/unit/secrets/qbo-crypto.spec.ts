import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken, deriveKey } from '../../../server/lib/qbo-crypto';

const TEST_SECRET = 'a'.repeat(32); // 32-char JWT_SECRET for tests

describe('qbo-crypto', () => {
    it('deriveKey returns a CryptoKey', async () => {
        const key = await deriveKey(TEST_SECRET);
        expect(key).toBeDefined();
        expect(key.type).toBe('secret');
        expect(key.algorithm.name).toBe('AES-GCM');
    });

    it('encryptToken produces a base64 string', async () => {
        const result = await encryptToken('my-secret-token', TEST_SECRET);
        expect(typeof result).toBe('string');
        expect(result).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('decryptToken round-trips correctly', async () => {
        const plaintext = 'eyJhbGciOiJIUzI1NiJ9.test.token';
        const encrypted = await encryptToken(plaintext, TEST_SECRET);
        const decrypted = await decryptToken(encrypted, TEST_SECRET);
        expect(decrypted).toBe(plaintext);
    });

    it('different plaintexts produce different ciphertexts', async () => {
        const a = await encryptToken('token-a', TEST_SECRET);
        const b = await encryptToken('token-b', TEST_SECRET);
        expect(a).not.toBe(b);
    });

    it('same plaintext produces different ciphertexts (random IV)', async () => {
        const a = await encryptToken('token', TEST_SECRET);
        const b = await encryptToken('token', TEST_SECRET);
        expect(a).not.toBe(b);
    });

    it('decryptToken throws on tampered ciphertext', async () => {
        const encrypted = await encryptToken('token', TEST_SECRET);
        const tampered = encrypted.slice(0, -4) + 'XXXX';
        await expect(decryptToken(tampered, TEST_SECRET)).rejects.toThrow();
    });
});
