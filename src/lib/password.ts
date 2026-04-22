/** Returns an error message if the password fails complexity rules, or null if valid. */
export function validatePasswordStrength(password: string): string | null {
    if (password.length < 8) return 'Password must be at least 8 characters.';
    if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
    if (!/[0-9]/.test(password)) return 'Password must contain at least one digit.';
    if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character.';
    return null;
}

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_HASH_BITS = 256;

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return out;
}

async function sha256Hex(input: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return toHex(new Uint8Array(buf));
}

/** Constant-time string comparison. Returns false immediately on length mismatch. */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        key,
        PBKDF2_HASH_BITS
    );
    return new Uint8Array(bits);
}

/** Hash a password using PBKDF2-SHA256 with a random 16-byte salt. */
export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
    const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
    return `pbkdf2:${toHex(salt)}:${toHex(hash)}`;
}

/**
 * Verify a password against a stored hash.
 *
 * Returns [valid, needsRehash]. needsRehash is true when verification succeeded against a
 * legacy plain SHA-256 hash (no `pbkdf2:` prefix), signaling callers should upgrade storage.
 */
export async function verifyPassword(password: string, stored: string): Promise<[boolean, boolean]> {
    if (stored.startsWith('pbkdf2:')) {
        const parts = stored.split(':');
        if (parts.length !== 3) return [false, false];
        const salt = fromHex(parts[1]);
        const expected = parts[2];
        const actual = toHex(await pbkdf2(password, salt, PBKDF2_ITERATIONS));
        return [timingSafeEqual(actual, expected), false];
    }
    const legacy = await sha256Hex(password);
    const valid = timingSafeEqual(legacy, stored);
    return [valid, valid];
}
