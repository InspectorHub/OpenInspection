/**
 * Detector for lint:busy-controls. Two rules over <button> / <Button> opening tags:
 *
 *  submit-unprotected   type="submit" with none of pending, pendingProps, disabled,
 *                       aria-disabled, aria-busy: a double-click sends twice.
 *  native-disable-busy  disabled={...} that names a busy-ish identifier: the browser drops
 *                       focus to <body> the moment the control disables. The convention is
 *                       <Button pending> or {...pendingProps(busy, onClick)} + PENDING_CLASS
 *                       from "@core/shared-ui" (aria-disabled plus an inert click).
 *
 * Exception: a comment `busy-controls-allow: <reason>` on the tag's lines or the two above.
 */
import { analyze, findOpeningTags, hasAllowMarker } from './jsx-scan.mjs';

const PROTECTION = new Set(['pending', 'disabled', 'aria-disabled', 'aria-busy']);
const BUSY_RE = /(?:submitting|saving|busy|loading|pending|sending|uploading|deleting|working)|state\s*[!=]==?\s*["']idle["']/i;
const SUBMIT_RE = /^\{?\s*["']submit["']\s*\}?$/;

/** { sites, submits, violations: [{ line, rule, message }] } for one file's source. */
export function detectBusyControls(src) {
    const a = analyze(src);
    const tags = findOpeningTags(a, /^(?:button|Button)$/);
    const violations = [];
    let submits = 0;
    for (const tag of tags) {
        const allowed = hasAllowMarker(src, 'busy-controls-allow', tag);
        const byName = (n) => tag.attrs.find((x) => x.name === n);
        const type = byName('type');
        if (type?.value && SUBMIT_RE.test(type.value.trim())) {
            submits += 1;
            const protectedByAttr = tag.attrs.some((x) => PROTECTION.has(x.name)
                || (x.name === '...' && /\bpendingProps\b/.test(x.value ?? '')));
            if (!protectedByAttr && !allowed) {
                violations.push({
                    line: tag.line,
                    rule: 'submit-unprotected',
                    message: `<${tag.name} type="submit"> has no pending / pendingProps / disabled / aria-disabled / aria-busy`,
                });
            }
        }
        const disabled = byName('disabled');
        if (disabled?.value && BUSY_RE.test(disabled.value) && !allowed) {
            violations.push({
                line: tag.line,
                rule: 'native-disable-busy',
                message: `<${tag.name} disabled=${disabled.value.replace(/\s+/g, ' ').slice(0, 60)}> natively disables while busy and drops focus; use pending / pendingProps`,
            });
        }
    }
    return { sites: tags.length, submits, violations };
}
