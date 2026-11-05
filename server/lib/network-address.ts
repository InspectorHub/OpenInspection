/**
 * Network identity of a caller address, shared by every per-address limiter so none can be dodged by rotating inside a
 * subscriber's own range. Leaf module: imports nothing.
 */

/** An IPv4 dotted quad as two hex groups, or null when it is not one. */
function dottedToGroups(quad: string): string[] | null {
    const parts = quad.split('.');
    if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
    const n = parts.map(Number) as [number, number, number, number];
    return [((n[0] << 8) | n[1]).toString(16), ((n[2] << 8) | n[3]).toString(16)];
}

function groupsToQuad(hi: string, lo: string): string {
    const h = parseInt(hi, 16);
    const l = parseInt(lo, 16);
    return `${h >> 8}.${h & 255}.${l >> 8}.${l & 255}`;
}

/**
 * The network a caller counts as: an IPv4 address as it is, an IPv6 address as its /64 prefix (one subscriber commonly holds a whole
 * /64, so the full address is free to rotate). An IPv4 address carried inside IPv6 (mapped, in dotted or hex form, expanded or
 * compressed, or through the NAT64 prefix 64:ff9b::/96) counts as that IPv4 address, and a zone id is dropped. Anything
 * unrecognisable is kept whole.
 */
export function normalizeAddress(raw: string): string {
    const address = (raw.trim().toLowerCase().split('%')[0] ?? '').trim();
    if (!address.includes(':')) return address;
    const halves = address.split('::');
    if (halves.length > 2) return address;
    const expand = (text: string): string[] | null => {
        if (!text) return [];
        const out: string[] = [];
        for (const part of text.split(':')) {
            if (part.includes('.')) {
                const pair = dottedToGroups(part);
                if (!pair) return null;
                out.push(...pair);
            } else out.push(part);
        }
        return out;
    };
    const head = expand(halves[0] ?? '');
    const tail = halves.length === 2 ? expand(halves[1] ?? '') : [];
    if (!head || !tail) return address;
    const fill = halves.length === 2 ? Array.from({ length: Math.max(0, 8 - head.length - tail.length) }, () => '0') : [];
    const groups = [...head, ...fill, ...tail];
    if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return address;
    const value = groups.map((g) => parseInt(g, 16));
    if (value.slice(0, 5).every((v) => v === 0) && value[5] === 0xffff) return groupsToQuad(groups[6]!, groups[7]!);
    if (value[0] === 0x64 && value[1] === 0xff9b && value.slice(2, 6).every((v) => v === 0)) return groupsToQuad(groups[6]!, groups[7]!);
    return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
