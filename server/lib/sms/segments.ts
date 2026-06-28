/**
 * SP2 — SMS segment estimator for the template editor.
 *
 * GSM-7 basic + extension charset → 1 segment for ≤160 chars, 153/part above.
 * Any char outside that set forces UCS-2 (unicode) → 70 / 67. This mirrors the
 * carrier billing model so the editor can warn before a user splits a message.
 */
const GSM_BASIC =
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM_EXTENSION = '^{}\\[~]|€';

function isGsm7(body: string): boolean {
    for (const ch of body) {
        if (!GSM_BASIC.includes(ch) && !GSM_EXTENSION.includes(ch)) return false;
    }
    return true;
}

export function smsSegmentInfo(body: string): { encoding: 'gsm' | 'unicode'; length: number; segments: number } {
    const length = [...body].length;
    if (length === 0) return { encoding: 'gsm', length: 0, segments: 0 };
    const gsm = isGsm7(body);
    if (gsm) {
        const segments = length <= 160 ? 1 : Math.ceil(length / 153);
        return { encoding: 'gsm', length, segments };
    }
    const segments = length <= 70 ? 1 : Math.ceil(length / 67);
    return { encoding: 'unicode', length, segments };
}
