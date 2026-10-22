/**
 * Result decoder for the web data source.
 *
 * Maps the editor action's JSON to `CommandResult` per command. It decodes by
 * COMMAND, never by echoing the answer's `intent`, because not every answer
 * carries one (`sign-inspector` falls through to a bare `{ ok }`). It never
 * throws: every malformed reply becomes `{ ok: false, error }`.
 *
 * Quirks of the action it absorbs:
 * - `add-statutory-instance` fails with `{ error }` and NO `ok`.
 * - `upload-cover` can answer `ok: false` while still carrying `coverKey`; data
 *   is returned only on success.
 * - `autofill-property-facts` carries `{ facts, reason }` on both outcomes.
 * - A session-expiry redirect is followed by fetch and arrives as an HTML page
 *   with status 200.
 */
import type { CommandData, CommandResult, FieldCommand } from "@core/field-ui/commands";

interface DecodeContext {
    /** `Response.redirected` of the fetch. */
    redirected?: boolean;
    /** `Content-Type` header; `null` means the reply had none. */
    contentType?: string | null;
}

const SESSION_EXPIRED = "Session expired";

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function fail(error: string): CommandResult<unknown> {
    return { ok: false, error };
}

function decodeBody(cmd: FieldCommand, body: Json): CommandResult<unknown> {
    // `add-statutory-instance` answers `{ error }` with no `ok` on failure; `=== true` reads that as false.
    const ok = body.ok === true;
    const error = str(body.error);
    const result: CommandResult<unknown> = { ok };
    if (error !== undefined) result.error = error;

    switch (cmd.type) {
        case "autofill-property-facts": {
            const facts = isRecord(body.facts) ? body.facts : null;
            result.data = { facts, reason: str(body.reason) ?? null };
            return result;
        }
        case "load-scope":
            if (ok) result.data = { scope: str(body.scope) ?? cmd.scope, results: isRecord(body.results) ? body.results : {} };
            return result;
        case "upload-cover": {
            const coverKey = str(body.coverKey);
            if (ok && coverKey !== undefined) result.data = { coverKey, coverUrl: str(body.coverUrl) ?? null };
            return result;
        }
        case "crop-cover":
            if (ok) result.data = { coverKey: str(body.coverKey) ?? null };
            return result;
        case "compliance":
            if (!ok) return result;
            if (cmd.op === "signoff" || cmd.op === "remove-signoff") result.data = { role: str(body.role) ?? cmd.role };
            else if (cmd.op === "doc-review") result.data = { documentKey: str(body.documentKey) ?? cmd.documentKey };
            else if (cmd.op === "psq-status") result.data = { status: str(body.status) ?? cmd.status };
            return result;
        default:
            return result;
    }
}

export function decodeResult<C extends FieldCommand>(
    cmd: C,
    status: number,
    body: unknown,
    ctx: DecodeContext = {},
): CommandResult<CommandData<C>> {
    try {
        return decodeChecked(cmd, status, body, ctx) as CommandResult<CommandData<C>>;
    } catch {
        return fail("Unreadable response") as CommandResult<CommandData<C>>;
    }
}

function decodeChecked(cmd: FieldCommand, status: number, body: unknown, ctx: DecodeContext): CommandResult<unknown> {
    if (ctx.redirected) return fail(SESSION_EXPIRED);
    if (status < 200 || status >= 300) {
        return fail((isRecord(body) ? str(body.error) : undefined) ?? `Request failed (${status})`);
    }
    if (ctx.contentType !== undefined && !(ctx.contentType ?? "").toLowerCase().includes("json")) {
        return fail(SESSION_EXPIRED);
    }
    if (!isRecord(body)) return fail("Unreadable response");
    return decodeBody(cmd, body);
}
