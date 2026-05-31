import { TOTP, Secret } from 'otpauth';
import QRCode from 'qrcode';

/**
 * Spec 4A — TOTP 2FA service.
 *
 * Pure-JS / Web Crypto only — runs unmodified in Cloudflare Workers.
 * No state lives in this class; all persistence is delegated to callers
 * (auth.ts route handlers) so the service is trivially testable.
 */
export class TotpService {
    /** Base32-encoded 160-bit secret, as recommended by RFC 6238. */
    generateSecret(): string {
        return new Secret({ size: 20 }).base32;
    }

    /** Build the otpauth:// URL embedded into the QR code. */
    buildOtpAuthUrl({ accountName, issuer, secret }: { accountName: string; issuer: string; secret: string }): string {
        const totp = new TOTP({ issuer, label: accountName, secret, algorithm: 'SHA1', digits: 6, period: 30 });
        return totp.toString();
    }

    /** Render the otpauth URL as a data: URI PNG suitable for an <img> src. */
    async qrCodeDataUri(otpAuthUrl: string): Promise<string> {
        return QRCode.toDataURL(otpAuthUrl, { width: 240, margin: 2 });
    }

    /**
     * Verify a 6-digit TOTP code with a +/- 1 step window (~90s tolerance)
     * to forgive slight clock drift between server and authenticator.
     */
    verifyCode(secret: string, code: string): boolean {
        if (!/^\d{6}$/.test(code)) return false;
        const totp = new TOTP({ secret, algorithm: 'SHA1', digits: 6, period: 30 });
        const delta = totp.validate({ token: code, window: 1 });
        return delta !== null;
    }

    /**
     * Generate `count` recovery codes formatted as XXXX-XXXX (8 chars + dash).
     * Crockford-ish alphabet (no I/O/0/1) to avoid transcription errors.
     */
    generateRecoveryCodes(count = 8): string[] {
        const codes: string[] = [];
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const buf = new Uint8Array(count * 8);
        crypto.getRandomValues(buf);
        for (let i = 0; i < count; i++) {
            const seg = (n: number) => Array.from({ length: 4 }, (_, j) => alphabet[buf[i * 8 + n * 4 + j]! % alphabet.length]).join('');
            codes.push(`${seg(0)}-${seg(1)}`);
        }
        return codes;
    }

    /**
     * Hash a recovery code with SHA-256. Codes are never stored plaintext —
     * only the lowercase hex digest is persisted, matching consumeRecoveryCode.
     */
    async hashCode(code: string): Promise<string> {
        const data = new TextEncoder().encode(code.trim().toUpperCase());
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Try to consume a recovery code. Returns the new hash list with the matched
     * entry removed; never mutates the input. Single-use semantics enforced by callers
     * persisting `remainingHashes` after a successful match.
     */
    async consumeRecoveryCode(code: string, hashes: string[]): Promise<{ matched: boolean; remainingHashes: string[] }> {
        const target = await this.hashCode(code);
        const idx = hashes.indexOf(target);
        if (idx === -1) return { matched: false, remainingHashes: hashes };
        return { matched: true, remainingHashes: [...hashes.slice(0, idx), ...hashes.slice(idx + 1)] };
    }
}
