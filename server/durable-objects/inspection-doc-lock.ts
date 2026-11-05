/**
 * The results document of a PUBLISHED report takes no edits.
 *
 * The HTTP routes answer a write to a published report with 409 `REPORT_PUBLISHED`. A Yjs socket has no way to
 * answer: the y-sync protocol carries no error frame, and an update it silently dropped would leave the phone
 * believing the edit was saved. So the socket speaks through its CLOSE CODE instead, which every WebSocket
 * client can read: `4409` with the reason `REPORT_PUBLISHED`, the socket-side twin of the HTTP 409. A client that
 * is closed this way knows the edits it still holds were NOT accepted (it never saw them acknowledged), keeps
 * them, and asks the person whether to "Edit and republish".
 *
 * Who decides, and what the document remembers:
 * - D1 decides. The collab route reads the report's state on every upgrade and says so in `x-report-locked`
 *   (`1` locked, `0` not), with the time it read it (`x-report-checked-at`). A `0` also clears a stale mark, so a missed
 *   unlock heals itself, but only a mark older than that read: a publish that landed after it keeps its mark.
 * - The document keeps a mark in its own storage so that a socket ALREADY OPEN when the report is published is
 *   refused on its next message, without a D1 read per frame. Publish marks the document and closes the open
 *   sockets (`lock`); "Edit and republish" and retract clear it (`unlock`).
 * - If the publish route could not reach the document to mark it, edits from an already-open socket merge into the
 *   document as before. Clients still read the frozen version, so nothing reaches them; the edit is kept, not lost.
 */

const LOCK_KEY = 'locked-for-publish';

/** WebSocket close code (application range) and reason: the socket twin of HTTP 409 `REPORT_PUBLISHED`. */
export const CLOSE_REPORT_PUBLISHED = 4409;
export const CLOSE_REASON = 'REPORT_PUBLISHED';

/** The mark is the time the document was locked (a document locked before it was timestamped holds `true`). */
export const isDocLocked = async (ctx: DurableObjectState): Promise<boolean> => (await ctx.storage.get<number | boolean>(LOCK_KEY)) !== undefined;

/**
 * Whether an upgrade is refused, given what the route said and WHEN it asked D1.
 *
 * The route reads the report's state, then calls the document; a publish can land in between. A `0` ("not locked") is
 * therefore only believed over a mark that is OLDER than the moment D1 was read. A mark made after that moment means the
 * report was published while this request was in flight: the socket is refused and the mark kept.
 */
export async function upgradeRefused(ctx: DurableObjectState, routeSays: string | null, checkedAtMs: number): Promise<boolean> {
    if (routeSays === '1') return true;
    const mark = await ctx.storage.get<number | boolean>(LOCK_KEY);
    if (mark === undefined) return false;
    if (routeSays !== '0') return true;
    if (typeof mark === 'number' && mark > checkedAtMs) return true;
    await ctx.storage.delete(LOCK_KEY);   // a stale mark (an unlock that never arrived) heals itself
    return false;
}

/** The reply to an upgrade for a locked report: accept the socket, then close it with the readable code. */
export function refusedSocketResponse(ctx: DurableObjectState): Response {
    const pair = new WebSocketPair();
    ctx.acceptWebSocket(pair[1]);
    pair[1].close(CLOSE_REPORT_PUBLISHED, CLOSE_REASON);
    return new Response(null, { status: 101, webSocket: pair[0] });
}

/** Mark the document locked and close every open socket with the readable code, after `flush` stored what they sent. */
export async function lockDoc(ctx: DurableObjectState, flush: () => Promise<void>): Promise<number> {
    await ctx.storage.put(LOCK_KEY, Date.now());
    const sockets = ctx.getWebSockets();
    if (sockets.length > 0) await flush();
    for (const ws of sockets) {
        try { ws.close(CLOSE_REPORT_PUBLISHED, CLOSE_REASON); } catch { /* already closed */ }
    }
    return sockets.length;
}

export const unlockDoc = (ctx: DurableObjectState): Promise<boolean> => ctx.storage.delete(LOCK_KEY);
