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
 * The editor action (`action.server.ts`, via `writeKeyFor`) reads the field for the
 * commands whose first write would duplicate a record if repeated (unit create,
 * duplicate and bulk create, add-statutory-instance, upload-cover) and lifts it to
 * the header on that one API write. So a command abandoned by the time limit below
 * and retried with the same key does not run twice; every other command is
 * idempotent by nature and the field is ignored. A retry that arrives while the
 * first attempt is still running is refused by the server (409), which reads as a
 * plain failure: the abandoned attempt may still land, and the editor refreshes
 * its data after a write, so the person sees the real state.
 */
import type { CommandData, CommandResult, FieldCommand } from "@core/field-ui/commands";
import type { ExecuteOptions } from "@core/field-ui/data-source";
import { IDEMPOTENCY_FIELD } from "~/hooks/useGuardedSubmit";
import { decodeResult, encodeCommand } from "./web-commands";

export interface WebExecuteOptions {
    fetchImpl?: typeof fetch;
    endpoint?: (inspectionId: string) => string;
    /** Overrides the default time limit of a command (tests). */
    timeoutMs?: number;
}

export type WebExecute = <C extends FieldCommand>(
    inspectionId: string,
    cmd: C,
    opts?: ExecuteOptions,
) => Promise<CommandResult<CommandData<C>>>;

/** Longest a command may take before it is abandoned and answered as a failure: a stalled connection must not wedge a queue of writes behind it. */
const COMMAND_TIMEOUT_MS = 60_000;
/** Commands that upload an image get longer: a photo over a slow mobile link is legitimately slow. */
const UPLOAD_TIMEOUT_MS = 180_000;

function signalFor(ms: number): AbortSignal | undefined {
    if (typeof AbortSignal === "undefined") return undefined;
    if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
}

export function createWebExecute({
    fetchImpl = (input, init) => fetch(input, init),
    endpoint = (id) => `/resources/inspection-editor-command/${encodeURIComponent(id)}`,
    timeoutMs,
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
            const hasBinary = [...form.values()].some((v) => typeof v !== "string");
            const signal = signalFor(timeoutMs ?? (hasBinary ? UPLOAD_TIMEOUT_MS : COMMAND_TIMEOUT_MS));
            // busy-controls-allow: the guard is useFieldCommand (packages/field-ui/src/context.tsx), the only sanctioned caller of this function; it drops an overlapping call before it reaches here
            const res = await fetchImpl(endpoint(inspectionId), { method: "POST", credentials: "include", body: form, ...(signal ? { signal } : {}) });
            const contentType = res.headers.get("content-type");
            const body: unknown = contentType?.toLowerCase().includes("json") ? await res.json().catch(() => null) : null;
            return decodeResult(cmd, res.status, body, { redirected: res.redirected, contentType });
        } catch (err) {
            const message = err instanceof Error && err.message ? err.message : "Network error";
            return { ok: false, error: message } as CommandResult<CommandData<C>>;
        }
    };
}
