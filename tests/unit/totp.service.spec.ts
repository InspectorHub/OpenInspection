import { describe, it, expect } from 'vitest';
import { TotpService } from '../../server/services/totp.service';
import { TOTP } from 'otpauth';

const svc = new TotpService();

describe('TotpService', () => {
    describe('generateSecret', () => {
        it('returns a base32-encoded string of expected length', () => {
            const s = svc.generateSecret();
            expect(s).toMatch(/^[A-Z2-7]+$/);
            // 20 bytes (160 bits) → 32 base32 chars
            expect(s.length).toBe(32);
        });

        it('returns a different value every call', () => {
            const a = svc.generateSecret();
            const b = svc.generateSecret();
            expect(a).not.toBe(b);
        });
    });

    describe('buildOtpAuthUrl', () => {
        it('produces an otpauth:// URL with issuer + label + secret embedded', () => {
            const secret = svc.generateSecret();
            const url = svc.buildOtpAuthUrl({ accountName: 'me@example.com', issuer: 'TestApp', secret });
            expect(url.startsWith('otpauth://totp/')).toBe(true);
            expect(url).toContain('issuer=TestApp');
            expect(url).toContain(`secret=${secret}`);
        });
    });

    describe('verifyCode', () => {
        it('accepts a code generated against the same secret right now', () => {
            const secret = svc.generateSecret();
            const totp = new TOTP({ secret, algorithm: 'SHA1', digits: 6, period: 30 });
            const code = totp.generate();
            expect(svc.verifyCode(secret, code)).toBe(true);
        });

        it('rejects a non-6-digit input without verifying', () => {
            const secret = svc.generateSecret();
            expect(svc.verifyCode(secret, '12345')).toBe(false);
            expect(svc.verifyCode(secret, '1234567')).toBe(false);
            expect(svc.verifyCode(secret, 'abcdef')).toBe(false);
            expect(svc.verifyCode(secret, '')).toBe(false);
        });

        it('rejects a wrong code', () => {
            const secret = svc.generateSecret();
            // 000000 is overwhelmingly unlikely to be the current valid code.
            expect(svc.verifyCode(secret, '000000')).toBe(false);
        });
    });

    describe('generateRecoveryCodes', () => {
        it('returns 8 codes by default', () => {
            const codes = svc.generateRecoveryCodes();
            expect(codes).toHaveLength(8);
        });

        it('every code matches XXXX-XXXX format using the safe alphabet', () => {
            const codes = svc.generateRecoveryCodes();
            for (const c of codes) {
                expect(c).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
            }
        });

        it('generates unique codes within a batch', () => {
            const codes = svc.generateRecoveryCodes(8);
            expect(new Set(codes).size).toBe(8);
        });

        it('honours the count parameter', () => {
            expect(svc.generateRecoveryCodes(3)).toHaveLength(3);
        });
    });

    describe('hashCode', () => {
        it('returns a 64-character lowercase hex string', async () => {
            const h = await svc.hashCode('ABCD-EFGH');
            expect(h).toMatch(/^[0-9a-f]{64}$/);
        });

        it('is deterministic — same input yields same hash', async () => {
            const h1 = await svc.hashCode('ABCD-EFGH');
            const h2 = await svc.hashCode('ABCD-EFGH');
            expect(h1).toBe(h2);
        });

        it('normalises whitespace and case before hashing', async () => {
            const h1 = await svc.hashCode('abcd-efgh');
            const h2 = await svc.hashCode('  ABCD-EFGH  ');
            expect(h1).toBe(h2);
        });
    });

    describe('consumeRecoveryCode', () => {
        it('returns matched=true and removes the entry on a hit', async () => {
            const code = 'ABCD-EFGH';
            const otherHash = 'a'.repeat(64);
            const codeHash = await svc.hashCode(code);
            const hashes = [otherHash, codeHash];
            const result = await svc.consumeRecoveryCode(code, hashes);
            expect(result.matched).toBe(true);
            expect(result.remainingHashes).toEqual([otherHash]);
        });

        it('returns matched=false and preserves the list on miss', async () => {
            const hashes = ['a'.repeat(64), 'b'.repeat(64)];
            const result = await svc.consumeRecoveryCode('ZZZZ-ZZZZ', hashes);
            expect(result.matched).toBe(false);
            expect(result.remainingHashes).toEqual(hashes);
        });

        it('does not mutate the input array on a hit', async () => {
            const code = 'WXYZ-2345';
            const codeHash = await svc.hashCode(code);
            const hashes = [codeHash];
            await svc.consumeRecoveryCode(code, hashes);
            expect(hashes).toEqual([codeHash]);
        });
    });
});
