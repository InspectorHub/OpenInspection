/**
 * Transport for the web data source's `execute`.
 *
 * POSTs the encoded command to the editor-command resource route and decodes the
 * JSON answer. It never throws: a rejected fetch or an abort becomes
 * `{ ok: false, error }`.
 *
 * The idempotency key travels ONLY as a form field (`IDEMPOTENCY_FIELD`), never
 * as an `Idempotency-Key` header. The BFF idempotency middleware claims any
 * request carrying that header, and a multipart body fingerprints as null, so
 * two different commands sharing a key would replay each other's stored answer.
 * The editor action does not read the field today; it is sent for parity with
 * `useGuardedSubmit`.
 */
import type { CommandData, CommandResult, FieldCommand } from "@core/field-ui/commands";
import type { ExecuteOptions } from "@core/field-ui/data-source";
import { IDEMPOTENCY_FIELD } from "~/hooks/useGuardedSubmit";
import { decodeResult, encodeCommand } from "./web-commands";

export interface WebExecuteOptions {
    fetchImpl?: typeof fetch;
    endpoint?: (inspectionId: string) => string;
}

export type WebExecute = <C extends FieldCommand>(
    inspectionId: string,
    cmd: C,
    opts?: ExecuteOptions,
) => Promise<CommandResult<CommandData<C>>>;

export function createWebExecute({
    fetchImpl = (input, init) => fetch(input, init),
    endpoint = (id) => `/resources/inspection-editor-command/${encodeURIComponent(id)}`,
}: WebExecuteOptions = {}): WebExecute {
    return async function execute<C extends FieldCommand>(
        inspectionId: string,
        cmd: C,
        opts?: ExecuteOptions,
    ): Promise<CommandResult<CommandData<C>>> {
        if (!inspectionId) return { ok: false, error: "No inspection id" };
        try {
            const { form } = encodeCommand(cmd);
            if (opts?.idempotencyKey) form.append(IDEMPOTENCY_FIELD, opts.idempotencyKey);
            // busy-controls-allow: the guard is useFieldCommand (packages/field-ui/src/context.tsx), the only sanctioned caller of this function; it drops an overlapping call before it reaches here
            const res = await fetchImpl(endpoint(inspectionId), { method: "POST", credentials: "include", body: form });
            const contentType = res.headers.get("content-type");
            const body: unknown = contentType?.toLowerCase().includes("json") ? await res.json().catch(() => null) : null;
            return decodeResult(cmd, res.status, body, { redirected: res.redirected, contentType });
        } catch (err) {
            const message = err instanceof Error && err.message ? err.message : "Network error";
            return { ok: false, error: message } as CommandResult<CommandData<C>>;
        }
    };
}
