import { IDEMPOTENCY_FIELD } from "~/hooks/useGuardedSubmit";

/**
 * Editor intents whose FIRST write creates something a repeat would duplicate. The web transport aborts a
 * command after a time limit and reports a failure, and the person (or the package's retry) then sends
 * the same command again with the SAME key; if the first attempt had in fact committed, only a server-side
 * claim on that key stops a second unit, a second statutory instance or a second cover upload.
 */
const NON_IDEMPOTENT_INTENTS = new Set([
    "unit-create",
    "unit-duplicate",
    "unit-bulk-create",
    "add-statutory-instance",
    "upload-cover",
]);

/**
 * The idempotency key to attach to this action's first API write, or undefined. The key arrives as a form
 * field (a multipart body cannot carry the header across the BFF); the server middleware keys off the
 * `Idempotency-Key` header, so `createApi` lifts it. Intents that are idempotent by nature get none.
 */
export function writeKeyFor(intent: FormDataEntryValue | null, formData: FormData): string | undefined {
    if (typeof intent !== "string" || !NON_IDEMPOTENT_INTENTS.has(intent)) return undefined;
    const key = String(formData.get(IDEMPOTENCY_FIELD) ?? "").trim();
    return key || undefined;
}
