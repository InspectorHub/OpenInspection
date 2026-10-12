/**
 * Detector for lint:busy-controls. Two rules over <button> / <Button> opening tags:
 *
 *  submit-unprotected   type="submit" with none of pending, pendingProps or disabled
 *                       (a bare aria-disabled / aria-busy does not block a click or Enter).
 *  native-disable-busy  disabled={...} that names a busy-ish identifier: the browser drops
 *                       focus to <body> the moment the control disables. The convention is
 *                       <Button pending> or {...pendingProps(busy, onClick)} + PENDING_CLASS
 *                       from "@core/shared-ui" (aria-disabled plus an inert click).
 *
 * A submit is: type="submit"; ANY `type=` expression that mentions "submit" (`{ok ? "submit" : "button"}`,
 * a template literal) -- reported, the allow marker exists for the exceptions; and a bare lowercase
 * <button> with no `type` that sits lexically inside a <form> / <Form> / x.Form element (a button
 * defaults to submit there).
 *
 * Busy words are matched as whole identifiers (camelCase and snake_case words, so `isSubmitting`
 * and `revoking_id` match but `loadingzone` does not); a comparison against a string literal
 * (`inv.status !== "pending"`) is data, not a busy flag, and is ignored. `fetcher.state` compared
 * with "idle" / "submitting" / "loading" is the one string comparison that IS a busy test.
 *
 * Out of scope: wrapper components (`LoadingButton`, a local `SubmitButton`, ...) -- the rules read
 * only <button> / <Button> opening tags, so what a wrapper renders is its own file's business, and a
 * `disabled` forwarded through `{...props}` is invisible. Server-rendered or spread-supplied `type` too.
 *
 * Exception: a comment `busy-controls-allow: <reason>` inside the tag or on the line(s) just above it;
 * it exempts exactly the next opening tag and needs a real reason (see jsx-scan.mjs hasAllowMarker).
 */
import { analyze, elementBody, findOpeningTags, hasAllowMarker } from './jsx-scan.mjs';

// A bare aria-disabled / aria-busy does not stop a submit: only pendingProps' inert click cancels
// the click that Enter in a field synthesizes on the default button. Anything else needs a marker.
const PROTECTION = new Set(['pending', 'disabled']);
const BUSY_WORDS = new Set([
    'submitting', 'saving', 'busy', 'loading', 'pending', 'sending', 'uploading', 'deleting', 'working',
    'creating', 'syncing', 'processing', 'connecting', 'starting', 'updating', 'removing', 'revoking',
]);
const BUSY_IDENTIFIERS = new Set(['isbusy', 'inflight']);
const STATE_RE = /\bstate\s*[!=]==?\s*["'](?:idle|submitting|loading)["']/;
const STRING_COMPARISON = /[A-Za-z_$][\w$.]*\s*[!=]==?\s*(["'`])(?:\.|(?!\1).)*\1|(["'`])(?:\.|(?!\2).)*\2\s*[!=]==?\s*[A-Za-z_$][\w$.]*/g;
const STRING_LITERAL = /(["'`])(?:\.|(?!\1).)*\1/g;
const FORM_NAME = /^(?:form|Form|[A-Za-z_$][\w$]*\.Form)$/;

/** True when an expression reads a busy flag: a whole busy identifier, or the fetcher.state test. */
function namesBusy(value) {
    if (STATE_RE.test(value)) return true;
    const code = value.replace(STRING_COMPARISON, ' ').replace(STRING_LITERAL, ' ');
    for (const id of code.match(/[A-Za-z_$][\w$]*/g) ?? []) {
        if (BUSY_IDENTIFIERS.has(id.toLowerCase())) return true;
        const words = id.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? [];
        if (words.some((w) => BUSY_WORDS.has(w.toLowerCase()))) return true;
    }
    return false;
}

/** { sites, submits, violations: [{ line, rule, message }] } for one file's source. */
export function detectBusyControls(src) {
    const a = analyze(src);
    const tags = findOpeningTags(a, /^(?:button|Button)$/);
    const formRanges = findOpeningTags(a, FORM_NAME)
        .filter((f) => !f.selfClosing)
        .map((f) => [f.end, f.end + elementBody(a, f).length]);
    const violations = [];
    let submits = 0;
    for (const tag of tags) {
        const allowed = hasAllowMarker(a, 'busy-controls-allow', tag);
        const byName = (n) => tag.attrs.find((x) => x.name === n);
        const type = byName('type');
        const typedSubmit = Boolean(type?.value && /submit/.test(type.value));
        const implicitSubmit = !type && tag.name === 'button' && formRanges.some(([from, to]) => tag.start > from && tag.start < to);
        if (typedSubmit || implicitSubmit) {
            submits += 1;
            const protectedByAttr = tag.attrs.some((x) => PROTECTION.has(x.name)
                || (x.name === '...' && /\bpendingProps\b/.test(x.value ?? '')));
            if (!protectedByAttr && !allowed) {
                violations.push({
                    line: tag.line,
                    rule: 'submit-unprotected',
                    message: implicitSubmit
                        ? `<${tag.name}> has no type, so it submits its form, and has no pending / pendingProps / disabled`
                        : `<${tag.name} type=${type.value.replace(/\s+/g, ' ').slice(0, 40)}> submits and has no pending / pendingProps / disabled (aria-disabled alone neither blocks a click nor Enter)`,
                });
            }
        }
        const disabled = byName('disabled');
        if (disabled?.value && namesBusy(disabled.value) && !allowed) {
            violations.push({
                line: tag.line,
                rule: 'native-disable-busy',
                message: `<${tag.name} disabled=${disabled.value.replace(/\s+/g, ' ').slice(0, 60)}> natively disables while busy and drops focus; use pending / pendingProps`,
            });
        }
    }
    return { sites: tags.length, submits, violations };
}
