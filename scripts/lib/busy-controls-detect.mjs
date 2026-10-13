/**
 * Detector for lint:busy-controls. Two rules over <button> / <Button> opening tags, and a third over
 * form opening tags (form-without-latch, below):
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
 * form-without-latch  a file that renders a state-changing form -- `<form>`, `<Form>`, `<fetcher.Form>` or
 *                       `<x.Form>` with a `method` whose value is not a literal get/GET, or with an `onSubmit`
 *                       -- and names NO same-frame protection anywhere: useSubmitLatch, useActionLatch,
 *                       useGuardedSubmit, latch(, inFlight, gatedSubmit, guardedSubmit, busyRef. pendingProps
 *                       only takes effect after React renders the busy state, so a fast double click posts
 *                       twice; those guards close the gap in the same frame.
 *                       COARSE ON PURPOSE: it is a file-level presence check. It catches a file with NO guard
 *                       at all (the bug class) and cannot prove each form in a file is wired to the guard --
 *                       a file with two forms and one latch is clean. Identifiers are read from the
 *                       comment-blanked text and never from a string, so a mention in either does not count.
 *                       A guard that lives in another file (a parent component, a shared hook) is invisible;
 *                       that is what the allow marker is for, with the reason naming where the guard is.
 *
 * Exception: a comment `busy-controls-allow: <reason>` inside the tag or on the line(s) just above it;
 * it exempts exactly the next opening tag and needs a real reason (see jsx-scan.mjs hasAllowMarker).
 */
import { analyze, elementBody, findOpeningTags, hasAllowMarker, lineOf } from './jsx-scan.mjs';

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

