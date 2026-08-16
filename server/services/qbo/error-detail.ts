/**
 * What QuickBooks actually objected to, as one line.
 *
 * `apiCall` throws `Error('QBO 400')` and hangs the parsed body off the error as
 * `qboResponse`. Every sink then recorded only `error.message`, so
 * `qbo_sync_errors.error_msg` and the log line both read `QBO 400` and nothing
 * else — for a status code QuickBooks returns for a missing required field, a
 * bad reference, an over-long string, a stale SyncToken, and an unsupported
 * verb alike. An operator reading that row learned only that something was
 * wrong, and the two defects this integration shipped with (every update sent
 * as PUT; every invoice sent with no CustomerRef) both hid behind it for as
 * long as they existed. QuickBooks had been naming them in the response all
 * along; nothing was reading it.
 *
 * A ValidationFault carries one entry per problem, so all of them are kept: the
 * missing CustomerRef and the over-long DocNumber arrived in the same response,
 * and reporting only the first would cost a round trip to discover the second.
 * `element` is carried because it is the field name.
 */
export function describeQboError(error: unknown): string {
    const base = error instanceof Error ? error.message : String(error);
    const fault = (error as { qboResponse?: { Fault?: { Error?: unknown } } } | null)
        ?.qboResponse?.Fault?.Error;
    if (!Array.isArray(fault) || fault.length === 0) return base;

    const parts = fault.map((e) => {
        const { Message, Detail, code, element } = (e ?? {}) as Record<string, unknown>;
        // Detail is the specific one ("Supplied length:22"); Message is the
        // generic class of problem. Prefer Detail, fall back to Message.
        const what = String(Detail ?? Message ?? 'unknown error');
        const where = element ? ` [${String(element)}]` : '';
        const why = code ? ` (${String(code)})` : '';
        return `${what}${where}${why}`;
    });
    return `${base}: ${parts.join('; ')}`;
}
