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
 * first attempt is still running is refused by the server (409 `IDEMPOTENCY_IN_FLIGHT`,
 * passed through by the editor-command route). That is not a failure of the write: the
 * transport waits briefly (bounded, with backoff) and re-sends the SAME form, key
 * included, once or twice. If the first attempt is still running after that, the answer
 * is a distinct "still being saved" result (`inProgress: true`) whose text tells the
 * person to check the inspection before trying again, because the abandoned attempt may
 * still land.
 */
import type { CommandData, CommandResult, FieldCommand } from "@core/field-ui/commands";
import type { ExecuteOptions } from "@core/field-ui/data-source";
import { IDEMPOTENCY_FIELD } from "~/hooks/useGuardedSubmit";
import { m } from "~/paraglide/messages";
import { decodeResult, encodeCommand } from "./web-commands";

export interface WebExecuteOptions {
    fetchImpl?: typeof fetch;
    endpoint?: (inspectionId: string) => string;
    /** Overrides the default time limit of a command (tests). */
    timeoutMs?: number;
    /** Waits; replaced in tests so no real time passes. */
    sleep?: (ms: number) => Promise<void>;
}

export type WebExecute = <C extends FieldCommand>(
    inspectionId: string,
    cmd: C,
    opts?: ExecuteOptions,
) => Promise<CommandResult<CommandData<C>>>;

/** Longest a command may take before it is abandoned and answered as a failure: a stalled connection must not wedge a queue of writes behind it. */
const COMMAND_TIMEOUT_MS = 60_000;
/**
 * Waits before each re-send of a command the server reports as still running: two re-sends, the second after a
 * longer pause, about 5.5 s of waiting in all (plus the requests themselves), well inside a person's patience for a save.
 */
const IN_FLIGHT_WAITS_MS: readonly number[] = [1500, 4000];
/** The error code the API's idempotency middleware answers with (HTTP 409) for a repeat that arrives mid-flight. */
const IN_FLIGHT_CODE = "IDEMPOTENCY_IN_FLIGHT";

const isInFlight = (status: number, body: unknown): boolean =>
    status === 409 && typeof body === "object" && body !== null && (body as { error?: { code?: unknown } }).error?.code === IN_FLIGHT_CODE;

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
    sleep = (ms) => new Promise<void>((done) => setTimeout(done, ms)),
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
            const send = async () => {
                const signal = signalFor(timeoutMs ?? (hasBinary ? UPLOAD_TIMEOUT_MS : COMMAND_TIMEOUT_MS));
                // busy-controls-allow: the guard is useFieldCommand (packages/field-ui/src/context.tsx), the only sanctioned caller of this function; it drops an overlapping call before it reaches here, and a re-send of a refused-as-still-running command carries the same idempotency key, so it can never run twice
                const res = await fetchImpl(endpoint(inspectionId), { method: "POST", credentials: "include", body: form, ...(signal ? { signal } : {}) });
                const contentType = res.headers.get("content-type");
                const body: unknown = contentType?.toLowerCase().includes("json") ? await res.json().catch(() => null) : null;
                return { res, contentType, body };
            };
            let answer = await send();
            // Only a command that carries a key can be refused as still running; the same key goes out again each time.
            for (const wait of IN_FLIGHT_WAITS_MS) {
                if (!isInFlight(answer.res.status, answer.body)) break;
                await sleep(wait);
                answer = await send();
            }
            if (isInFlight(answer.res.status, answer.body)) {
                return { ok: false, error: m.editor_command_still_saving(), inProgress: true } as CommandResult<CommandData<C>>;
            }
            return decodeResult(cmd, answer.res.status, answer.body, { redirected: answer.res.redirected, contentType: answer.contentType });
        } catch (err) {
            const message = err instanceof Error && err.message ? err.message : "Network error";
            return { ok: false, error: message } as CommandResult<CommandData<C>>;
        }
    };
}
