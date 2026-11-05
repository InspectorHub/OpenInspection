import { bytesToHex, hmacSha256 } from '../email/webhook-crypto';

/**
 * The UID a calendar feed publishes for one inspection.
 *
 * A feed reachable without signing in (the busy feed by public slug, the company feed by its subscription token) must not carry the
 * inspection id itself: that id is the key several other public surfaces accept. The UID is instead a keyed hash of the id, stable for a
 * given inspection and deployment (a calendar client keeps recognising the same event across polls) and meaningless to anyone without
 * the deployment secret. A missing secret throws: a feed with raw ids is worse than no feed.
 */
export async function icsUid(secret: string | undefined, inspectionId: string, host: string): Promise<string> {
    if (!secret) throw new Error('calendar feed UIDs need JWT_SECRET');
    const mac = await hmacSha256(new TextEncoder().encode(secret), `ics-uid:${inspectionId}`);
    return `${bytesToHex(mac).slice(0, 32)}@${host}`;
}

/** The first day (inclusive) and the day after the last (exclusive) a feed covers, as YYYY-MM-DD: yesterday through 90 days ahead. */
export function icsWindow(now: number = Date.now()): { from: string; until: string } {
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    return { from: day(now - 24 * 60 * 60 * 1000), until: day(now + 91 * 24 * 60 * 60 * 1000) };
}
