const INVITE_TOKEN_BYTES = 24; // 24 bytes -> 48 hex chars
export const INVITE_TTL_DAYS = 7;

export function mintToken(): string {
    const buf = new Uint8Array(INVITE_TOKEN_BYTES);
    crypto.getRandomValues(buf);
    let hex = '';
    for (const b of buf) hex += b.toString(16).padStart(2, '0');
    return hex;
}

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}
