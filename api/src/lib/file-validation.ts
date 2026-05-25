const SIGNATURES: Record<string, number[]> = {
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/png':  [0x89, 0x50, 0x4E, 0x47],
    'image/webp': [0x52, 0x49, 0x46, 0x46],
    'application/pdf': [0x25, 0x50, 0x44, 0x46],
};

export function detectMime(bytes: Uint8Array): string | null {
    for (const [mime, sig] of Object.entries(SIGNATURES)) {
        if (sig.every((b, i) => bytes[i] === b)) return mime;
    }
    return null;
}

export const ALLOWED_MIMES = new Set([
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
]);