const SAME_FRAME_GUARD = /\b(?:useSubmitLatch|useActionLatch|useGuardedSubmit|inFlight|gatedSubmit|guardedSubmit|busyRef)\b|\b\w*[lL]atch\w*\(|\b\w*[iI]nFlight\b/g;
const GUARD_TEST = new RegExp(SAME_FRAME_GUARD.source);
const KEYWORDS = new Set(['const', 'let', 'var', 'function', 'async', 'await', 'return', 'if', 'else', 'new', 'true', 'false', 'null', 'undefined', 'typeof', 'void', 'this', 'e', 'ev', 'event', 'preventDefault', 'currentTarget', 'target']);
const LITERAL_GET = /^\{?\s*(["'`])get\1\s*\}?$/i;

/** `text` with the inside of every string blanked, so braces and names in strings cannot be read as code. */
function codeOf(a) {
    let out = '';
    for (let i = 0; i < a.text.length; i += 1) out += a.str[i] && a.text[i] !== '\n' ? ' ' : a.text[i];
    return out;
}

/** End offset of the statement that starts at `start`: balanced brackets, then `;` or a line break that does not continue it. */
function statementEnd(code, start) {
    let depth = 0;
    for (let k = start; k < code.length; k += 1) {
        const ch = code[k];
        if ('({['.includes(ch)) depth += 1;
        else if (')}]'.includes(ch)) depth -= 1;
        else if (depth <= 0 && (ch === ';' || (ch === '\n' && !/^\s*[.?:&|+,]/.test(code.slice(k + 1, k + 40)) && /[;})\]]\s*$/.test(code.slice(Math.max(start, k - 3), k))))) return k;
    }
    return code.length;
}

/** The statements that declare `id` in this file: `const|let|var|function id`, or `const { .., id, .. } = ...`. */
function declarationsOf(code, id) {
    const out = [];
    const direct = new RegExp(`\\b(?:const|let|var|function)\\s+${id}\\b`, 'g');
    const destructured = new RegExp(`\\b(?:const|let|var)\\s*\\{[^}]*\\b${id}\\b[^}]*\\}\\s*=`, 'g');
    for (const re of [direct, destructured]) {
        for (const m of code.matchAll(re)) out.push(code.slice(m.index, statementEnd(code, m.index)));
    }
    return out;
}

/** True when `expr` (an onSubmit value) reaches a same-frame guard: names one, or names a handler that does, up to three hops. */
function reachesGuard(code, expr, depth = 3, seen = new Set()) {
    if (GUARD_TEST.test(expr)) return true;
    if (depth === 0) return false;
    for (const id of new Set(expr.match(/[A-Za-z_$][\w$]*/g) ?? [])) {
        if (KEYWORDS.has(id) || seen.has(id)) continue;
        seen.add(id);
        for (const decl of declarationsOf(code, id)) if (reachesGuard(code, decl, depth - 1, seen)) return true;
    }
    return false;
}

/**
 * The functions that enclose offset `at`, innermost first, each { text, name }. `name` is the identifier the function is
 * declared as (`function name`, `const name = (..) =>`), or '' for an anonymous one. A component (a name starting with a
 * capital letter) ends the chain and is not included: a guard anywhere in a whole component says nothing about one handler.
 */
function enclosingFunctions(code, at) {
    const out = [];
    let depth = 0;
    for (let k = at - 1; k >= 0; k -= 1) {
        const ch = code[k];
        if (ch === '}') depth += 1;
        else if (ch === '{') {
            if (depth > 0) { depth -= 1; continue; }
            const from = Math.max(0, k - 200);
            const head = code.slice(from, k);
            if (!/(?:=>|\bfunction\b[^{]*|\)\s*(?::\s*[\w<>\[\]|. ]+)?)\s*$/.test(head)) continue;
            const named = /(?:\bfunction\s+([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=>]+)?=>)\s*$/.exec(head);
            // `function Name({ a }: Props) {` has a brace inside its own parameter list, so read the name after the last `function`.
            const declared = /^function\s+([A-Za-z_$][\w$]*)/.exec(head.slice(Math.max(0, head.lastIndexOf('function'))));
            const name = named?.[1] ?? named?.[2] ?? (head.includes('function') ? declared?.[1] ?? '' : '');
            if (/^[A-Z]/.test(name)) break;
            let d = 1;
            let end = k + 1;
            for (; end < code.length && d > 0; end += 1) {
                if (code[end] === '{') d += 1;
                else if (code[end] === '}') d -= 1;
            }
            const boundary = Math.max(head.lastIndexOf(';\n'), head.lastIndexOf('}\n'), 0);
            out.push({ text: code.slice(from + boundary, end), name });
        }
    }
    return out;
}

/** True when a function around `at` names a guard, or is itself handed to one (`emailLatch(sendEmail)`, `latch(() => ...)`). */
function guardedAt(code, at) {
    // An expression-bodied arrow has no brace to climb out of: `saveLatch(() => saveFetcher.submit(...))`.
    const lead = code.slice(Math.max(0, at - 300), at);
    if (GUARD_TEST.test(lead.slice(Math.max(lead.lastIndexOf(';'), lead.lastIndexOf('{'), lead.lastIndexOf('}')) + 1))) return true;
    for (const fn of enclosingFunctions(code, at)) {
        if (GUARD_TEST.test(fn.text)) return true;
        if (fn.name && new RegExp(`[lL]atch\\w*\\([^;]*\\b${fn.name}\\b|(?:useGuardedSubmit|gatedSubmit)\\([^;]*\\b${fn.name}\\b`).test(code)) return true;
    }
    return false;
}

/** The source between the parentheses of the call whose `(` ends just before `from` (strings kept, comments blanked). */
function callArgs(text, str, from) {
    let depth = 1;
    let k = from;
    for (; k < text.length && depth > 0; k += 1) {
        if (str[k]) continue;
        if ('({['.includes(text[k])) depth += 1;
        else if (')}]'.includes(text[k])) depth -= 1;
    }
    return text.slice(from, k - 1);
}

/** True for a submit that writes: an explicit post / put / patch / delete method, or a method that is not a literal. A plain submit is a GET (a search, a load). */
function mutates(args) {
    const m = /\bmethod\s*:\s*(["'`]?)([^,}"'`\s]*)/.exec(args);
    if (!m) return false;
    return m[1] === '' || /^(?:post|put|patch|delete)$/i.test(m[2]);
}

/** True when the file names a same-frame guard outside comments and strings. */
function hasSameFrameGuard(a) {
    for (const m of a.text.matchAll(SAME_FRAME_GUARD)) if (!a.str[m.index]) return true;
    return false;
}

/** True when a form tag can change state: a non-literal-GET `method`, or any `onSubmit`. */
function changesState(tag) {
    const method = tag.attrs.find((x) => x.name === 'method');
    if (method && !(method.value && LITERAL_GET.test(method.value.trim()))) return true;
    return tag.attrs.some((x) => x.name === 'onSubmit');
}

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
    const code = codeOf(a);
    for (const form of findOpeningTags(a, FORM_NAME)) {
        if (!changesState(form) || hasAllowMarker(a, 'busy-controls-allow', form)) continue;
        const onSubmit = form.attrs.find((x) => x.name === 'onSubmit')?.value ?? '';
        const wired = GUARD_TEST.test(code.slice(form.start, form.end + 1)) || (onSubmit !== '' && reachesGuard(code, onSubmit));
        if (wired) continue;
        violations.push({
            line: form.line,
            rule: 'form-without-latch',
            message: `<${form.name}> changes state and its own onSubmit (or the handler it names) reaches no same-frame guard (useSubmitLatch / useActionLatch / useGuardedSubmit / latch( / inFlight / busyRef); pending alone lets a fast double click post twice`,
        });
    }
    // A raw `<fetcher>.submit(` that WRITES, from a handler, is a request issued with no <form> to latch.
    // A bare `fetch(` that writes is the same thing without the router: nothing renders between two clicks either.
    const calls = [
        ...code.matchAll(/\b([A-Za-z_$][\w$]*(?:[Ff]etcher|[Ff]etch)\w*)\.submit\(/g),
        ...code.matchAll(/(?<![.\w$])(fetch)\(/g),
    ];
    for (const m of calls) {
        const at = m.index;
        if (!mutates(callArgs(a.text, a.str, at + m[0].length))) continue;
        const line = lineOf(a.src, at);
        if (guardedAt(code, at)) continue;
        // The marker sits above the STATEMENT (`const res = await fetch(`), so anchor it at the statement's first character.
        let stmt = at;
        while (stmt > 0 && !';{}'.includes(code[stmt - 1])) stmt -= 1;
        while (stmt < at && /\s/.test(code[stmt])) stmt += 1;
        const tagLike = { start: stmt, end: at + m[0].length, line: lineOf(a.src, stmt) };
        if (hasAllowMarker(a, 'busy-controls-allow', tagLike)) continue;
        violations.push({
            line,
            rule: 'raw-submit-unlatched',
            message: `${m[1]}${m[1] === "fetch" ? "(" : ".submit("} is called from a function that reaches no same-frame guard; a double click issues the request twice before pending renders (useActionLatch / useGuardedSubmit)`,
        });
    }
    return { sites: tags.length, submits, violations };
}
