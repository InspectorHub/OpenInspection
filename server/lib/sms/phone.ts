/**
 * Track L — normalize messy field-entered phone numbers to E.164 before an SMS
 * send. Conservative US-default: 10 digits → +1XXXXXXXXXX; 11 digits leading 1 →
 * +1...; an existing leading '+' is trusted if it yields 8–15 digits. Anything
 * else → null (the caller skips the log with reason 'invalid phone'). No external
 * dependency — full libphonenumber is overkill for the supported markets (US/CA).
 */
export function normalizeE164(raw: string | null | undefined, defaultCountry: 'US' = 'US'): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (trimmed.startsWith('+')) {
        const digits = trimmed.slice(1).replace(/\D/g, '');
        return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
    }
    const digits = trimmed.replace(/\D/g, '');
    if (defaultCountry === 'US') {
        if (digits.length === 10) return `+1${digits}`;
        if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    }
    return null;
}
